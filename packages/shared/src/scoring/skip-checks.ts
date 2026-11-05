import type { D1LikeDatabase } from '../state-machine.js';
import { normalizeCompanyName } from '../sources/dedupe.js';

export interface SkippableJob {
  company: string;
  company_normalized?: string | undefined;
  contact_email?: string | null | undefined;
}

export interface SkipCheckResult {
  skipped: boolean;
  reason?: 'DNC' | 'RECENT_CONTACT' | undefined;
}

/**
 * Step 2: Evaluates Do-Not-Contact and Recent Contact skip checks against D1.
 * - Contact email or domain in do_not_contact -> skipped, reason DNC
 * - Company in companies_contacted within 90 days -> skipped, reason RECENT_CONTACT
 */
export async function evaluateSkipChecks(
  job: SkippableJob,
  db: D1LikeDatabase,
  nowMs: number = Date.now(),
): Promise<SkipCheckResult> {
  const compNorm = job.company_normalized || normalizeCompanyName(job.company);

  // 1. Check Do-Not-Contact table
  if (job.contact_email) {
    const email = job.contact_email.toLowerCase().trim();
    const atIndex = email.lastIndexOf('@');
    const domain = atIndex !== -1 ? email.slice(atIndex + 1) : '';

    const dncRow = await db
      .prepare(
        `SELECT value FROM do_not_contact WHERE LOWER(value) = ? OR LOWER(value) = ? LIMIT 1`,
      )
      .bind(email, domain)
      .first<{ value: string }>();

    if (dncRow) {
      return { skipped: true, reason: 'DNC' };
    }
  }

  // 2. Check Companies Contacted within 90 days
  if (compNorm) {
    const contactRow = await db
      .prepare(
        `SELECT company_normalized, last_contacted_at FROM companies_contacted WHERE company_normalized = ? LIMIT 1`,
      )
      .bind(compNorm)
      .first<{ company_normalized: string; last_contacted_at: string }>();

    if (contactRow?.last_contacted_at) {
      const lastTime = new Date(contactRow.last_contacted_at).getTime();
      const diffDays = (nowMs - lastTime) / (1000 * 60 * 60 * 24);

      if (diffDays < 90) {
        return { skipped: true, reason: 'RECENT_CONTACT' };
      }
    }
  }

  return { skipped: false };
}
