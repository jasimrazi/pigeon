import type { D1LikeDatabase } from '../state-machine.js';
import { transition } from '../state-machine.js';
import type { ApplicationStatus } from '../schema.js';
import { isFreemailContact } from '../scoring/router.js';

export interface MarkAppliedParams {
  db: D1LikeDatabase;
  applicationId: string;
  note?: string | undefined;
  applied_at?: string | undefined;
  nowMs?: number | undefined;
}

export interface SkipParams {
  db: D1LikeDatabase;
  applicationId: string;
  reason: string;
  nowMs?: number | undefined;
}

export interface SnoozeParams {
  db: D1LikeDatabase;
  applicationId: string;
  days: number;
  nowMs?: number | undefined;
}

export interface SendByEmailParams {
  db: D1LikeDatabase;
  applicationId: string;
  confirmRisk?: boolean | undefined;
  nowMs?: number | undefined;
}

export interface BulkManualActionParams {
  db: D1LikeDatabase;
  ids: string[];
  action: 'applied' | 'skip';
  reason?: string | undefined;
  note?: string | undefined;
  nowMs?: number | undefined;
}

export interface OutcomeParams {
  db: D1LikeDatabase;
  applicationId: string;
  status: 'replied' | 'interview' | 'rejected' | 'offer';
  nowMs?: number | undefined;
}

/**
 * Marks a manual or needs_review application as applied.
 * Idempotent: If already manual_applied, returns early without writing duplicate events.
 */
export async function markApplied(params: MarkAppliedParams): Promise<{
  success: boolean;
  already_applied?: boolean;
}> {
  const { db, applicationId, note, applied_at, nowMs } = params;
  const nowIso = new Date(nowMs ?? Date.now()).toISOString();
  const effectiveAppliedAt = applied_at ?? nowIso;

  const app = await db
    .prepare(
      `SELECT a.id, a.status, a.notes, j.company_normalized FROM applications a JOIN jobs j ON a.job_id = j.id WHERE a.id = ?`,
    )
    .bind(applicationId)
    .first<{ id: string; status: string; notes: string | null; company_normalized: string }>();

  if (!app) {
    throw new Error(`Application with id '${applicationId}' not found`);
  }

  // Idempotency: if already manual_applied, do not change state or write event
  if (app.status === 'manual_applied') {
    return { success: true, already_applied: true };
  }

  if (app.status !== 'manual_pending' && app.status !== 'needs_review') {
    throw new Error(
      `Cannot mark applied: application status is '${app.status}', expected 'manual_pending' or 'needs_review'`,
    );
  }

  // State machine transition to manual_applied
  await transition(db, 'application', applicationId, 'manual_applied', 'APPLIED_MANUALLY');

  // Update applications: set applied_at, notes, clear synced_at to flag for sheet sync
  const finalNotes = note !== undefined ? note : app.notes;
  await db
    .prepare(
      `UPDATE applications SET
         applied_at = ?,
         notes = ?,
         synced_at = null,
         updated_at = ?
       WHERE id = ?`,
    )
    .bind(effectiveAppliedAt, finalNotes, nowIso, applicationId)
    .run();

  // Upsert companies_contacted with last_channel = 'manual'
  await db
    .prepare(
      `INSERT INTO companies_contacted (company_normalized, last_contacted_at, last_channel)
       VALUES (?, ?, 'manual')
       ON CONFLICT(company_normalized) DO UPDATE SET
         last_contacted_at = excluded.last_contacted_at,
         last_channel = 'manual'`,
    )
    .bind(app.company_normalized, effectiveAppliedAt)
    .run();

  return { success: true };
}

/**
 * Skips a manual application and stores the reason.
 */
export async function skipManualApplication(params: SkipParams): Promise<{ success: boolean }> {
  const { db, applicationId, reason, nowMs } = params;
  const nowIso = new Date(nowMs ?? Date.now()).toISOString();

  const app = await db
    .prepare(`SELECT id, status, notes FROM applications WHERE id = ?`)
    .bind(applicationId)
    .first<{ id: string; status: string; notes: string | null }>();

  if (!app) {
    throw new Error(`Application with id '${applicationId}' not found`);
  }

  await transition(db, 'application', applicationId, 'manual_skipped', reason);

  await db
    .prepare(`UPDATE applications SET notes = ?, updated_at = ? WHERE id = ?`)
    .bind(reason, nowIso, applicationId)
    .run();

  return { success: true };
}

/**
 * Snoozes a manual application for N days.
 */
