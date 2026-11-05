import { describe, it, expect } from 'vitest';
import { validateEnv, createEnvSchema } from './env.js';

describe('packages/shared env validation', () => {
  it('parses valid DRY_RUN string "true" to boolean true', () => {
    const result = validateEnv({ DRY_RUN: 'true', ENV: 'dev' }, true);
    expect(result.DRY_RUN).toBe(true);
    expect(result.ENV).toBe('dev');
  });

  it('parses valid DRY_RUN string "false" to boolean false', () => {
    const result = validateEnv({ DRY_RUN: 'false', ENV: 'staging' }, true);
    expect(result.DRY_RUN).toBe(false);
    expect(result.ENV).toBe('staging');
  });

  it('parses boolean DRY_RUN', () => {
    const result = validateEnv({ DRY_RUN: true }, true);
    expect(result.DRY_RUN).toBe(true);
  });

  it('rejects a bad DRY_RUN value', () => {
    expect(() => validateEnv({ DRY_RUN: 'invalid' }, true)).toThrowError(
      /DRY_RUN must be "true" or "false"/,
    );
    expect(() => validateEnv({ DRY_RUN: 'yes' }, true)).toThrowError(
      /DRY_RUN must be "true" or "false"/,
    );
    expect(() => validateEnv({ DRY_RUN: 123 }, true)).toThrowError(
      /DRY_RUN must be "true" or "false"/,
    );
  });

  it('requires secrets in production/non-test mode and gives a clear error', () => {
    expect(() => validateEnv({ DRY_RUN: 'true', ENV: 'prod' }, false)).toThrowError(
      /Missing required secret: ANTHROPIC_API_KEY/,
    );
  });

  it('accepts valid secrets in non-test mode', () => {
    const result = validateEnv(
      { DRY_RUN: 'true', ENV: 'prod', ANTHROPIC_API_KEY: 'sk-ant-test-key' },
      false,
    );
    expect(result.DRY_RUN).toBe(true);
    expect(result.ANTHROPIC_API_KEY).toBe('sk-ant-test-key');
  });

  it('skips missing secrets in test mode', () => {
    const schema = createEnvSchema(true);
    const parsed = schema.parse({ DRY_RUN: 'true' });
    expect(parsed.ANTHROPIC_API_KEY).toBeUndefined();
    expect(parsed.DRY_RUN).toBe(true);
  });
});
