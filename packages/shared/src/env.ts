import { z } from 'zod';

export const DryRunSchema = z.union(
  [z.enum(['true', 'false']).transform((val) => val === 'true'), z.boolean()],
  {
    errorMap: () => ({ message: 'DRY_RUN must be "true" or "false"' }),
  },
);

export const EnvSchema = z.enum(['dev', 'staging', 'prod', 'test']);

export const LlmProviderSchema = z.enum(['workers-ai', 'gemini']).default('workers-ai');

export const WorkerEnvVarsSchema = z.object({
  DRY_RUN: DryRunSchema,
  ENV: EnvSchema.default('dev'),
  LLM_PROVIDER: LlmProviderSchema,
  ALERT_FORWARDING_ADDRESS: z.string().email().optional(),
  KILL_SWITCH: z
    .union([z.enum(['true', 'false']).transform((v) => v === 'true'), z.boolean()])
    .optional()
    .default(false),
  GOOGLE_REDIRECT_URI: z.string().optional(),
  GOOGLE_SHEET_ID: z.string().optional(),
  CF_ACCESS_ALLOWED_EMAIL: z.string().email().optional(),
  OWNER_GMAIL: z.string().email().optional(),
  ALLOW_INSECURE_DEV_AUTH: z
    .union([z.enum(['true', 'false']).transform((v) => v === 'true'), z.boolean()])
    .optional()
    .default(false),
});

export const WorkerSecretsSchema = z.object({
  GEMINI_API_KEY: z.string().min(1).optional(),
  ADZUNA_APP_ID: z.string().min(1).optional(),
  ADZUNA_APP_KEY: z.string().min(1).optional(),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  GOOGLE_TOKEN_ENCRYPTION_KEY: z.string().min(1).optional(),
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
