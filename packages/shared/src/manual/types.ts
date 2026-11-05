import type { ApplicationStatus, ApplicationChannel } from '../schema.js';

export interface ManualQueueItem {
  application_id: string;
  job_id: string;
  channel: ApplicationChannel;
  status: ApplicationStatus;
  title: string;
  company: string;
  company_normalized: string;
  source: string;
  location: string | null;
  remote: boolean | null;
  salary_raw: string | null;
  salary_min: number | null;
  salary_max: number | null;
  currency: string | null;
  match_score: number | null;
  apply_route: string | null;
  route_reason: string | null;
  route_reason_explained: string;
  posted_at: string | null;
  fetched_at: string;
  snoozed_until: string | null;
  may_be_closed: boolean;
  applied_before_warning: boolean;
  untrusted: boolean;
  needs_attention: boolean;
  notes: string | null;
  validator_errors: string[] | null;
}

export interface ManualQueueFilters {
  route?: string | undefined;
  route_reason?: string | undefined;
  source?: string | undefined;
  min_score?: number | undefined;
  max_score?: number | undefined;
  age_days?: number | undefined;
  include_snoozed?: boolean | undefined;
}

export interface ManualQueueResponse {
  items: ManualQueueItem[];
  todays_focus: ManualQueueItem[];
  needs_attention: ManualQueueItem[];
  counts: {
    total: number;
    manual_pending: number;
    needs_review: number;
    snoozed: number;
  };
}

export interface ManualKit {
  id: string; // application_id
  job_id: string;
  title: string;
  company: string;
  source: string;
  location: string | null;
  salary: string | null;
  posted_at: string | null;
  apply_url: string | null;
  apply_domain: string | null;
  match_score: number | null;
  matched_skills: string[];
  missing_skills: string[];
  red_flags: string[];
  route_reason: string | null;
  route_reason_explained: string;
  untrusted: boolean;
  cover_letter: string | null;
  subject: string | null;
  validator_errors: string[] | null;
  resume: {
    id: string;
    label: string;
    download_url: string;
  } | null;
  answers: {
    notice_period?: string | undefined;
    current_ctc?: string | undefined;
    expected_ctc?: string | undefined;
    work_authorisation?: string | undefined;
    links?: Record<string, string> | undefined;
    other?: Record<string, string> | undefined;
  };
  description: string;
  notes: string | null;
  contact_email: string | null;
  contact_source: string | null;
}

export function explainRouteReason(code: string | null | undefined): string {
  if (!code) return 'Standard manual queue';
  switch (code) {
    case 'LETTER_FAILED':
      return 'Cover letter failed automated validation and requires manual review';
    case 'SCORER_FAILED':
      return 'LLM fit scorer returned invalid output twice; evaluate fit manually';
    case 'RED_FLAGS':
      return 'Posting requests fees, identity documents, or looks suspicious';
    case 'SOURCE_UNTRUSTED':
      return 'Job ingested while source adapter circuit was half-open';
    case 'GUESSED_EMAIL':
      return 'Only a guessed careers@ or hr@ email is available; verify recruiter';
    case 'FREEMAIL_CONTACT':
      return 'Contact uses a freemail provider (Gmail, Yahoo, etc.); verify recruiter first';
    case 'PORTAL_NO_EMAIL':
      return 'Job alert from portal with no contact email; apply on site';
    case 'NO_EMAIL_FORM':
      return 'No contact email in posting; apply via portal form';
    case 'OK':
      return 'Direct corporate email verified';
    default:
      return code.replace(/_/g, ' ');
  }
}
