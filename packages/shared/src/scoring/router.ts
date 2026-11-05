import type { JobApplyRoute, JobSourceKind, JobContactSource } from '../schema.js';
import { normalizeCompanyName } from '../sources/dedupe.js';

export const FREEMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.in',
  'ymail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'proton.me',
  'protonmail.com',
  'rediffmail.com',
  'icloud.com',
  'mail.com',
  'aol.com',
]);

export interface RoutableJob {
  source_kind: JobSourceKind;
  contact_source?: JobContactSource | null | undefined;
  contact_email?: string | null | undefined;
  red_flags?: string[] | string | null | undefined;
  scorer_failed?: boolean | number | null | undefined;
  untrusted?: boolean | number | null | undefined;
  company: string;
  company_normalized?: string | undefined;
}

export interface RoutingDecision {
  route: JobApplyRoute;
  reason:
    | 'PORTAL_NO_EMAIL'
    | 'NO_EMAIL_FORM'
    | 'RED_FLAGS'
    | 'SCORER_FAILED'
    | 'SOURCE_UNTRUSTED'
    | 'GUESSED_EMAIL'
    | 'FREEMAIL_CONTACT'
    | 'OK';
}

/**
 * Checks whether an email address belongs to a freemail provider and does not match the company name.
 */
export function isFreemailContact(
  contactEmail: string | null | undefined,
  company: string,
  companyNormalized?: string,
): boolean {
  if (!contactEmail) return false;
  const cleanEmail = contactEmail.toLowerCase().trim();
  const atIndex = cleanEmail.lastIndexOf('@');
  if (atIndex === -1) return false;
  const domain = cleanEmail.slice(atIndex + 1);

  if (!FREEMAIL_DOMAINS.has(domain)) {
    return false;
  }

  // Check if the domain matches the company (e.g. if company itself is Google/Proton)
  const normCompany = (companyNormalized || normalizeCompanyName(company)).replace(/\s+/g, '');
  const domainBase = domain.split('.')[0] ?? '';

  if (normCompany && domainBase && normCompany.includes(domainBase)) {
    return false;
  }

  return true;
}

/**
 * Step 5: Routes each job based on strict first-match-wins order:
 * 1. source_kind=alert_email -> manual_portal, PORTAL_NO_EMAIL
 * 2. contact_source=none -> manual_portal, NO_EMAIL_FORM
 * 3. any red_flags -> manual_review, RED_FLAGS
 * 4. scorer_failed -> manual_review, SCORER_FAILED
 * 5. untrusted=true -> manual_review, SOURCE_UNTRUSTED
 * 6. contact_source=guessed -> manual_review, GUESSED_EMAIL
 * 7. freemail contact domain that does not match company -> manual_review, FREEMAIL_CONTACT
 * 8. otherwise -> auto_email, OK
 */
export function routeJob(job: RoutableJob): RoutingDecision {
  // 1. source_kind=alert_email -> manual_portal, PORTAL_NO_EMAIL
  if (job.source_kind === 'alert_email') {
    return { route: 'manual_portal', reason: 'PORTAL_NO_EMAIL' };
  }

  // 2. contact_source=none (or missing) -> manual_portal, NO_EMAIL_FORM
  if (!job.contact_source || job.contact_source === 'none') {
    return { route: 'manual_portal', reason: 'NO_EMAIL_FORM' };
  }

  // 3. any red_flags -> manual_review, RED_FLAGS
  const redFlagsArray = Array.isArray(job.red_flags)
    ? job.red_flags
    : typeof job.red_flags === 'string' && job.red_flags.trim().length > 0
      ? JSON.parse(job.red_flags)
      : [];

  if (redFlagsArray && redFlagsArray.length > 0) {
    return { route: 'manual_review', reason: 'RED_FLAGS' };
  }

  // 4. scorer_failed -> manual_review, SCORER_FAILED
  if (job.scorer_failed === true || job.scorer_failed === 1) {
    return { route: 'manual_review', reason: 'SCORER_FAILED' };
  }

  // 5. untrusted=true (source was half-open or untrusted) -> manual_review, SOURCE_UNTRUSTED
  if (job.untrusted === true || job.untrusted === 1) {
    return { route: 'manual_review', reason: 'SOURCE_UNTRUSTED' };
  }

  // 6. contact_source=guessed -> manual_review, GUESSED_EMAIL
  if (job.contact_source === 'guessed') {
    return { route: 'manual_review', reason: 'GUESSED_EMAIL' };
  }

  // 7. Freemail contact domain that does not match company -> manual_review, FREEMAIL_CONTACT
  if (isFreemailContact(job.contact_email, job.company, job.company_normalized)) {
    return { route: 'manual_review', reason: 'FREEMAIL_CONTACT' };
  }

  // 8. Otherwise -> auto_email, OK
  return { route: 'auto_email', reason: 'OK' };
}
