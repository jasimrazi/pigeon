import type { D1LikeDatabase } from '../state-machine.js';
import { transition } from '../state-machine.js';
import type { Profile } from '../profile.js';
import type { Notifier } from '../notifier.js';
import { validateCoverLetter } from '../applications/validator.js';
import { assertSafeHeader } from './mime.js';
import { getGoogleAuthHealth, type KVLike, GoogleAuthError, setGoogleAuthHealth } from './auth.js';
import { GoogleRateLimitError, GoogleServerError, GoogleRecipientError } from './sender.js';
import type { GmailSender, SendEmailResult } from './types.js';

export interface R2LikeBucket {
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; size?: number } | null>;
}

export interface SendWorkerOptions {
  db: D1LikeDatabase;
  config: KVLike;
  resumesBucket: R2LikeBucket;
  gmailSender: GmailSender;
  profile: Profile;
  notifier?: Notifier | undefined;
  dryRun?: boolean | undefined;
  killSwitch?: boolean | undefined;
  nowMs?: number | undefined;
}

export interface ApplicationToSend {
  id: string;
  job_id: string;
  kind?: string | undefined;
  channel: string;
  status: string;
  cover_letter: string | null;
  subject: string | null;
  resume_id: string | null;
  message_id_header: string | null;
  gmail_message_id: string | null;
  gmail_thread_id: string | null;
  retry_count: number;
  title: string;
  company: string;
  company_normalized: string;
  contact_email: string | null;
}

/**
 * Calculates effective cap using the ramp formula:
 * effective_cap = min(daily_cap, ramp_base + ramp_step * days_since_first_real_send)
 * Defaults: daily_cap 20, ramp_base 5, ramp_step 2.
 */
export async function calculateEffectiveCap(options: {
  db: D1LikeDatabase;
  profile: Profile;
  nowMs?: number | undefined;
}): Promise<number> {
  const { db, profile, nowMs = Date.now() } = options;

  const dailyCap = profile.send_settings?.daily_cap ?? 20;
  const rampBase = profile.send_settings?.ramp_base ?? 5;
  const rampStep = profile.send_settings?.ramp_step ?? 2;

  // Find date of first real send
  const firstSendRow = await db
    .prepare(
      `SELECT MIN(sent_at) AS first_sent_at
       FROM applications
       WHERE status IN ('sent', 'bounced', 'replied', 'interview', 'rejected', 'offer')
         AND sent_at IS NOT NULL`,
    )
    .bind()
    .first<{ first_sent_at: string | null }>();

  let daysSinceFirstSend = 0;
  if (firstSendRow?.first_sent_at) {
    const firstSendTime = new Date(firstSendRow.first_sent_at).getTime();
    const diffMs = Math.max(0, nowMs - firstSendTime);
    daysSinceFirstSend = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  }

  const rampCap = rampBase + rampStep * daysSinceFirstSend;
  return Math.min(dailyCap, rampCap);
}

/**
 * Checks bounce brake: if more than 10% of last 20 sends bounced, halves cap (never below 3)
 * and notifies once.
 */
export async function applyBounceBrake(options: {
  db: D1LikeDatabase;
  config: KVLike;
  baseCap: number;
  notifier?: Notifier | undefined;
  nowMs?: number | undefined;
}): Promise<{ effectiveCap: number; brakeActive: boolean }> {
  const { db, config, baseCap, notifier, nowMs = Date.now() } = options;

  const { results: recentSends } = await db
    .prepare(
      `SELECT status FROM applications
       WHERE sent_at IS NOT NULL
       ORDER BY sent_at DESC
       LIMIT 20`,
    )
    .bind()
    .all<{ status: string }>();

  const total = recentSends?.length ?? 0;
  if (total === 0) {
    return { effectiveCap: baseCap, brakeActive: false };
  }

  const bounces =
    recentSends?.filter((s: { status: string }) => s.status === 'bounced').length ?? 0;
  const bounceRate = bounces / total;

  if (bounceRate > 0.1) {
    const halved = Math.max(3, Math.floor(baseCap / 2));

    // Notify once
    const alreadyNotified = await config.get('bounce_brake_notified');
    if (alreadyNotified !== 'true') {
      if (notifier) {
        await notifier.notify({
          key: 'bounce_brake_active',
          message: `Bounce brake active: ${bounces}/${total} (${Math.round(bounceRate * 100)}%) recent sends bounced. Daily cap halved from ${baseCap} to ${halved}.`,
          details: { bounces, total, bounceRate, now: new Date(nowMs).toISOString() },
        });
      }
      await config.put('bounce_brake_notified', 'true');
    }

    return { effectiveCap: halved, brakeActive: true };
  }

  // Clear bounce brake notification flag if rate falls back to normal
  await config.delete('bounce_brake_notified');
  return { effectiveCap: baseCap, brakeActive: false };
}

