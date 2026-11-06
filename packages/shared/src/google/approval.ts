import type { D1LikeDatabase } from '../state-machine.js';
import { transition } from '../state-machine.js';
import type { Profile } from '../profile.js';
import { validateCoverLetter } from '../applications/validator.js';
import { isFreemailContact } from '../scoring/router.js';
import type { BulkApprovalResult } from './types.js';

interface RawAppRow {
  id: string;
  status: string;
  channel: string;
  cover_letter: string | null;
  subject: string | null;
  job_id: string;
  title: string;
  company: string;
  apply_route: string | null;
  contact_email: string | null;
  contact_source: string | null;
  route_reason: string | null;
  match_score: number | null;
}

/**
 * Individually approves an application.
 * Re-runs cover letter guardrail validator.
 * requires confirm_risk=true for items in needs_review.
 */
export async function approveApplication(options: {
  db: D1LikeDatabase;
  applicationId: string;
  profile: Profile;
  confirmRisk?: boolean | undefined;
  nowMs?: number | undefined;
}): Promise<{ success: boolean }> {
  const { db, applicationId, profile, confirmRisk = false, nowMs = Date.now() } = options;
  const nowIso = new Date(nowMs).toISOString();

  const query = `
    SELECT
      a.id, a.status, a.channel, a.cover_letter, a.subject, a.job_id,
      j.title, j.company, j.apply_route, j.contact_email, j.contact_source,
      j.route_reason, j.match_score
    FROM applications a
    JOIN jobs j ON a.job_id = j.id
    WHERE a.id = ?
  `;

  const app = await db.prepare(query).bind(applicationId).first<RawAppRow>();
  if (!app) {
    throw new Error(`Application with id '${applicationId}' not found.`);
  }

  // 1. Guardrail validation on cover letter
  const validationErrors = validateCoverLetter(app.cover_letter || '', app.subject || '', profile, {
    title: app.title,
    company: app.company,
  });

  if (validationErrors.length > 0) {
    await db
      .prepare(`UPDATE applications SET validator_errors = ?, updated_at = ? WHERE id = ?`)
      .bind(JSON.stringify(validationErrors), nowIso, applicationId)
      .run();
    throw new Error(`Cover letter validation failed: ${validationErrors.join('; ')}`);
  }

  // 2. needs_review items can only be approved with confirm_risk=true
  if (app.status === 'needs_review' && confirmRisk !== true) {
    throw new Error('needs_review application requires confirm_risk=true to approve');
  }

  // 3. Transition to approved
  await transition(db, 'application', applicationId, 'approved', 'HUMAN_APPROVAL');

  await db
    .prepare(`UPDATE applications SET validator_errors = NULL, updated_at = ? WHERE id = ?`)
    .bind(nowIso, applicationId)
    .run();

  return { success: true };
}

export interface CanBulkApproveCandidate {
  id?: string | null | undefined;
  job_id?: string | null | undefined;
  status?: string | null | undefined;
  apply_route?: string | null | undefined;
  contact_source?: string | null | undefined;
  route_reason?: string | null | undefined;
  contact_email?: string | null | undefined;
  company?: string | null | undefined;
  title?: string | null | undefined;
  cover_letter?: string | null | undefined;
  subject?: string | null | undefined;
  red_flags?: string[] | string | null | undefined;
  untrusted?: boolean | number | null | undefined;
  match_score?: number | null | undefined;
  is_on_dnc?: boolean | undefined;
}

export interface CanBulkApproveOptions {
  profile?: Profile | undefined;
  minScore?: number | undefined;
  doNotContact?: Set<string> | string[] | Array<{ value: string }> | undefined;
  isDoNotContact?: boolean | undefined;
}

/**
 * Predicate determining whether an application is eligible for bulk approval.
 * Allows an application ONLY if all hold, otherwise returns the first failing reason:
 * - status is exactly 'draft'
 * - job route is auto_email
 * - contact_source is 'posting' or 'finder'
 * - job red_flags is empty
 * - job untrusted is false
 * - job match_score >= profile.filters.min_score
 * - contact is not on do_not_contact
 * - the letter validates
 */
