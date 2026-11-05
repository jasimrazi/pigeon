import type { JobSourceKind, JobContactSource } from '../schema.js';

export type { JobSourceKind, JobContactSource };

export interface RawJob {
  source?: string | undefined;
  id?: string | number | undefined;
  [key: string]: unknown;
}

export interface NormalizedJob {
  source: string;
  source_kind: 'api' | 'ats';
  source_job_id: string | null;
  title: string;
  company: string;
  company_normalized: string;
  location: string | null;
  remote: boolean | null;
  salary_min: number | null;
  salary_max: number | null;
  currency: string | null;
  salary_raw: string | null;
  description: string;
  apply_url: string | null;
  contact_email: string | null;
  contact_source: JobContactSource;
  posted_at: string | null;
  untrusted: boolean;
}

export interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

export interface JobSourceConfig {
  userAgent?: string | undefined;
  secrets?:
    | {
        ADZUNA_APP_ID?: string | undefined;
        ADZUNA_APP_KEY?: string | undefined;
        [key: string]: string | undefined;
      }
    | undefined;
  kv?: KVNamespaceLike | undefined;
  fetchFn?: typeof fetch | undefined;
  slugs?: string[] | undefined;
  [key: string]: unknown;
}

export interface JobSource {
  readonly name: string;
  readonly kind: 'api' | 'ats';
  fetch(config?: JobSourceConfig | undefined): Promise<RawJob[]>;
  normalize(raw: RawJob): NormalizedJob;
}