/**
 * Determines whether the current time is within the allowed send window (weekdays only, 09:00 - 18:00).
 */
export function isInsideSendWindow(options: { profile: Profile; nowMs?: number | undefined }): {
  inside: boolean;
  reason?: string;
  timezone: string;
} {
  const { profile, nowMs = Date.now() } = options;
  const timezone = profile.send_settings?.timezone || 'Asia/Kolkata';
  const startStr = profile.send_settings?.window?.start || '09:00';
  const endStr = profile.send_settings?.window?.end || '18:00';

  const date = new Date(nowMs);

  // Format weekday and time in target timezone
  const weekdayFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  });
  const timeFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const weekday = weekdayFormatter.format(date); // e.g. "Mon", "Sat"
  const isWeekend = weekday === 'Sat' || weekday === 'Sun';

  if (isWeekend) {
    return { inside: false, reason: 'weekend', timezone };
  }

  const timeStr = timeFormatter.format(date); // e.g. "09:30"
  if (timeStr < startStr || timeStr >= endStr) {
    return { inside: false, reason: 'outside_hours', timezone };
  }

  return { inside: true, timezone };
}

/**
 * Atomically acquires a send slot on daily_counters table using conditional UPDATE.
 * Prevents race conditions and guarantees cap is strictly enforced across concurrent workers.
 */
export async function acquireSendSlot(
  db: D1LikeDatabase,
  dateStr: string,
  effectiveCap: number,
): Promise<boolean> {
  // SQLite UPSERT with conditional WHERE clause
  const query = `
    INSERT INTO daily_counters (date, sends, bounces)
    VALUES (?, 1, 0)
    ON CONFLICT(date) DO UPDATE SET sends = sends + 1
    WHERE daily_counters.sends < ?
  `;

  const res = await db.prepare(query).bind(dateStr, effectiveCap).run();

  // D1 returns meta.changes or changes count
  const meta = res as { meta?: { changes?: number }; changes?: number };
  const changes = meta?.meta?.changes ?? meta?.changes ?? 0;

  return changes > 0;
}

/**
 * Re-validates pre-send constraints before contacting Gmail.
 */