export function canBulkApprove(
  app: CanBulkApproveCandidate & { profile?: Profile | undefined },
  options?: CanBulkApproveOptions,
): {
  allowed: boolean;
  reason?: string;
} {
  // 1. status is exactly 'draft'
  if (app.status !== 'draft') {
    return {
      allowed: false,
      reason:
        app.status === 'needs_review'
          ? 'needs_review items cannot be bulk-approved'
          : `Only draft applications can be bulk-approved (found: ${app.status || 'unknown'})`,
    };
  }

  // 2. job route is auto_email
  if (app.apply_route !== 'auto_email') {
    return {
      allowed: false,
      reason: `Route ${app.apply_route || 'unknown'} cannot be bulk-approved`,
    };
  }

  // 3. contact_source is 'posting' or 'finder'
  if (app.contact_source === 'guessed' || app.route_reason === 'GUESSED_EMAIL') {
    return { allowed: false, reason: 'Guessed email contacts cannot be bulk-approved' };
  }
  if (app.contact_source !== 'posting' && app.contact_source !== 'finder') {
    return {
      allowed: false,
      reason: `Contact source ${app.contact_source || 'none'} cannot be bulk-approved`,
    };
  }
  if (
    app.route_reason === 'FREEMAIL_CONTACT' ||
    (app.contact_email && isFreemailContact(app.contact_email, app.company || ''))
  ) {
    return { allowed: false, reason: 'Freemail contacts cannot be bulk-approved' };
  }

  // 4. job red_flags is empty
  let redFlagsList: string[] = [];
  if (Array.isArray(app.red_flags)) {
    redFlagsList = app.red_flags;
  } else if (typeof app.red_flags === 'string' && app.red_flags.trim().length > 0) {
    try {
      const parsed = JSON.parse(app.red_flags);
      if (Array.isArray(parsed)) {
        redFlagsList = parsed;
      } else {
        redFlagsList = [app.red_flags];
      }
    } catch {
      redFlagsList = [app.red_flags];
    }
  }
  if (redFlagsList.length > 0) {
    return { allowed: false, reason: `Job has red flags: ${redFlagsList.join(', ')}` };
  }

  // 5. job untrusted is false
  if (app.untrusted) {
    return { allowed: false, reason: 'Untrusted job posting cannot be bulk-approved' };
  }

  // 6. job match_score >= profile.filters.min_score
  const profile = options?.profile ?? app.profile;
  const minScore = options?.minScore ?? profile?.filters?.min_score ?? 70;
  if (typeof app.match_score !== 'number' || app.match_score < minScore) {
    return {
      allowed: false,
      reason: `Match score (${app.match_score ?? 'null'}) is below minimum score (${minScore})`,
    };
  }

  // 7. contact is not on do_not_contact
  if (app.is_on_dnc || options?.isDoNotContact) {
    return {
      allowed: false,
      reason: `Contact '${app.contact_email || ''}' is on do_not_contact list`,
    };
  }
  if (app.contact_email && options?.doNotContact) {
    const emailLower = app.contact_email.toLowerCase().trim();
    const domainLower = emailLower.split('@')[1] ?? '';
    let isOnDnc = false;
    if (options.doNotContact instanceof Set) {
      isOnDnc = options.doNotContact.has(emailLower) || options.doNotContact.has(domainLower);
    } else if (Array.isArray(options.doNotContact)) {
      isOnDnc = options.doNotContact.some((item) => {
        const val = (typeof item === 'string' ? item : item.value).toLowerCase().trim();
        return val === emailLower || val === domainLower;
      });
    }
    if (isOnDnc) {
      return {
        allowed: false,
        reason: `Contact '${app.contact_email}' is on do_not_contact list`,
      };
    }
  }

  // 8. the letter validates
  if (!app.cover_letter || !app.cover_letter.trim()) {
    return {
      allowed: false,
      reason: 'Cover letter validation failed: Cover letter is empty',
    };
  }
  if (!app.subject || !app.subject.trim()) {
    return {
      allowed: false,
      reason: 'Cover letter validation failed: Subject is empty',
    };
  }
  if (profile) {
    const letterErrors = validateCoverLetter(
      app.cover_letter || '',
      app.subject || '',
      profile,
      {
        title: app.title || '',
        company: app.company || '',
      },
    );
    if (letterErrors.length > 0) {
      return {
        allowed: false,
        reason: `Cover letter validation failed: ${letterErrors.join('; ')}`,
      };
    }
  }

  return { allowed: true };
}

/**
 * Bulk approves multiple applications with strict constraints:
 * - Only route=auto_email and contact_source in (posting, finder)
 * - Guessed, freemail, manual_review routes and needs_review status are rejected
 * - Red flags empty, untrusted false, match_score >= min_score, not on DNC
 * - Letter validation must pass
 */