export async function snoozeManualApplication(params: SnoozeParams): Promise<{
  success: boolean;
  snoozed_until: string;
}> {
  const { db, applicationId, days, nowMs } = params;
  const currentMs = nowMs ?? Date.now();
  const snoozedUntil = new Date(currentMs + days * 24 * 60 * 60 * 1000).toISOString();
  const nowIso = new Date(currentMs).toISOString();

  const app = await db
    .prepare(`SELECT id FROM applications WHERE id = ?`)
    .bind(applicationId)
    .first<{ id: string }>();

  if (!app) {
    throw new Error(`Application with id '${applicationId}' not found`);
  }

  await db
    .prepare(`UPDATE applications SET snoozed_until = ?, updated_at = ? WHERE id = ?`)
    .bind(snoozedUntil, nowIso, applicationId)
    .run();

  const eventStmt = db
    .prepare(
      `INSERT INTO events (id, entity, entity_id, type, payload, created_at)
       VALUES (?, 'application', ?, 'application_snoozed', ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      applicationId,
      JSON.stringify({ days, snoozed_until: snoozedUntil }),
      nowIso,
    );

  await eventStmt.run();

  return { success: true, snoozed_until: snoozedUntil };
}

/**
 * Switches a manual application to email channel and approves it for sending.
 * Only allowed for single items with valid non-DNC contact email.
 * Requires confirm_risk=true for guessed or freemail contacts.
 */
export async function sendByEmail(params: SendByEmailParams): Promise<{ success: boolean }> {
  const { db, applicationId, confirmRisk, nowMs } = params;
  const nowIso = new Date(nowMs ?? Date.now()).toISOString();

  const app = await db
    .prepare(
      `SELECT
         a.id, a.status, a.channel,
         j.contact_email, j.contact_source, j.route_reason, j.company
       FROM applications a
       JOIN jobs j ON a.job_id = j.id
       WHERE a.id = ?`,
    )
    .bind(applicationId)
    .first<{
      id: string;
      status: ApplicationStatus;
      channel: string;
      contact_email: string | null;
      contact_source: string | null;
      route_reason: string | null;
      company: string;
    }>();

  if (!app) {
    throw new Error(`Application with id '${applicationId}' not found`);
  }

  // 1. Must have contact email
  if (!app.contact_email || typeof app.contact_email !== 'string') {
    throw new Error('Cannot send by email: job has no contact email.');
  }

  const emailLower = app.contact_email.toLowerCase().trim();
  const domainLower = emailLower.split('@')[1] ?? '';

  // 2. Check do_not_contact for email and domain
  const dncRow = await db
    .prepare(`SELECT value FROM do_not_contact WHERE lower(value) IN (?, ?)`)
    .bind(emailLower, domainLower)
    .first<{ value: string }>();

  if (dncRow) {
    throw new Error(`Cannot send by email: contact '${dncRow.value}' is on do_not_contact.`);
  }

  // 3. Guessed or Freemail contact requires confirm_risk=true
  const isGuessed = app.contact_source === 'guessed' || app.route_reason === 'GUESSED_EMAIL';
  const isFreemail =
    app.route_reason === 'FREEMAIL_CONTACT' || isFreemailContact(app.contact_email, app.company);

  if ((isGuessed || isFreemail) && confirmRisk !== true) {
    throw new Error(
      `Cannot send by email: ${isGuessed ? 'guessed' : 'freemail'} contact address requires confirm_risk=true.`,
    );
  }

  // 4. Update channel to email, transition status to approved
  await transition(db, 'application', applicationId, 'approved', 'SEND_BY_EMAIL_APPROVED');

  await db
    .prepare(`UPDATE applications SET channel = 'email', updated_at = ? WHERE id = ?`)
    .bind(nowIso, applicationId)
    .run();

  return { success: true };
}

/**
 * Bulk action for manual items: applied or skip.
 * ONLY touches items in manual_pending status.
 */
export async function bulkManualAction(params: BulkManualActionParams): Promise<{
  processed: string[];
  skipped: string[];
}> {
  const { db, ids, action, reason, note, nowMs } = params;
  const processed: string[] = [];
  const skipped: string[] = [];

  for (const id of ids) {
    const app = await db
      .prepare(`SELECT status FROM applications WHERE id = ?`)
      .bind(id)
      .first<{ status: string }>();

    if (!app || app.status !== 'manual_pending') {
      skipped.push(id);
      continue;
    }

    try {
      if (action === 'applied') {
        await markApplied({ db, applicationId: id, note, nowMs });
        processed.push(id);
      } else if (action === 'skip') {
        await skipManualApplication({
          db,
          applicationId: id,
          reason: reason ?? 'BULK_SKIPPED',
          nowMs,
        });
        processed.push(id);
      }
    } catch {
      skipped.push(id);
    }
  }

  return { processed, skipped };
}

/**
 * Records outcome for a manually applied application.
 */
export async function recordOutcome(params: OutcomeParams): Promise<{ success: boolean }> {
  const { db, applicationId, status } = params;

  await transition(db, 'application', applicationId, status, 'OUTCOME_RECORDED');

  return { success: true };
}