export async function validatePreSend(options: {
  db: D1LikeDatabase;
  resumesBucket: R2LikeBucket;
  profile: Profile;
  app: ApplicationToSend;
}): Promise<{ valid: true } | { valid: false; error: string }> {
  const { db, resumesBucket, profile, app } = options;

  // 1. Status must still be approved
  if (app.status !== 'approved' && app.status !== 'sending') {
    return { valid: false, error: `Application status is '${app.status}', not approved` };
  }

  // 2. Syntactically valid recipient email
  if (!app.contact_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(app.contact_email)) {
    return { valid: false, error: `Invalid contact email: '${app.contact_email}'` };
  }

  const emailLower = app.contact_email.toLowerCase().trim();
  const domainLower = emailLower.split('@')[1] ?? '';

  // 3. Not on do_not_contact
  const dnc = await db
    .prepare(`SELECT value FROM do_not_contact WHERE lower(value) IN (?, ?)`)
    .bind(emailLower, domainLower)
    .first<{ value: string }>();

  if (dnc) {
    return { valid: false, error: `Contact '${dnc.value}' is on do_not_contact list` };
  }

  // 4. Company cooldown: not contacted in last 30 days (initial applications only)
  if (app.kind !== 'follow_up') {
    const contacted = await db
      .prepare(
        `SELECT company_normalized, last_contacted_at
         FROM companies_contacted
         WHERE company_normalized = ?`,
      )
      .bind(app.company_normalized)
      .first<{ company_normalized: string; last_contacted_at: string }>();

    if (contacted) {
      const lastContactMs = new Date(contacted.last_contacted_at).getTime();
      const cooldownMs = 30 * 24 * 60 * 60 * 1000;
      if (Date.now() - lastContactMs < cooldownMs) {
        return {
          valid: false,
          error: `Company '${app.company}' was recently contacted on ${contacted.last_contacted_at}`,
        };
      }
    }
  }

  // 5. Resume exists in R2
  if (app.resume_id) {
    const resumeRow = await db
      .prepare(`SELECT r2_key FROM resumes WHERE id = ?`)
      .bind(app.resume_id)
      .first<{ r2_key: string }>();

    if (!resumeRow) {
      return { valid: false, error: `Resume with id '${app.resume_id}' not found in database` };
    }

    const r2Obj = await resumesBucket.get(resumeRow.r2_key);
    if (!r2Obj) {
      return { valid: false, error: `Resume file '${resumeRow.r2_key}' not found in R2 storage` };
    }
  }

  // 6. Letter still passes guardrails
  const letterErrors = validateCoverLetter(app.cover_letter || '', app.subject || '', profile, {
    title: app.title,
    company: app.company,
  });
  if (letterErrors.length > 0) {
    return { valid: false, error: `Cover letter validation failed: ${letterErrors.join('; ')}` };
  }

  // 7. No CR or LF in any header value (Prevent header injection)
  try {
    assertSafeHeader('To', app.contact_email);
    assertSafeHeader('Subject', app.subject || `Application for ${app.title}`);
    assertSafeHeader('From', profile.email);
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : String(err) };
  }

  return { valid: true };
}

/**
 * Main send processor for a single application.
 */