export async function bulkApproveApplications(options: {
  db: D1LikeDatabase;
  ids: string[];
  profile: Profile;
  nowMs?: number | undefined;
}): Promise<BulkApprovalResult> {
  const { db, ids, profile, nowMs = Date.now() } = options;
  const nowIso = new Date(nowMs).toISOString();

  const approved: string[] = [];
  const rejected: Array<{ id: string; reason: string }> = [];

  for (const id of ids) {
    const query = `
      SELECT
        a.id, a.status, a.channel, a.cover_letter, a.subject, a.job_id,
        j.title, j.company, j.apply_route, j.contact_email, j.contact_source,
        j.route_reason, j.match_score, j.red_flags, j.untrusted
      FROM applications a
      JOIN jobs j ON a.job_id = j.id
      WHERE a.id = ?
    `;

    const app = await db.prepare(query).bind(id).first<RawAppRow & { red_flags?: string | null; untrusted?: number | boolean | null }>();
    if (!app) {
      rejected.push({ id, reason: 'Application not found' });
      continue;
    }

    // Check DNC
    let isOnDnc = false;
    if (app.contact_email) {
      const emailLower = app.contact_email.toLowerCase().trim();
      const domainLower = emailLower.split('@')[1] ?? '';
      const dnc = await db
        .prepare(`SELECT value FROM do_not_contact WHERE lower(value) IN (?, ?)`)
        .bind(emailLower, domainLower)
        .first<{ value: string }>();
      if (dnc) {
        isOnDnc = true;
      }
    }

    // Check bulk approval predicate
    const bulkCheck = canBulkApprove(app, {
      profile,
      isDoNotContact: isOnDnc,
    });
    if (!bulkCheck.allowed) {
      if (bulkCheck.reason?.startsWith('Cover letter validation failed:')) {
        await db
          .prepare(`UPDATE applications SET validator_errors = ?, updated_at = ? WHERE id = ?`)
          .bind(JSON.stringify([bulkCheck.reason]), nowIso, id)
          .run();
      }
      rejected.push({ id, reason: bulkCheck.reason ?? 'Not eligible for bulk approval' });
      continue;
    }

    // Approve item
    try {
      await transition(db, 'application', id, 'approved', 'BULK_APPROVAL');
      await db
        .prepare(`UPDATE applications SET validator_errors = NULL, updated_at = ? WHERE id = ?`)
        .bind(nowIso, id)
        .run();
      approved.push(id);
    } catch (err) {
      rejected.push({
        id,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { approved, rejected };
}

/**
 * Checks if an application qualifies for auto-approval:
 * - auto_approve_above_score must be enabled and score >= threshold
 * - apply_route must be auto_email
 * - contact_source must be posting or finder (not guessed or freemail)
 * - stays disabled for the first 14 days after the first real send
 */
export async function checkAutoApprove(options: {
  db: D1LikeDatabase;
  profile: Profile;
  matchScore: number | null;
  applyRoute: string | null;
  contactSource: string | null;
  contactEmail: string | null;
  company: string;
  routeReason?: string | null | undefined;
  nowMs?: number | undefined;
}): Promise<{ can_auto_approve: boolean; reason?: string }> {
  const {
    db,
    profile,
    matchScore,
    applyRoute,
    contactSource,
    contactEmail,
    company,
    routeReason,
    nowMs = Date.now(),
  } = options;

  const threshold = profile.send_settings?.auto_approve_above_score;
  if (threshold === undefined || threshold <= 0) {
    return { can_auto_approve: false, reason: 'auto_approve_disabled' };
  }

  if (matchScore === null || matchScore < threshold) {
    return { can_auto_approve: false, reason: 'score_below_threshold' };
  }

  if (applyRoute !== 'auto_email') {
    return { can_auto_approve: false, reason: 'not_auto_email_route' };
  }

  if (contactSource === 'guessed' || routeReason === 'GUESSED_EMAIL') {
    return { can_auto_approve: false, reason: 'guessed_contact_email' };
  }

  if (routeReason === 'FREEMAIL_CONTACT' || isFreemailContact(contactEmail, company)) {
    return { can_auto_approve: false, reason: 'freemail_contact' };
  }

  // 14-day first-send ramp block
  const firstSendRow = await db
    .prepare(
      `SELECT MIN(sent_at) AS first_sent_at
       FROM applications
       WHERE status IN ('sent', 'bounced', 'replied', 'interview', 'rejected', 'offer')
         AND sent_at IS NOT NULL`,
    )
    .bind()
    .first<{ first_sent_at: string | null }>();

  if (!firstSendRow?.first_sent_at) {
    return {
      can_auto_approve: false,
      reason: 'auto_approve_blocked_first_14_days (no prior sends)',
    };
  }

  const firstSendTime = new Date(firstSendRow.first_sent_at).getTime();
  const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
  if (nowMs - firstSendTime < fourteenDaysMs) {
    return {
      can_auto_approve: false,
      reason: 'auto_approve_blocked_first_14_days',
    };
  }

  return { can_auto_approve: true };
}
