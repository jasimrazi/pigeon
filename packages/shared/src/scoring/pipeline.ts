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
  filter_reason?: string | null;
  match_score?: number | null;
  match_reasons?: string | null;
  red_flags?: string | null;
  scorer_failed?: number | boolean | null;
  apply_route?: string | null;
  route_reason?: string | null;
}

async function routeScoredJob(params: {
  job: RawJobRow;
  db: D1LikeDatabase;
  finder?: ContactFinder | undefined;
  config?: ContactDiscoveryConfig | undefined;
  profile: Profile;
  nowIso: string;
}): Promise<'routed' | 'low_score_skipped'> {
  const { job, db, finder, config, profile, nowIso } = params;

  let scorerFailed = Boolean(job.scorer_failed);
  let matchScore = job.match_score ?? null;
  const matchReasons = job.match_reasons ?? null;

  // Fallback: If matchScore is missing on the row and scorer hasn't failed, check the stored job_scored event
  if (matchScore === null && !scorerFailed) {
    const eventRow = await db
      .prepare(
        `SELECT payload FROM events WHERE entity = 'job' AND entity_id = ? AND type = 'job_scored' ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(job.id)
      .first<{ payload: string }>();
    if (eventRow?.payload) {
      try {
        const parsed = JSON.parse(eventRow.payload);
        if (typeof parsed.score === 'number') {
          matchScore = parsed.score;
        }
        if (parsed.scorer_failed) {
          scorerFailed = true;
        }
      } catch {
        // ignore parse error
      }
    }
  }

  let redFlags: string[] = [];
  if (job.red_flags) {
    try {
      redFlags = JSON.parse(job.red_flags);
    } catch {
      redFlags = [];
    }
  }

  // 1. Min-score check on stored result: if below threshold and not scorer_failed -> transition to skipped with LOW_SCORE
  if (matchScore !== null && !scorerFailed && matchScore < profile.filters.min_score) {
    await db
      .prepare(
        `UPDATE jobs SET filter_reason = 'LOW_SCORE', match_score = ?, match_reasons = ?, red_flags = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(matchScore, matchReasons, JSON.stringify(redFlags), nowIso, job.id)
      .run();
    await transition(db, 'job', job.id, 'skipped', 'LOW_SCORE');
    return 'low_score_skipped';
  }

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
  return 'routed';
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

  // 1. Recover jobs stuck in status 'scored' (e.g. after a crash between scoring and routing)
  const scoredJobsRes = await db
    .prepare(`SELECT * FROM jobs WHERE status = 'scored' ORDER BY updated_at ASC LIMIT ?`)
    .bind(limit)
    .all<RawJobRow>();

  const scoredJobs = scoredJobsRes.results || [];
  for (const job of scoredJobs) {
    stats.processed++;
    const res = await routeScoredJob({
      job,
      db,
      finder,
      config,
      profile,
      nowIso,
    });
    if (res === 'routed') {
      stats.routed++;
    } else {
      stats.low_score_skipped++;
    }
  }

  // 2. Fetch pending new jobs (honoring remaining limit)
  const remainingLimit = Math.max(0, limit - scoredJobs.length);
  if (remainingLimit > 0) {
    const jobsRes = await db
      .prepare(`SELECT * FROM jobs WHERE status = 'new' ORDER BY fetched_at ASC LIMIT ?`)
      .bind(remainingLimit)
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
        await db
          .prepare(
            `UPDATE jobs SET scorer_failed = 1, match_score = NULL, match_reasons = ?, red_flags = ?, updated_at = ?
             WHERE id = ?`,
          )
          .bind(matchReasons, JSON.stringify(redFlags), nowIso, job.id)
          .run();
        await transition(db, 'job', job.id, 'scored', 'SCORER_FAILED');
      } else if (scoreRes.score < profile.filters.min_score) {
        stats.low_score_skipped++;
        await db
          .prepare(
            `UPDATE jobs SET filter_reason = 'LOW_SCORE',
               match_score = ?, match_reasons = ?, red_flags = ?, scorer_failed = 0, updated_at = ?
             WHERE id = ?`,
          )
          .bind(matchScore, matchReasons, JSON.stringify(redFlags), nowIso, job.id)
          .run();
        await transition(db, 'job', job.id, 'skipped', 'LOW_SCORE');
        continue;
      } else {
        await db
          .prepare(
            `UPDATE jobs SET match_score = ?, match_reasons = ?, red_flags = ?, scorer_failed = 0, updated_at = ?
             WHERE id = ?`,
          )
          .bind(matchScore, matchReasons, JSON.stringify(redFlags), nowIso, job.id)
          .run();
        await transition(db, 'job', job.id, 'scored', 'SCORED');
      }

      stats.scored++;

      const res = await routeScoredJob({
        job: {
          ...job,
          match_score: matchScore,
          match_reasons: matchReasons,
          red_flags: JSON.stringify(redFlags),
          scorer_failed: scorerFailed ? 1 : 0,
        },
        db,
        finder,
        config,
        profile,
        nowIso,
      });

      if (res === 'routed') {
        stats.routed++;
      } else {
        stats.low_score_skipped++;
      }
    }
  }

  return stats;
}