export async function sendApplicationEmail(
  options: SendWorkerOptions & { application: ApplicationToSend },
): Promise<{ success: boolean; dryRun?: boolean; error?: string; rescheduled?: boolean }> {
  const {
    db,
    config,
    resumesBucket,
    gmailSender,
    profile,
    notifier,
    dryRun = true,
    killSwitch = false,
    nowMs = Date.now(),
    application: app,
  } = options;

  const nowIso = new Date(nowMs).toISOString();

  // 1. Safety Gate: Kill Switch
  const kvKillSwitch =
    (await config.get('kill_switch')) === 'true' ||
    (await config.get('KILL_SWITCH')) === 'true';
  if (killSwitch || kvKillSwitch) {
    return { success: false, error: 'Kill switch is active. Sending paused.' };
  }

  // 2. Safety Gate: Auth Health
  const authHealth = await getGoogleAuthHealth(config);
  if (authHealth.status !== 'ok') {
    return {
      success: false,
      error: `Google auth health is invalid: ${authHealth.reason}. Sending paused.`,
    };
  }

  // 3. Safety Gate: Send Window
  const windowCheck = isInsideSendWindow({ profile, nowMs });
  if (!windowCheck.inside) {
    // Reschedule outside window, do NOT drop
    return {
      success: false,
      rescheduled: true,
      error: `Current time is outside allowed send window (${windowCheck.reason}). Item rescheduled.`,
    };
  }

  // 4. Rate Limiting: Calculate Cap & Bounce Brake
  const baseCap = await calculateEffectiveCap({ db, profile, nowMs });
  const { effectiveCap } = await applyBounceBrake({
    db,
    config,
    baseCap,
    notifier,
    nowMs,
  });

  // Target date YYYY-MM-DD in user's timezone
  const dateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: windowCheck.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(nowMs));

  // 5. Idempotency Check: search Sent by Message-ID if message_id_header already exists
  if (app.message_id_header && !app.gmail_message_id) {
    const existing = await gmailSender.searchSentByMessageId(app.message_id_header);
    if (existing) {
      if (app.status === 'sending') {
        await transition(db, 'application', app.id, 'sent', 'IDEMPOTENT_MATCH_IN_SENT');
      }
      await db
        .prepare(
          `UPDATE applications
           SET gmail_message_id = ?, gmail_thread_id = ?, sent_at = ?, synced_at = NULL, updated_at = ?
           WHERE id = ?`,
        )
        .bind(existing.gmailMessageId, existing.gmailThreadId, nowIso, nowIso, app.id)
        .run();

      await db
        .prepare(
          `INSERT INTO companies_contacted (company_normalized, last_contacted_at, last_channel)
           VALUES (?, ?, 'email')
           ON CONFLICT(company_normalized) DO UPDATE SET
             last_contacted_at = excluded.last_contacted_at,
             last_channel = excluded.last_channel`,
        )
        .bind(app.company_normalized, nowIso)
        .run();

      return { success: true };
    }
  }

  // 6. Pre-send validation checks
  const validation = await validatePreSend({ db, resumesBucket, profile, app });
  if (!validation.valid) {
    if (app.status === 'approved') {
      await transition(db, 'application', app.id, 'sending', 'PRE_SEND_VALIDATION_FAILED');
      await transition(db, 'application', app.id, 'failed', validation.error);
    } else if (app.status === 'sending') {
      await transition(db, 'application', app.id, 'failed', validation.error);
    }
    await db
      .prepare(`UPDATE applications SET error = ?, updated_at = ? WHERE id = ?`)
      .bind(validation.error ?? 'Validation failed', nowIso, app.id)
      .run();
    return { success: false, error: validation.error };
  }

  // 7. Atomic Conditional Cap Acquisition
  const acquired = await acquireSendSlot(db, dateStr, effectiveCap);
  if (!acquired) {
    return {
      success: false,
      rescheduled: true,
      error: `Daily send cap of ${effectiveCap} reached for ${dateStr}. Item rescheduled.`,
    };
  }

  // 8. Generate Message-ID and transition approved -> sending BEFORE calling Gmail
  const messageIdHeader = app.message_id_header || `<${crypto.randomUUID()}@pigeon.local>`;

  if (app.status === 'approved') {
    await transition(db, 'application', app.id, 'sending', 'SEND_INITIATED');
  }

  await db
    .prepare(`UPDATE applications SET message_id_header = ?, updated_at = ? WHERE id = ?`)
    .bind(messageIdHeader, nowIso, app.id)
    .run();

  // Load Resume PDF bytes if present
  let resumePdfBytes: Uint8Array | undefined;
  let resumeLabel = 'Resume.pdf';
  if (app.resume_id) {
    const rRow = await db
      .prepare(`SELECT r2_key, label FROM resumes WHERE id = ?`)
      .bind(app.resume_id)
      .first<{ r2_key: string; label: string }>();

    if (rRow) {
      const file = await resumesBucket.get(rRow.r2_key);
      if (file) {
        resumePdfBytes = new Uint8Array(await file.arrayBuffer());
        resumeLabel = `${rRow.label}.pdf`;
      }
    }
  }

  // Resolve thread headers for follow-ups
  let threadId = app.gmail_thread_id || undefined;
  let inReplyTo: string | undefined;
  let references: string | undefined;

  if (app.kind === 'follow_up') {
    const initialApp = await db
      .prepare(
        `SELECT message_id_header, gmail_thread_id
         FROM applications
         WHERE job_id = ? AND kind = 'initial'`,
      )
      .bind(app.job_id)
      .first<{ message_id_header: string | null; gmail_thread_id: string | null }>();

    if (initialApp?.message_id_header) {
      inReplyTo = initialApp.message_id_header;
      references = initialApp.message_id_header;
    }
    if (initialApp?.gmail_thread_id) {
      threadId = initialApp.gmail_thread_id;
    }
  }

  // 9. DRY RUN Check
  if (dryRun) {
    // Write would-be email to events table; do NOT call Gmail; do NOT mark as sent
    const dryRunPayload = {
      headers: {
        From: profile.email,
        To: app.contact_email,
        Subject: app.subject || `Application for ${app.title}`,
        'Message-ID': messageIdHeader,
        ...(inReplyTo ? { 'In-Reply-To': inReplyTo } : {}),
        ...(references ? { References: references } : {}),
      },
      threadId,
      body: app.cover_letter,
      attachment: {
        name: resumeLabel,
        size: resumePdfBytes?.length ?? 0,
      },
    };

    await db
      .prepare(
        `INSERT INTO events (id, entity, entity_id, type, payload, created_at)
         VALUES (?, 'application', ?, 'email_dry_run', ?, ?)`,
      )
      .bind(crypto.randomUUID(), app.id, JSON.stringify(dryRunPayload), nowIso)
      .run();

    // Revert status from sending back to approved for future real run
    await db
      .prepare(`UPDATE applications SET status = 'approved', updated_at = ? WHERE id = ?`)
      .bind(nowIso, app.id)
      .run();

    return { success: true, dryRun: true };
  }

  // 10. Real Send via Gmail
  try {
    const sendResult: SendEmailResult = await gmailSender.send({
      fromEmail: profile.email,
      fromName: profile.name,
      recipientEmail: app.contact_email || '',
      subject: app.subject || `Application for ${app.title}`,
      bodyText: app.cover_letter || '',
      messageIdHeader,
      resumePdfBytes,
      resumeFileName: resumeLabel,
      threadId,
      inReplyTo,
      references,
    });

    // Success: sending -> sent
    await transition(db, 'application', app.id, 'sent', 'EMAIL_SENT_SUCCESS');

    await db
      .prepare(
        `UPDATE applications
         SET gmail_message_id = ?, gmail_thread_id = ?, sent_at = ?, synced_at = NULL, updated_at = ?
         WHERE id = ?`,
      )
      .bind(sendResult.gmailMessageId, sendResult.gmailThreadId, nowIso, nowIso, app.id)
      .run();

    // Record company contacted
    await db
      .prepare(
        `INSERT INTO companies_contacted (company_normalized, last_contacted_at, last_channel)
         VALUES (?, ?, 'email')
         ON CONFLICT(company_normalized) DO UPDATE SET
           last_contacted_at = excluded.last_contacted_at,
           last_channel = excluded.last_channel`,
      )
      .bind(app.company_normalized, nowIso)
      .run();

    return { success: true };
  } catch (err) {
    if (err instanceof GoogleRateLimitError || err instanceof GoogleServerError) {
      // 429 or 5xx: retryable with backoff, increment retry_count
      const newRetries = (app.retry_count ?? 0) + 1;
      if (newRetries >= 3) {
        await transition(
          db,
          'application',
          app.id,
          'failed',
          `Max retries exceeded: ${err.message}`,
        );
        await db
          .prepare(
            `UPDATE applications SET error = ?, retry_count = ?, updated_at = ? WHERE id = ?`,
          )
          .bind(err.message, newRetries, nowIso, app.id)
          .run();
      } else {
        // Backoff: revert to approved with incremented retry_count
        await db
          .prepare(
            `UPDATE applications SET status = 'approved', retry_count = ?, updated_at = ? WHERE id = ?`,
          )
          .bind(newRetries, nowIso, app.id)
          .run();
      }
      return { success: false, error: err.message };
    }

    if (err instanceof GoogleRecipientError) {
      // Permanent 4xx recipient error: fail immediately without retry
      await transition(db, 'application', app.id, 'failed', err.message);
      await db
        .prepare(`UPDATE applications SET error = ?, updated_at = ? WHERE id = ?`)
        .bind(err.message, nowIso, app.id)
        .run();
      return { success: false, error: err.message };
    }

    if (
      err instanceof GoogleAuthError ||
      (err instanceof Error && err.name === 'GoogleAuthError')
    ) {
      // Auth error: set health invalid
      await setGoogleAuthHealth({
        config,
        status: 'invalid',
        reason: err.message,
        notifier,
      });
      // Revert to approved so it can send once auth is restored
      await db
        .prepare(`UPDATE applications SET status = 'approved', updated_at = ? WHERE id = ?`)
        .bind(nowIso, app.id)
        .run();
      return { success: false, error: err.message };
    }

    // Generic failure: transition to failed
    await transition(
      db,
      'application',
      app.id,
      'failed',
      err instanceof Error ? err.message : String(err),
    );
    await db
      .prepare(`UPDATE applications SET error = ?, updated_at = ? WHERE id = ?`)
      .bind(err instanceof Error ? err.message : String(err), nowIso, app.id)
      .run();

    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
