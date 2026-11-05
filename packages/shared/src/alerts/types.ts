export type PortalType = 'linkedin' | 'naukri' | 'indeed' | 'fallback';

export interface ParsedAlertJob {
  title: string;
  company: string;
  location?: string | null | undefined;
  apply_url: string;
  salary_raw?: string | null | undefined;
  description?: string | null | undefined;
}

export interface PortalParser {
  readonly portal: PortalType;
  matchesSender(fromAddress: string): boolean;
  parse(html: string): ParsedAlertJob[];
}

export interface AlertIngestResult {
  portal: PortalType;
  dropped: boolean;
  dropReason?: string | undefined;
  jobsFound: number;
  newJobs: number;
  duplicates: number;
  emptyStreak: number;
  isSuspect: boolean;
  untrusted: boolean;
}
