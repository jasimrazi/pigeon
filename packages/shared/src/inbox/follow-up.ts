import type { Profile } from '../profile.js';
import type { FollowUpOptions, FollowUpResult } from './types.js';

/**
 * Adds N business days (excluding Saturdays and Sundays) to a starting date in UTC.
 */
export function addBusinessDays(startDate: Date, days: number): Date {
  const result = new Date(startDate.getTime());
  let added = 0;
  while (added < days) {
    result.setUTCDate(result.getUTCDate() + 1);
    const dayOfWeek = result.getUTCDay();
    // 0 = Sunday, 6 = Saturday
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      added++;
    }
  }
  return result;
}

/**
 * Checks whether at least `requiredDays` business days have elapsed between `startDate` and `now`.
 */
export function hasElapsedBusinessDays(startDate: Date, requiredDays: number, now: Date): boolean {
  const target = addBusinessDays(startDate, requiredDays);
  return now.getTime() >= target.getTime();
}

/**
 * Generates a grounded, guardrail-compliant follow-up letter (150-250 words)
 * signed with profile.name.
 */
export function generateFollowUpLetter(
  profile: Profile,
  jobTitle: string,
  company: string,
): string {
  const profileName = profile.name || 'Candidate';
  const skillsList =
    profile.skills && profile.skills.length > 0
      ? profile.skills.slice(0, 3).join(', ')
      : 'software engineering';

  return `Dear Hiring Team at ${company},

I hope this note finds you well. I am following up on the application I submitted last week for the ${jobTitle} position at ${company}. I wanted to reiterate my strong enthusiasm for this role and express my continued excitement about the opportunity to contribute to ${company}'s ongoing engineering initiatives.

With my background in ${skillsList}, I am eager to help your team build resilient, high-performance systems and solve challenging platform problems. I understand that reviewing candidates requires considerable time and effort, and I appreciate your attention and diligence throughout the recruitment process.

I would welcome the opportunity to speak with you or a member of the engineering team to discuss how my technical experience directly aligns with your goals for ${company}. Please let me know if you would like any additional materials, work samples, or architectural notes from my side.

Thank you very much for your time and consideration.

Warm regards,
${profileName}`;
}

interface InitialApplicationCandidate {
  id: string;
  job_id: string;
  channel: string;
  kind: string;
  status: string;
  sent_at: string;
  subject: string | null;
  cover_letter: string | null;
  resume_id: string | null;
  message_id_header: string | null;
  gmail_thread_id: string | null;
  follow_up_count: number;
  title: string;
  company: string;
}

/**
 * Scans sent initial email applications with no replies.
 * If 6 business days have passed and follow_up_count < maxFollowUps,
 * creates ONE follow-up application (kind=follow_up) in 'draft' status for approval.
 */
export async function createPendingFollowUps(options: FollowUpOptions): Promise<FollowUpResult> {
  const { db, profile, nowMs = Date.now(), businessDaysThreshold = 6, maxFollowUps = 1 } = options;

  const now = new Date(nowMs);
  const nowIso = now.toISOString();

  // Find initial applications sent by email with no reply, not bounced, and follow_up_count < maxFollowUps
  const query = `
    SELECT
      a.id, a.job_id, a.channel, a.kind, a.status, a.sent_at, a.subject, a.cover_letter,
      a.resume_id, a.message_id_header, a.gmail_thread_id, a.follow_up_count,
      j.title, j.company
    FROM applications a
    JOIN jobs j ON a.job_id = j.id
    WHERE a.channel = 'email'
      AND a.kind = 'initial'
      AND a.status = 'sent'
      AND a.follow_up_count < ?
      AND a.sent_at IS NOT NULL
  `;

  const { results: rawCandidates } = await db
    .prepare(query)
    .bind(maxFollowUps)
    .all<InitialApplicationCandidate>();

  const candidates = rawCandidates || [];
  const createdIds: string[] = [];

  for (const app of candidates) {
    const sentDate = new Date(app.sent_at);
    if (!hasElapsedBusinessDays(sentDate, businessDaysThreshold, now)) {
      continue;
    }

    // Double check if a follow-up already exists for this job_id
    const existingFollowUp = await db
      .prepare(`SELECT id FROM applications WHERE job_id = ? AND kind = 'follow_up'`)
      .bind(app.job_id)
      .first<{ id: string }>();

    if (existingFollowUp) {
      // Already has a follow-up, ensure follow_up_count is updated and skip
      if (app.follow_up_count < 1) {
        await db
          .prepare(`UPDATE applications SET follow_up_count = 1, updated_at = ? WHERE id = ?`)
          .bind(nowIso, app.id)
          .run();
      }
      continue;
    }

    const followUpId = crypto.randomUUID();
    const followUpSubject = (app.subject || `Application for ${app.title}`).startsWith('Re:')
      ? app.subject || `Application for ${app.title}`
      : `Re: ${app.subject || `Application for ${app.title}`}`;

    const followUpBody = generateFollowUpLetter(profile, app.title, app.company);
    const followUpMessageId = `<${crypto.randomUUID()}@pigeon.local>`;

    const notesMeta = JSON.stringify({
      in_reply_to: app.message_id_header,
      references: app.message_id_header,
      parent_application_id: app.id,
    });

    // 1. Create follow-up in draft status
    await db
      .prepare(
        `INSERT INTO applications (
          id, job_id, kind, channel, status, resume_id, cover_letter, subject,
          message_id_header, gmail_thread_id, follow_up_count, notes, updated_at
        ) VALUES (?, ?, 'follow_up', 'email', 'draft', ?, ?, ?, ?, ?, 0, ?, ?)`,
      )
      .bind(
        followUpId,
        app.job_id,
        app.resume_id,
        followUpBody,
        followUpSubject,
        followUpMessageId,
        app.gmail_thread_id,
        notesMeta,
        nowIso,
      )
      .run();

    // 2. Increment follow_up_count on the initial application
    await db
      .prepare(
        `UPDATE applications
         SET follow_up_count = follow_up_count + 1, updated_at = ?
         WHERE id = ?`,
      )
      .bind(nowIso, app.id)
      .run();

    // 3. Emit event
    await db
      .prepare(
        `INSERT INTO events (id, entity, entity_id, type, payload, created_at)
         VALUES (?, 'application', ?, 'follow_up_created', ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        followUpId,
        JSON.stringify({
          initial_application_id: app.id,
          job_id: app.job_id,
          company: app.company,
          title: app.title,
        }),
        nowIso,
      )
      .run();

    createdIds.push(followUpId);
  }

  return {
    createdCount: createdIds.length,
    applicationIds: createdIds,
  };
}
