import type { D1LikeDatabase } from '../state-machine.js';
import type { KVNamespaceLike } from './types.js';
import { ALL_SOURCES } from './adapters/index.js';
import { computeDedupeKey } from './dedupe.js';
import { extractContactEmail } from './email-extractor.js';
import { checkCircuit, recordRunSuccess, recordRunFailure } from './circuit-breaker.js';

export const DEFAULT_ENABLED_SOURCES = [
  'adzuna',
  'remoteok',
  'remotive',
  'weworkremotely',
  'hiring_hn',
  'greenhouse',
  'lever',
  'ashby',
];

export async function getEnabledSources(kv?: KVNamespaceLike): Promise<string[]> {
  if (kv) {
    const raw = await kv.get('sources:enabled');
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map(String);
        }
      } catch {
        const list = raw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        if (list.length > 0) return list;
      }
    }
  }
  return DEFAULT_ENABLED_SOURCES;
}

export interface IngestOptions {
  db: D1LikeDatabase;
  kv?: KVNamespaceLike | undefined;
  secrets?:
    | {
        ADZUNA_APP_ID?: string | undefined;
        ADZUNA_APP_KEY?: string | undefined;
        [key: string]: string | undefined;
      }
    | undefined;
  userAgent?: string | undefined;
  fetchFn?: typeof fetch | undefined;
  delayFn?: ((ms: number) => Promise<void>) | undefined;
  now?: number | undefined;
  slugs?: string[] | undefined;
}

export interface IngestResult {
  source: string;
  skipped: boolean;
  skipReason?: string | undefined;
  fetched: number;
  newJobs: number;
  duplicates: number;
  failed: number;
  isHalfOpenTrial: boolean;
  boards_total?: number | undefined;
  boards_failed?: number | undefined;
  failed_boards?: string[] | undefined;
}

/**
 * Executes the ingestion pipeline for a given job source:
 * 1. Verifies circuit breaker state in source_state.
 * 2. Fetches raw jobs using the adapter.
 * 3. Normalizes jobs and extracts contact emails with strict regex.
 * 4. Computes deterministic dedupe_key and inserts new jobs into D1.
 * 5. Ignores duplicates and records per-source stats in events.
 * 6. Tags jobs ingested during half_open trial runs for manual review.
 */
export async function ingestSource(
  sourceName: string,
  options: IngestOptions,
): Promise<IngestResult> {
  const nowMs = options.now ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();

  // 1. Check circuit breaker state
  const circuit = await checkCircuit(sourceName, options.db, nowMs);
  if (!circuit.canRun) {
    return {
      source: sourceName,
      skipped: true,
      skipReason: circuit.reason,
      fetched: 0,
      newJobs: 0,
      duplicates: 0,
      failed: 0,
      isHalfOpenTrial: false,
    };
  }

  const adapter = ALL_SOURCES[sourceName];
  if (!adapter) {
    throw new Error(`Unknown job source: '${sourceName}'`);
  }

  // 2. Fetch raw jobs
  let rawJobs;
  try {
    rawJobs = await adapter.fetch({
      userAgent: options.userAgent,
      kv: options.kv,
      secrets: options.secrets,
      fetchFn: options.fetchFn,
      delayFn: options.delayFn,
      slugs: options.slugs,
    });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    await recordRunFailure(sourceName, options.db, error, circuit.isHalfOpenTrial, nowIso);
    throw error;
  }

  // 3. Normalize & ingest
  let newJobs = 0;
  let duplicates = 0;
  let failed = 0;

  for (const raw of rawJobs) {
    try {
      const normalized = adapter.normalize(raw);

      // Extract contact email from description if not yet found
      if (!normalized.contact_email) {
        const email = extractContactEmail(normalized.description);
        if (email) {
          normalized.contact_email = email;
          normalized.contact_source = 'posting';
        }
      }

      // Compute dedupe_key = SHA256(company_normalized + normalized title + location bucket)
      const dedupeKey = await computeDedupeKey(
        normalized.company,
        normalized.title,
        normalized.location,
        normalized.remote,
      );

      // Check if job already exists in D1
      const existing = await options.db
        .prepare(`SELECT id FROM jobs WHERE dedupe_key = ?`)
        .bind(dedupeKey)
        .first<{ id: string }>();

      if (existing) {
        duplicates++;
        continue;
      }

      const jobId = crypto.randomUUID();
      const routeReason = circuit.isHalfOpenTrial ? 'half_open_trial' : null;

      await options.db
        .prepare(
          `INSERT INTO jobs (
            id, dedupe_key, source, source_kind, source_job_id,
            title, company, company_normalized, location, remote,
            salary_min, salary_max, currency, salary_raw,
            description, apply_url, contact_email, contact_source,
            posted_at, fetched_at, status, route_reason, untrusted, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          jobId,
          dedupeKey,
          normalized.source,
          normalized.source_kind,
          normalized.source_job_id,
          normalized.title,
          normalized.company,
          normalized.company_normalized,
          normalized.location,
          normalized.remote ? 1 : 0,
          normalized.salary_min,
          normalized.salary_max,
          normalized.currency,
          normalized.salary_raw,
          normalized.description,
          normalized.apply_url,
          normalized.contact_email,
          normalized.contact_source,
          normalized.posted_at,
          nowIso,
          'new',
          routeReason,
          normalized.untrusted ? 1 : 0,
          nowIso,
        )
        .run();

      newJobs++;
    } catch {
      failed++;
    }
  }

  // 4. Record per-source stats (fetched, new, duplicate, failed) in events
  const slugStats = (
    rawJobs as {
      slugStats?: { total: number; failed: number; failedSlugs: string[] };
    }
  ).slugStats;

  const runPayload: Record<string, unknown> = {
    source: sourceName,
    fetched: rawJobs.length,
    new: newJobs,
    duplicate: duplicates,
    failed,
    half_open_trial: circuit.isHalfOpenTrial,
  };

  if (slugStats) {
    runPayload.boards_total = slugStats.total;
    runPayload.boards_failed = slugStats.failed;
    runPayload.failed_boards = slugStats.failedSlugs;
  }

  await options.db
    .prepare(
      `INSERT INTO events (id, entity, entity_id, type, payload, created_at) VALUES (?, 'source', ?, 'source_run', ?, ?)`,
    )
    .bind(crypto.randomUUID(), sourceName, JSON.stringify(runPayload), nowIso)
    .run();

  // 5. Record run success
  await recordRunSuccess(sourceName, options.db, circuit.isHalfOpenTrial, nowIso);

  return {
    source: sourceName,
    skipped: false,
    fetched: rawJobs.length,
    newJobs,
    duplicates,
    failed,
    isHalfOpenTrial: circuit.isHalfOpenTrial,
    boards_total: slugStats?.total,
    boards_failed: slugStats?.failed,
    failed_boards: slugStats?.failedSlugs,
  };
}
