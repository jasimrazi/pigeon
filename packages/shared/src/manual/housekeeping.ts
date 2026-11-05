import type { D1LikeDatabase } from '../state-machine.js';
import { transition } from '../state-machine.js';
import type { Notifier } from '../notifier.js';
import { getManualQueue } from './queue.js';

export interface ExpiryResult {
  expired_count: number;
  expired_ids: string[];
}

/**
 * Housekeeping job: moves manual_pending applications older than 30 days
 * to manual_skipped with reason 'EXPIRED'.
 */
export async function expireStaleManualPending(
  db: D1LikeDatabase,
  nowMs?: number,
): Promise<ExpiryResult> {
  const currentMs = nowMs ?? Date.now();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  const cutoffIso = new Date(currentMs - thirtyDaysMs).toISOString();
  const nowIso = new Date(currentMs).toISOString();

  // Find all manual_pending applications where updated_at < cutoffIso
  const { results: staleItems } = await db
    .prepare(
      `SELECT id FROM applications
       WHERE status = 'manual_pending'
         AND updated_at < ?`,
    )
    .bind(cutoffIso)
    .all<{ id: string }>();

  const expiredIds: string[] = [];

  for (const item of staleItems ?? []) {
    try {
      await transition(db, 'application', item.id, 'manual_skipped', 'EXPIRED');
      await db
        .prepare(`UPDATE applications SET notes = ?, updated_at = ? WHERE id = ?`)
        .bind('EXPIRED', nowIso, item.id)
        .run();
      expiredIds.push(item.id);
    } catch (err) {
      console.error(`Failed to expire application ${item.id}:`, err);
    }
  }

  return {
    expired_count: expiredIds.length,
    expired_ids: expiredIds,
  };
}

/**
 * Daily digest notification through the Notifier interface.
 * Reports count waiting and the top 5 items by match score.
 */
export async function sendManualDailyDigest(options: {
  db: D1LikeDatabase;
  notifier: Notifier;
  nowMs?: number;
}): Promise<{
  waiting_count: number;
  top_5: Array<{ id: string; title: string; company: string; score: number | null }>;
}> {
  const { db, notifier, nowMs } = options;
  const currentMs = nowMs ?? Date.now();
  const dateStr = new Date(currentMs).toISOString().split('T')[0] ?? 'today';

  const queueRes = await getManualQueue(db, { nowMs: currentMs });
  const waitingCount = queueRes.counts.total;

  const top5 = queueRes.items.slice(0, 5).map((item) => ({
    id: item.application_id,
    title: item.title,
    company: item.company,
    score: item.match_score,
  }));

  const lines = [
    `Manual Apply Queue Digest for ${dateStr}:`,
    `Total active applications waiting: ${waitingCount}`,
    '',
    'Top focus items:',
    ...top5.map(
      (j, idx) =>
        `${idx + 1}. [Score: ${j.score ?? 'N/A'}] ${j.title} at ${j.company} (/api/manual/${j.id}/kit)`,
    ),
  ];

  await notifier.notify({
    key: `manual_queue_digest:${dateStr}`,
    message: lines.join('\n'),
    details: {
      date: dateStr,
      waiting_count: waitingCount,
      top_5: top5,
    },
  });

  return {
    waiting_count: waitingCount,
    top_5: top5,
  };
}
