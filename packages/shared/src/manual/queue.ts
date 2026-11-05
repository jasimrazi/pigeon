import type { D1LikeDatabase } from '../state-machine.js';
import type { Profile } from '../profile.js';
import { ProfileSchema } from '../profile.js';
import {
  explainRouteReason,
  type ManualKit,
  type ManualQueueFilters,
  type ManualQueueItem,
  type ManualQueueResponse,
} from './types.js';

interface RawQueueRow {
  application_id: string;
  job_id: string;
  channel: string;
  status: string;
  notes: string | null;
  validator_errors: string | null;
  snoozed_until: string | null;
  title: string;
  company: string;
  company_normalized: string;
  source: string;
  location: string | null;
  remote: number | boolean | null;
  salary_raw: string | null;
  salary_min: number | null;
  salary_max: number | null;
  currency: string | null;
  match_score: number | null;
  apply_route: string | null;
  route_reason: string | null;
  untrusted: number | boolean | null;
  posted_at: string | null;
  fetched_at: string;
  applied_count: number;
}

export async function getManualQueue(
  db: D1LikeDatabase,
  options?: {
    filters?: ManualQueueFilters | undefined;
    profile?: Profile | undefined;
    nowMs?: number | undefined;
  },
): Promise<ManualQueueResponse> {
  const nowMs = options?.nowMs ?? Date.now();
  const filters = options?.filters ?? {};

  // 1. Fetch Profile for manual_daily_target preference
  let profile = options?.profile;
  if (!profile) {
    const profileRow = await db
      .prepare(`SELECT data FROM profile WHERE id = ?`)
      .bind('default')
      .first<{ data: string }>();

    if (profileRow?.data) {
      try {
        profile = ProfileSchema.parse(JSON.parse(profileRow.data));
      } catch {
        // Fallback to default
      }
    }
  }

  const dailyTarget = profile?.preferences?.manual_daily_target ?? 10;

  // 2. Query active manual queue items:
  // channel = 'manual' OR status = 'needs_review', active in (manual_pending, needs_review)
  const query = `
    SELECT
      a.id AS application_id,
      a.job_id,
      a.channel,
      a.status,
      a.notes,
      a.validator_errors,
      a.snoozed_until,
      j.title,
      j.company,
      j.company_normalized,
      j.source,
      j.location,
      j.remote,
      j.salary_raw,
      j.salary_min,
      j.salary_max,
      j.currency,
      j.match_score,
      j.apply_route,
      j.route_reason,
      j.untrusted,
      j.posted_at,
      j.fetched_at,
      (
        SELECT COUNT(*)
        FROM applications a2
        JOIN jobs j2 ON a2.job_id = j2.id
        WHERE j2.company_normalized = j.company_normalized
          AND lower(j2.title) = lower(j.title)
          AND a2.id != a.id
          AND a2.status IN ('manual_applied', 'sent', 'replied', 'interview', 'offer')
      ) AS applied_count
    FROM applications a
    JOIN jobs j ON a.job_id = j.id
    WHERE (a.channel = 'manual' OR a.status = 'needs_review')
      AND a.status IN ('manual_pending', 'needs_review')
    ORDER BY j.match_score DESC, j.fetched_at DESC
  `;

  const { results: rawRows } = await db.prepare(query).bind().all<RawQueueRow>();
  const rows = rawRows ?? [];

  const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;

  let allItems: ManualQueueItem[] = rows.map((row) => {
    const postedTime = row.posted_at
      ? new Date(row.posted_at).getTime()
      : new Date(row.fetched_at).getTime();
    const ageMs = nowMs - postedTime;
    const mayBeClosed = ageMs > fourteenDaysMs;

    let parsedValidatorErrors: string[] | null = null;
    if (row.validator_errors) {
      try {
        const parsed = JSON.parse(row.validator_errors) as unknown;
        if (Array.isArray(parsed)) {
          parsedValidatorErrors = parsed.map(String);
        }
      } catch {
        parsedValidatorErrors = [row.validator_errors];
      }
    }

    return {
      application_id: row.application_id,
      job_id: row.job_id,
      channel: row.channel as 'manual' | 'email',
      status: row.status as 'manual_pending' | 'needs_review',
      title: row.title,
      company: row.company,
      company_normalized: row.company_normalized,
      source: row.source,
      location: row.location,
      remote: Boolean(row.remote),
      salary_raw: row.salary_raw,
      salary_min: row.salary_min,
      salary_max: row.salary_max,
      currency: row.currency,
      match_score: row.match_score,
      apply_route: row.apply_route,
      route_reason: row.route_reason,
      route_reason_explained: explainRouteReason(row.route_reason),
      posted_at: row.posted_at,
      fetched_at: row.fetched_at,
      snoozed_until: row.snoozed_until,
      may_be_closed: mayBeClosed,
      applied_before_warning: Number(row.applied_count) > 0,
      untrusted: Boolean(row.untrusted),
      needs_attention: row.status === 'needs_review',
      notes: row.notes,
      validator_errors: parsedValidatorErrors,
    };
  });

  // Apply in-memory filters if specified
  if (filters.route) {
    allItems = allItems.filter((i) => i.apply_route === filters.route);
  }
  if (filters.route_reason) {
    allItems = allItems.filter((i) => i.route_reason === filters.route_reason);
  }
  if (filters.source) {
    allItems = allItems.filter((i) => i.source.toLowerCase() === filters.source?.toLowerCase());
  }
  if (typeof filters.min_score === 'number') {
    const min = filters.min_score;
    allItems = allItems.filter((i) => (i.match_score ?? 0) >= min);
  }
  if (typeof filters.max_score === 'number') {
    const max = filters.max_score;
    allItems = allItems.filter((i) => (i.match_score ?? 0) <= max);
  }
  if (typeof filters.age_days === 'number') {
    const maxAgeMs = filters.age_days * 24 * 60 * 60 * 1000;
    allItems = allItems.filter((i) => {
      const time = i.posted_at ? new Date(i.posted_at).getTime() : new Date(i.fetched_at).getTime();
      return nowMs - time <= maxAgeMs;
    });
  }

  // Calculate counts across all active items
  let manualPendingCount = 0;
  let needsReviewCount = 0;
  let snoozedCount = 0;

  for (const item of allItems) {
    const isSnoozed = item.snoozed_until ? new Date(item.snoozed_until).getTime() > nowMs : false;
    if (isSnoozed) {
      snoozedCount++;
    }
    if (item.status === 'manual_pending') {
      manualPendingCount++;
    } else if (item.status === 'needs_review') {
      needsReviewCount++;
    }
  }

  // Filter out snoozed items for active view unless include_snoozed is true
  const activeItems = filters.include_snoozed
    ? allItems
    : allItems.filter((i) => !i.snoozed_until || new Date(i.snoozed_until).getTime() <= nowMs);

  // Today's focus: top N non-snoozed items by match score
  const todaysFocus = activeItems.slice(0, dailyTarget);

  // Needs attention: items with needs_review
  const needsAttention = activeItems.filter((i) => i.needs_attention);

  return {
    items: activeItems,
    todays_focus: todaysFocus,
    needs_attention: needsAttention,
    counts: {
      total: activeItems.length,
      manual_pending: manualPendingCount,
      needs_review: needsReviewCount,
      snoozed: snoozedCount,
    },
  };
}

