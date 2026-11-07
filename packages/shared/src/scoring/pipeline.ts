import type { D1LikeDatabase } from '../state-machine.js';
import { transition } from '../state-machine.js';
import type { Profile } from '../profile.js';
import type { ContactFinder } from '../types.js';
import type { Scorer } from './scorer.js';
import { evaluateRuleFilters } from './filter-rules.js';
import { evaluateSkipChecks } from './skip-checks.js';
import { discoverContact, type ContactDiscoveryConfig } from './contact-finder.js';
import { routeJob, type RoutableJob } from './router.js';
import type { JobContactSource, JobSourceKind } from '../schema.js';

export interface ProcessPipelineOptions {
  db: D1LikeDatabase;
  profile: Profile;
  scorer: Scorer;
  finder?: ContactFinder | undefined;
  config?:
    | (ContactDiscoveryConfig & {
        max_scored_per_day?: number | undefined;
      })
    | undefined;
  nowMs?: number | undefined;
  limit?: number | undefined;
}

export interface PipelineStats {
  processed: number;
  filtered_out: number;
  skipped_dnc_or_recent: number;
  low_score_skipped: number;
  scored: number;
  routed: number;
  deferred_daily_cap: number;
}

export async function getScoredCountToday(db: D1LikeDatabase, datePrefix: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) as count FROM events WHERE type = 'job_scored' AND created_at LIKE ?`)
    .bind(`${datePrefix}%`)
    .first<{ count: number }>();

  return row?.count ?? 0;
}

interface RawJobRow {
  id: string;
  source: string;
  source_kind: JobSourceKind;
  source_job_id: string | null;
  title: string;
  company: string;
  company_normalized: string;
  location: string | null;
  remote: number | boolean | null;
  salary_min: number | null;
  salary_max: number | null;
  currency: string | null;
  salary_raw: string | null;
  description: string;
  apply_url: string | null;
  contact_email: string | null;
  contact_source: JobContactSource | null;
  posted_at: string | null;
  untrusted: number | boolean | null;
  status: string;
}

export async function processJobPipeline(options: ProcessPipelineOptions): Promise<PipelineStats> {
  const { db, profile, scorer, finder, config } = options;
  const nowMs = options.nowMs || Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const todayPrefix = nowIso.slice(0, 10); // YYYY-MM-DD
  const maxScoredPerDay = config?.max_scored_per_day ?? 200;
  const limit = options.limit || 50;

  const stats: PipelineStats = {
    processed: 0,
    filtered_out: 0,
    skipped_dnc_or_recent: 0,
    low_score_skipped: 0,
    scored: 0,
    routed: 0,
    deferred_daily_cap: 0,
  };

  let scoredToday = await getScoredCountToday(db, todayPrefix);

  // Fetch pending new jobs
  const jobsRes = await db
    .prepare(`SELECT * FROM jobs WHERE status = 'new' ORDER BY fetched_at ASC LIMIT ?`)
    .bind(limit)
    .all<RawJobRow>();

  const newJobs = jobsRes.results || [];

  for (const job of newJobs) {
    stats.processed++;

    // STEP 1: RULE FILTERS (cheap, run first)
    const filterRes = evaluateRuleFilters(
      {
        title: job.title,
        company: job.company,
        company_normalized: job.company_normalized,
        location: job.location,
        remote: Boolean(job.remote),
        salary_min: job.salary_min,
        salary_max: job.salary_max,
        description: job.description,
      },
      profile,
    );

    if (!filterRes.passed) {
      stats.filtered_out++;
      await db
        .prepare(`UPDATE jobs SET filter_reason = ?, updated_at = ? WHERE id = ?`)
        .bind(filterRes.reason ?? 'FILTERED_OUT', nowIso, job.id)
        .run();
      await transition(db, 'job', job.id, 'filtered_out', filterRes.reason);
      continue;
    }

    // STEP 2: SKIP CHECKS (DNC & Recently Contacted within 90 days)
    const skipRes = await evaluateSkipChecks(
      {
        company: job.company,
        company_normalized: job.company_normalized,
        contact_email: job.contact_email,
      },
      db,
      nowMs,
    );

    if (skipRes.skipped) {
      stats.skipped_dnc_or_recent++;
      await db
        .prepare(`UPDATE jobs SET filter_reason = ?, updated_at = ? WHERE id = ?`)
        .bind(skipRes.reason ?? 'SKIPPED', nowIso, job.id)
        .run();
      await transition(db, 'job', job.id, 'skipped', skipRes.reason);
      continue;
    }

    // STEP 3: SCORER (Check daily cap before invoking LLM)
    if (scoredToday >= maxScoredPerDay) {
      stats.deferred_daily_cap++;
      // Stop processing new jobs for today; leftovers wait for tomorrow
      break;
    }

    const scoreRes = await scorer.scoreJob(
      {
        title: job.title,
        company: job.company,
        location: job.location,
        description: job.description,
        salary_raw: job.salary_raw,
      },
      profile,
    );

    scoredToday++;
    // Record scoring event for daily cap tracking
    await db
      .prepare(
        `INSERT INTO events (id, entity, entity_id, type, payload, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        'job',
        job.id,
        'job_scored',
        JSON.stringify({
          score: scoreRes.score,
          scorer_failed: scoreRes.scorer_failed,
        }),
        nowIso,
      )
      .run();

    const scorerFailed = scoreRes.scorer_failed;
    let matchScore: number | null = scoreRes.score;
    const matchReasons = scoreRes.reasons;
    const redFlags = scoreRes.red_flags;

    if (scorerFailed) {
      matchScore = null;
      await transition(db, 'job', job.id, 'scored', 'SCORER_FAILED');
    } else if (scoreRes.score < profile.filters.min_score) {
      stats.low_score_skipped++;
      await db
        .prepare(
          `UPDATE jobs SET filter_reason = 'LOW_SCORE',
             match_score = ?, match_reasons = ?, red_flags = ?, updated_at = ?
           WHERE id = ?`,
        )
        .bind(matchScore, matchReasons, JSON.stringify(redFlags), nowIso, job.id)
        .run();
      await transition(db, 'job', job.id, 'skipped', 'LOW_SCORE');
      continue;
    } else {
      await transition(db, 'job', job.id, 'scored', 'SCORED');
    }

    stats.scored++;

    // STEP 4: CONTACT DISCOVERY (chain stops at first hit)
    const contactRes = await discoverContact({
      job: {
        company: job.company,
        description: job.description,
        apply_url: job.apply_url,
        contact_email: job.contact_email,
        contact_source: job.contact_source,
      },
      finder,
      config,
      db,
    });

    const contactEmail = contactRes.contact_email;
    const contactSource = contactRes.contact_source;

    // STEP 5: ROUTER (first match wins)
    const routableJob: RoutableJob = {
      source_kind: job.source_kind,
      contact_source: contactSource,
      contact_email: contactEmail,
      red_flags: redFlags,
      scorer_failed: scorerFailed,
      untrusted: Boolean(job.untrusted),
      company: job.company,
      company_normalized: job.company_normalized,
    };

    const routingDecision = routeJob(routableJob);

    // Atomicity: write metadata first so a crash never leaves a job in 'routed' status with NULL apply_route
    await db
      .prepare(
        `UPDATE jobs SET
           apply_route = ?,
           route_reason = ?,
           contact_email = ?,
           contact_source = ?,
           match_score = ?,
           match_reasons = ?,
           red_flags = ?,
           scorer_failed = ?,
           updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        routingDecision.route,
        routingDecision.reason,
        contactEmail,
        contactSource,
        matchScore,
        matchReasons,
        JSON.stringify(redFlags),
        scorerFailed ? 1 : 0,
        nowIso,
        job.id,
      )
      .run();

    await transition(db, 'job', job.id, 'routed', routingDecision.reason);

    stats.routed++;
  }

  return stats;
}
