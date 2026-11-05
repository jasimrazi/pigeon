import { getGoogleAuthHealth, KV_KEYS } from '../google/auth.js';
import { formatApplicationRow } from './sanitizer.js';
import type { ApplicationToSync, SyncOptions, SyncResult } from './types.js';

/**
 * One-way sync from D1 applications to Google Sheets.
 *
 * Requirements:
 * - Checks auth health and automatically pauses when invalid.
 * - Selects applications where updated_at > synced_at (or synced_at IS NULL).
 * - Upserts rows keyed by Application ID (updating existing rows in place or appending).
 * - Writes every cell as plain text (RAW) and prevents formula injection.
 * - Idempotent: running twice makes zero calls on the second run.
 * - Respects batch size limits and handles 429 backoff.
 * - Leaves records pending on failure, allowing recovery on a subsequent run.
 * - Never blocks calling worker on failure.
 */
export async function syncApplicationsToSheet(options: SyncOptions): Promise<SyncResult> {
  const {
    db,
    config,
    sheetsClient,
    tabName = 'Applications',
    maxBatchSize = 50,
    notifier,
  } = options;

  // 1. Auth Health Check: pause automatically while invalid
  const health = await getGoogleAuthHealth(config);
  if (health.status === 'invalid') {
    return {
      success: false,
      paused: true,
      reason: `auth_invalid: ${health.reason || 'unauthorized'}`,
      syncedCount: 0,
    };
  }

  // 2. Select pending applications from D1: updated_at > synced_at or synced_at IS NULL
  const query = `
    SELECT
      a.id, a.job_id, a.kind, a.channel, a.resume_id, a.status,
      a.applied_at, a.sent_at, a.scheduled_at, a.updated_at, a.notes,
      j.title, j.company, j.source, j.apply_url, j.location,
      j.salary_raw, j.salary_min, j.salary_max, j.currency,
      j.contact_email, j.match_score, j.route_reason,
      r.label AS resume_label
    FROM applications a
    JOIN jobs j ON a.job_id = j.id
    LEFT JOIN resumes r ON a.resume_id = r.id
    WHERE a.synced_at IS NULL OR a.updated_at > a.synced_at
    ORDER BY a.updated_at ASC
  `;

  const { results: rawApps } = await db.prepare(query).bind().all<ApplicationToSync>();

  const appsToSync = rawApps || [];
  if (appsToSync.length === 0) {
    // 0 applications pending -> zero sheets calls made
    return {
      success: true,
      syncedCount: 0,
    };
  }

  // 3. Resolve Spreadsheet ID
  const configuredSpreadsheetId =
    options.spreadsheetId || (await config.get(KV_KEYS.SPREADSHEET_ID)) || undefined;

  let spreadsheetId: string;
  try {
    const sheetMeta = await sheetsClient.ensureSheet({
      spreadsheetId: configuredSpreadsheetId,
      tabName,
    });
    spreadsheetId = sheetMeta.spreadsheetId;

    if (sheetMeta.created || (!configuredSpreadsheetId && spreadsheetId)) {
      await config.put(KV_KEYS.SPREADSHEET_ID, spreadsheetId);
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await logSyncFailure(db, errMsg, notifier);
    return {
      success: false,
      syncedCount: 0,
      error: `Failed to ensure sheet: ${errMsg}`,
    };
  }

  // 4. Read existing Application IDs from Column A
  let colA: string[] = [];
  try {
    colA = await sheetsClient.readRowKeys({
      spreadsheetId,
      range: `${tabName}!A:A`,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await logSyncFailure(db, errMsg, notifier);
    return {
      success: false,
      syncedCount: 0,
      error: `Failed to read row keys: ${errMsg}`,
    };
  }

  const existingRowMap = new Map<string, number>();
  for (let i = 1; i < colA.length; i++) {
    const id = colA[i];
    if (id) {
      existingRowMap.set(id, i + 1); // 1-based row index
    }
  }

  let currentMaxRow = Math.max(1, colA.length);

  // 5. Prepare upsert operations
  const updates: Array<{
    range: string;
    values: Array<Array<string | number>>;
    appId: string;
  }> = [];

  for (const app of appsToSync) {
    let targetRowNumber: number;
    const existingRow = existingRowMap.get(app.id);
    if (existingRow !== undefined) {
      // Existing row: update in place
      targetRowNumber = existingRow;
    } else {
      // New row: append to next available row
      currentMaxRow++;
      targetRowNumber = currentMaxRow;
      existingRowMap.set(app.id, targetRowNumber);
    }

    const range = `${tabName}!A${targetRowNumber}:Q${targetRowNumber}`;
    const formattedValues = formatApplicationRow(app);
    updates.push({
      range,
      values: [formattedValues],
      appId: app.id,
    });
  }

  // 6. Batch writes respecting maxBatchSize
  let totalSynced = 0;
  const nowIso = new Date(options.nowMs || Date.now()).toISOString();

  for (let i = 0; i < updates.length; i += maxBatchSize) {
    const batch = updates.slice(i, i + maxBatchSize);
    const data = batch.map((b) => ({ range: b.range, values: b.values }));

    try {
      await sheetsClient.batchUpdateValues({
        spreadsheetId,
        data,
        valueInputOption: 'RAW',
      });

      // Update synced_at in D1 ONLY after success
      for (const b of batch) {
        await db
          .prepare(`UPDATE applications SET synced_at = ? WHERE id = ?`)
          .bind(nowIso, b.appId)
          .run();
      }

      totalSynced += batch.length;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await logSyncFailure(db, errMsg, notifier);

      // Remaining rows and current batch remain pending for next run
      return {
        success: false,
        syncedCount: totalSynced,
        error: errMsg,
      };
    }
  }

  return {
    success: true,
    syncedCount: totalSynced,
  };
}

async function logSyncFailure(
  db: SyncOptions['db'],
  error: string,
  notifier?: SyncOptions['notifier'],
): Promise<void> {
  try {
    const nowIso = new Date().toISOString();
    await db
      .prepare(
        `INSERT INTO events (id, entity, entity_id, type, payload, created_at)
         VALUES (?, 'sheet_sync', 'system', 'sheet_sync_failed', ?, ?)`,
      )
      .bind(crypto.randomUUID(), JSON.stringify({ error, timestamp: nowIso }), nowIso)
      .run();

    if (notifier) {
      await notifier.notify({
        key: 'sheet_sync_failed',
        message: `Google Sheets sync failed: ${error}`,
      });
    }
  } catch (logErr) {
    console.error('Failed to log sheet_sync_failed event:', logErr);
  }
}