interface RawKitRow {
  application_id: string;
  job_id: string;
  channel: string;
  status: string;
  resume_id: string | null;
  cover_letter: string | null;
  subject: string | null;
  notes: string | null;
  validator_errors: string | null;
  title: string;
  company: string;
  source: string;
  location: string | null;
  salary_raw: string | null;
  salary_min: number | null;
  salary_max: number | null;
  currency: string | null;
  posted_at: string | null;
  apply_url: string | null;
  contact_email: string | null;
  contact_source: string | null;
  description: string;
  match_score: number | null;
  match_reasons: string | null;
  red_flags: string | null;
  route_reason: string | null;
  untrusted: number | boolean | null;
}

export async function getManualKit(
  db: D1LikeDatabase,
  applicationId: string,
  profile?: Profile | undefined,
): Promise<ManualKit | null> {
  const query = `
    SELECT
      a.id AS application_id,
      a.job_id,
      a.channel,
      a.status,
      a.resume_id,
      a.cover_letter,
      a.subject,
      a.notes,
      a.validator_errors,
      j.title,
      j.company,
      j.source,
      j.location,
      j.salary_raw,
      j.salary_min,
      j.salary_max,
      j.currency,
      j.posted_at,
      j.apply_url,
      j.contact_email,
      j.contact_source,
      j.description,
      j.match_score,
      j.match_reasons,
      j.red_flags,
      j.route_reason,
      j.untrusted
    FROM applications a
    JOIN jobs j ON a.job_id = j.id
    WHERE a.id = ?
  `;

  const row = await db.prepare(query).bind(applicationId).first<RawKitRow>();
  if (!row) {
    return null;
  }

  // Fetch Profile if not provided
  let loadedProfile = profile;
  if (!loadedProfile) {
    const profileRow = await db
      .prepare(`SELECT data FROM profile WHERE id = ?`)
      .bind('default')
      .first<{ data: string }>();

    if (profileRow?.data) {
      try {
        loadedProfile = ProfileSchema.parse(JSON.parse(profileRow.data));
      } catch {
        // Continue with empty answers
      }
    }
  }

  // Validate Apply URL: strictly http or https only
  let validApplyUrl: string | null = null;
  let applyDomain: string | null = null;

  if (row.apply_url && typeof row.apply_url === 'string') {
    const trimmedUrl = row.apply_url.trim();
    if (trimmedUrl.startsWith('http://') || trimmedUrl.startsWith('https://')) {
      try {
        const parsed = new URL(trimmedUrl);
        validApplyUrl = trimmedUrl;
        applyDomain = parsed.hostname;
      } catch {
        // Invalid URL
      }
    }
  }

  // Format Salary
  let formattedSalary: string | null = row.salary_raw ?? null;
  if (!formattedSalary && (row.salary_min || row.salary_max)) {
    const curr = row.currency ?? 'USD';
    if (row.salary_min && row.salary_max) {
      formattedSalary = `${curr} ${row.salary_min.toLocaleString()} - ${row.salary_max.toLocaleString()}`;
    } else if (row.salary_min) {
      formattedSalary = `${curr} ${row.salary_min.toLocaleString()}+`;
    } else if (row.salary_max) {
      formattedSalary = `Up to ${curr} ${row.salary_max.toLocaleString()}`;
    }
  }

  // Parse Red Flags
  let parsedRedFlags: string[] = [];
  if (row.red_flags) {
    try {
      const parsed = JSON.parse(row.red_flags) as unknown;
      if (Array.isArray(parsed)) {
        parsedRedFlags = parsed.map(String);
      }
    } catch {
      // Ignored
    }
  }

  // Parse Matched and Missing skills from match_reasons if JSON
  let matchedSkills: string[] = [];
  let missingSkills: string[] = [];
  if (row.match_reasons) {
    try {
      const parsed = JSON.parse(row.match_reasons) as {
        matched_skills?: string[];
        missing_skills?: string[];
      };
      if (Array.isArray(parsed.matched_skills)) {
        matchedSkills = parsed.matched_skills;
      }
      if (Array.isArray(parsed.missing_skills)) {
        missingSkills = parsed.missing_skills;
      }
    } catch {
      // Plain text reasons
    }
  }

  // Parse Validator Errors
  let parsedValidatorErrors: string[] | null = null;
  if (row.validator_errors) {
    try {
      const parsed = JSON.parse(row.validator_errors) as unknown;
      if (Array.isArray(parsed)) {
        parsedValidatorErrors = parsed.map(String);
      }
    } catch {
      parsedValidatorErrors = [row.validator_errors];
    }
  }

  // Fetch Resume details
  let resumeDetails: ManualKit['resume'] = null;
  if (row.resume_id) {
    const resumeRow = await db
      .prepare(`SELECT id, label FROM resumes WHERE id = ?`)
      .bind(row.resume_id)
      .first<{ id: string; label: string }>();

    if (resumeRow) {
      resumeDetails = {
        id: resumeRow.id,
        label: resumeRow.label,
        download_url: `/api/resumes/${resumeRow.id}/download`,
      };
    }
  }

  return {
    id: row.application_id,
    job_id: row.job_id,
    title: row.title,
    company: row.company,
    source: row.source,
    location: row.location,
    salary: formattedSalary,
    posted_at: row.posted_at,
    apply_url: validApplyUrl,
    apply_domain: applyDomain,
    match_score: row.match_score,
    matched_skills: matchedSkills,
    missing_skills: missingSkills,
    red_flags: parsedRedFlags,
    route_reason: row.route_reason,
    route_reason_explained: explainRouteReason(row.route_reason),
    untrusted: Boolean(row.untrusted),
    cover_letter: row.cover_letter,
    subject: row.subject,
    validator_errors: parsedValidatorErrors,
    resume: resumeDetails,
    answers: loadedProfile?.answers ?? {},
    description: row.description,
    notes: row.notes,
    contact_email: row.contact_email,
    contact_source: row.contact_source,
  };
}
