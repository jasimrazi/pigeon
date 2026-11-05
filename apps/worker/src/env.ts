import {
  validateEnv as sharedValidateEnv,
  isTestEnvironment,
  type WorkerEnvVars,
} from '@pigeon/shared';

export interface Bindings {
  DB: D1Database;
  RESUMES: R2Bucket;
  CONFIG: KVNamespace;
  JOBS_QUEUE: Queue;
  AI?: Ai | undefined;
  DRY_RUN?: string | boolean | undefined;
  ENV?: string | undefined;
  LLM_PROVIDER?: string | undefined;
  GEMINI_API_KEY?: string | undefined;
  ADZUNA_APP_ID?: string | undefined;
  ADZUNA_APP_KEY?: string | undefined;
  ALERT_FORWARDING_ADDRESS?: string | undefined;
  KILL_SWITCH?: string | boolean | undefined;
  GOOGLE_CLIENT_ID?: string | undefined;
  GOOGLE_CLIENT_SECRET?: string | undefined;
  GOOGLE_TOKEN_ENCRYPTION_KEY?: string | undefined;
  GOOGLE_REDIRECT_URI?: string | undefined;
  GOOGLE_SHEET_ID?: string | undefined;
  [key: string]: unknown;
}

export interface ValidatedEnv extends WorkerEnvVars {
  DB: D1Database;
  RESUMES: R2Bucket;
  CONFIG: KVNamespace;
  JOBS_QUEUE: Queue;
  AI?: Ai | undefined;
  GEMINI_API_KEY?: string | undefined;
  ADZUNA_APP_ID?: string | undefined;
  ADZUNA_APP_KEY?: string | undefined;
  ALERT_FORWARDING_ADDRESS?: string | undefined;
  KILL_SWITCH: boolean;
  GOOGLE_CLIENT_ID?: string | undefined;
  GOOGLE_CLIENT_SECRET?: string | undefined;
  GOOGLE_TOKEN_ENCRYPTION_KEY?: string | undefined;
  GOOGLE_REDIRECT_URI?: string | undefined;
  GOOGLE_SHEET_ID?: string | undefined;
}

export function validateWorkerEnv(rawEnv: Bindings, isTest?: boolean): ValidatedEnv {
  const isTestMode =
    isTest !== undefined ? isTest : isTestEnvironment(rawEnv as Record<string, unknown>);
  const parsed = sharedValidateEnv(rawEnv as Record<string, unknown>, isTestMode);

  if (!rawEnv.DB) {
    throw new Error('Missing D1 database binding: DB');
  }
  if (!rawEnv.RESUMES) {
    throw new Error('Missing R2 bucket binding: RESUMES');
  }
  if (!rawEnv.CONFIG) {
    throw new Error('Missing KV namespace binding: CONFIG');
  }
  if (!rawEnv.JOBS_QUEUE) {
    throw new Error('Missing Queue binding: JOBS_QUEUE');
  }

  const result: ValidatedEnv = {
    DB: rawEnv.DB,
    RESUMES: rawEnv.RESUMES,
    CONFIG: rawEnv.CONFIG,
    JOBS_QUEUE: rawEnv.JOBS_QUEUE,
    DRY_RUN: parsed.DRY_RUN,
    ENV: parsed.ENV,
    LLM_PROVIDER: parsed.LLM_PROVIDER,
    KILL_SWITCH: parsed.KILL_SWITCH ?? false,
  };

  if (rawEnv.AI !== undefined) {
    result.AI = rawEnv.AI;
  }
  if (parsed.GEMINI_API_KEY !== undefined) {
    result.GEMINI_API_KEY = parsed.GEMINI_API_KEY;
  }
  if (parsed.ADZUNA_APP_ID !== undefined) {
    result.ADZUNA_APP_ID = parsed.ADZUNA_APP_ID;
  }
  if (parsed.ADZUNA_APP_KEY !== undefined) {
    result.ADZUNA_APP_KEY = parsed.ADZUNA_APP_KEY;
  }
  if (parsed.GOOGLE_CLIENT_ID !== undefined) {
    result.GOOGLE_CLIENT_ID = parsed.GOOGLE_CLIENT_ID;
  }
  if (parsed.GOOGLE_CLIENT_SECRET !== undefined) {
    result.GOOGLE_CLIENT_SECRET = parsed.GOOGLE_CLIENT_SECRET;
  }
  if (parsed.GOOGLE_TOKEN_ENCRYPTION_KEY !== undefined) {
    result.GOOGLE_TOKEN_ENCRYPTION_KEY = parsed.GOOGLE_TOKEN_ENCRYPTION_KEY;
  }
  if (parsed.GOOGLE_REDIRECT_URI !== undefined) {
    result.GOOGLE_REDIRECT_URI = parsed.GOOGLE_REDIRECT_URI;
  }

  return result;
}
