import { z } from 'zod';

export const DryRunSchema = z.union(
  [z.enum(['true', 'false']).transform((val) => val === 'true'), z.boolean()],
  {
    errorMap: () => ({ message: 'DRY_RUN must be "true" or "false"' }),
  },
);

export const EnvSchema = z.enum(['dev', 'staging', 'prod', 'test']);

export const WorkerEnvVarsSchema = z.object({
  DRY_RUN: DryRunSchema,
  ENV: EnvSchema.default('dev'),
});

export const WorkerSecretsSchema = z.object({
  ANTHROPIC_API_KEY: z
    .string({ required_error: 'Missing required secret: ANTHROPIC_API_KEY' })
    .min(1, 'Missing required secret: ANTHROPIC_API_KEY'),
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
  if (isTest) {
    return WorkerEnvVarsSchema.extend({
      ANTHROPIC_API_KEY: z.string().min(1).optional(),
    });
  }
  return WorkerEnvVarsSchema.merge(WorkerSecretsSchema);
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
