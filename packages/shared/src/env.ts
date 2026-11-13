import { z } from 'zod';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface GoogleClientEnv {
  GOOGLE_CLIENT_ID?: string | undefined;
  GOOGLE_CLIENT_SECRET?: string | undefined;
}

export function getGoogleClient(env: GoogleClientEnv): { clientId: string; clientSecret: string } {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new ConfigError(
      'Missing required Google OAuth credentials: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured',
    );
  }
  return { clientId, clientSecret };
}

export const DryRunSchema = z.union(
  [z.enum(['true', 'false']).transform((val) => val === 'true'), z.boolean()],
  {
    errorMap: () => ({ message: 'DRY_RUN must be "true" or "false"' }),
  },
);

export const EnvSchema = z.enum(['dev', 'staging', 'prod']);

export const LlmProviderSchema = z.enum(['workers-ai', 'gemini']).default('workers-ai');

const emptyToUndefined = (val: unknown) =>
  typeof val === 'string' && val.trim() === '' ? undefined : val;

export const WorkerEnvVarsSchema = z.object({
  DRY_RUN: DryRunSchema,
  ENV: EnvSchema,
  LLM_PROVIDER: LlmProviderSchema,
  ALERT_FORWARDING_ADDRESS: z.preprocess(emptyToUndefined, z.string().email().optional()),
  KILL_SWITCH: z
    .union([z.enum(['true', 'false']).transform((v) => v === 'true'), z.boolean()])
    .optional()
    .default(false),
  GOOGLE_REDIRECT_URI: z.preprocess(emptyToUndefined, z.string().optional()),
  GOOGLE_SHEET_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  OWNER_GMAIL: z.preprocess(emptyToUndefined, z.string().email().optional()),
  ALLOW_INSECURE_DEV_AUTH: z
    .union([z.enum(['true', 'false']).transform((v) => v === 'true'), z.boolean()])
    .optional()
    .default(false),
  DEV_RECIPIENT_ALLOWLIST: z.string().optional(),
});

export const WorkerSecretsSchema = z.object({
  ADMIN_PASSWORD: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  GEMINI_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  ADZUNA_APP_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  ADZUNA_APP_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  GOOGLE_CLIENT_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  GOOGLE_CLIENT_SECRET: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  GOOGLE_TOKEN_ENCRYPTION_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
});

export type WorkerEnvVars = z.infer<typeof WorkerEnvVarsSchema>;
export type WorkerSecrets = z.infer<typeof WorkerSecretsSchema>;

export function isTestEnvironment(env?: Record<string, unknown>): boolean {
  if (
    env?.['IS_TEST'] === true ||
    env?.['IS_TEST'] === 'true' ||
    env?.['ENV'] === 'test' ||
    env?.['TEST'] === 'true'
  ) {
    return true;
  }
  const proc = (globalThis as unknown as { process?: { env?: Record<string, string> } }).process;
  if (proc && (proc.env?.['VITEST'] === 'true' || proc.env?.['NODE_ENV'] === 'test')) {
    return true;
  }
  return false;
}

export function createEnvSchema(isTest = false) {
  return WorkerEnvVarsSchema.merge(WorkerSecretsSchema).superRefine((data, ctx) => {
    if (!isTest && (data.ENV === 'staging' || data.ENV === 'prod')) {
      if (!data.GOOGLE_TOKEN_ENCRYPTION_KEY || data.GOOGLE_TOKEN_ENCRYPTION_KEY.length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['GOOGLE_TOKEN_ENCRYPTION_KEY'],
          message:
            'GOOGLE_TOKEN_ENCRYPTION_KEY is required and must be at least 32 characters in staging and prod',
        });
      }
      if (!data.ADMIN_PASSWORD || data.ADMIN_PASSWORD.length < 8) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['ADMIN_PASSWORD'],
          message:
            'ADMIN_PASSWORD is required and must be at least 8 characters in staging and prod',
        });
      }
    }
  });
}

export function validateEnv(rawEnv: Record<string, unknown>, isTest?: boolean) {
  const testMode = isTest !== undefined ? isTest : isTestEnvironment(rawEnv);
  const schema = createEnvSchema(testMode);
  const result = schema.safeParse(rawEnv);
  if (!result.success) {
    const errorMessages = result.error.errors.map((e) => {
      const field = e.path.join('.');
      return field ? `${field}: ${e.message}` : e.message;
    });
    throw new Error(`Environment validation failed:\n${errorMessages.join('\n')}`);
  }
  return result.data;
}
