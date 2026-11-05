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
  [key: string]: unknown;
}

export interface ValidatedEnv extends WorkerEnvVars {
  DB: D1Database;
  RESUMES: R2Bucket;
  CONFIG: KVNamespace;
  JOBS_QUEUE: Queue;
  AI?: Ai | undefined;
  GEMINI_API_KEY?: string | undefined;
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
  };

  if (rawEnv.AI !== undefined) {
    result.AI = rawEnv.AI;
  }
  if (parsed.GEMINI_API_KEY !== undefined) {
    result.GEMINI_API_KEY = parsed.GEMINI_API_KEY;
  }

  return result;
}
