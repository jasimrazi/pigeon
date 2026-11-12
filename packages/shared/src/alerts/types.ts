import { z } from 'zod';

export type PortalType =
  | 'linkedin'
  | 'naukri'
  | 'indeed'
  | 'wellfound'
  | 'otta'
  | 'ziprecruiter'
  | 'dice'
  | 'glassdoor'
  | 'instahyre'
  | 'foundit'
  | 'fallback';

export const ParsedAlertJobSchema = z.object({
  title: z.string().max(500),
  company: z.string().max(500),
  location: z.string().max(500).nullish(),
  apply_url: z.string().max(2000),
  salary_raw: z.string().max(200).nullish(),
  description: z.string().max(50000).nullish(),
});

export const ParsedAlertJobsSchema = z.array(ParsedAlertJobSchema).max(200);

export type ParsedAlertJob = z.infer<typeof ParsedAlertJobSchema>;

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
