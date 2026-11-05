import type { D1LikeDatabase } from '../state-machine.js';
import type { Notifier } from '../notifier.js';
import type { PortalType } from './types.js';

export interface ParserHealthResult {
  isSuspect: boolean;
  streak: number;
  portalUntrusted: boolean;
}

export async function handleParserHealth(options: {
  db: D1LikeDatabase;
  portal: PortalType;
  jobsCount: number;
  notifier?: Notifier | undefined;
  nowIso?: string | undefined;
}): Promise<ParserHealthResult> {
  const { db, portal, jobsCount, notifier } = options;
  const nowIso = options.nowIso || new Date().toISOString();

  // Read current source state
  const row = await db
    .prepare(`SELECT parser_empty_streak, untrusted FROM source_state WHERE source = ?`)
    .bind(portal)
    .first<{ parser_empty_streak: number; untrusted: number }>();

  const currentStreak = row?.parser_empty_streak ?? 0;

  if (jobsCount === 0) {
    const newStreak = currentStreak + 1;
    const becomesSuspect = newStreak === 3;
    const newUntrusted = newStreak >= 3 ? 1 : 0;

    // 1. Record parser_empty event
    const emptyEventId = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO events (id, entity, entity_id, type, payload, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        emptyEventId,
        'source',
        portal,
        'parser_empty',
        JSON.stringify({ portal, streak: newStreak }),
        nowIso,
      )
      .run();

    // 2. If streak reaches exactly 3, write parser_suspect event and notify once
    if (becomesSuspect) {
      const suspectEventId = crypto.randomUUID();
      await db
        .prepare(
          `INSERT INTO events (id, entity, entity_id, type, payload, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          suspectEventId,
          'source',
          portal,
          'parser_suspect',
          JSON.stringify({
            portal,
            streak: newStreak,
            message: '3 consecutive empty parses',
          }),
          nowIso,
        )
        .run();

      if (notifier) {
        await notifier.notify({
          key: `parser_suspect:${portal}`,
          message: `Parser suspect for portal ${portal}: 3 consecutive empty parses`,
          details: { portal, streak: newStreak },
        });
      }
    }

    // 3. Update source_state
    await db
      .prepare(
        `INSERT INTO source_state (source, parser_empty_streak, untrusted, last_run_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(source) DO UPDATE SET
           parser_empty_streak = ?,
           untrusted = ?,
           last_run_at = ?`,
      )
      .bind(portal, newStreak, newUntrusted, nowIso, newStreak, newUntrusted, nowIso)
      .run();

    return {
      isSuspect: newStreak >= 3,
      streak: newStreak,
      portalUntrusted: newStreak >= 3,
    };
  } else {
    // Successful parse with > 0 jobs:
    // Reset streak and untrusted status in source_state
    await db
      .prepare(
        `INSERT INTO source_state (source, parser_empty_streak, untrusted, last_run_at, last_success_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(source) DO UPDATE SET
           parser_empty_streak = 0,
           untrusted = 0,
           last_run_at = ?,
           last_success_at = ?`,
      )
      .bind(portal, 0, 0, nowIso, nowIso, nowIso, nowIso)
      .run();

    return {
      isSuspect: false,
      streak: 0,
      portalUntrusted: false,
    };
  }
}
