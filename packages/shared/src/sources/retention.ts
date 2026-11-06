import { logger } from '../logger.js';
import type { D1LikeDatabase } from '../state-machine.js';

export interface PurgeRetentionOptions {
  db: D1LikeDatabase;
  cutoffDays?: number;
  now?: Date;
}

export interface PurgeRetentionResult {
  purgedCount: number;
  cutoffDate: string;
}

export const PURGED_DESCRIPTION_PLACEHOLDER = '[Purged by retention policy]';

/**
 * Purges job descriptions older than `cutoffDays` (default 90) for jobs that were never applied to.
 * Preserves job descriptions, applications, cover letters, and events for all applied jobs.
 */
export async function purgeExpiredJobDescriptions(
  options: PurgeRetentionOptions,
): Promise<PurgeRetentionResult> {
  const { db, cutoffDays = 90, now = new Date() } = options;
  const cutoffTime = new Date(now.getTime() - cutoffDays * 24 * 60 * 60 * 1000);
  const cutoffIso = cutoffTime.toISOString();
  const nowIso = now.toISOString();

  const result = await db
    .prepare(
      `UPDATE jobs
       SET description = ?, updated_at = ?
       WHERE fetched_at < ?
         AND id NOT IN (SELECT job_id FROM applications)
         AND description != ?`,
    )
    .bind(PURGED_DESCRIPTION_PLACEHOLDER, nowIso, cutoffIso, PURGED_DESCRIPTION_PLACEHOLDER)
    .run();

  const purgedCount = (result as { meta?: { changes?: number } })?.meta?.changes ?? 0;

  if (purgedCount > 0) {
    try {
      await db
        .prepare(
          `INSERT INTO events (id, entity, entity_id, type, payload, created_at)
           VALUES (?, 'retention', 'jobs', 'retention_purged', ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          JSON.stringify({
            purged_count: purgedCount,
            cutoff_days: cutoffDays,
            cutoff_date: cutoffIso,
          }),
          nowIso,
        )
        .run();
    } catch (err) {
      logger.error('Failed to write retention event to events table', err);
    }
  }

  return {
    purgedCount,
    cutoffDate: cutoffIso,
  };
}
