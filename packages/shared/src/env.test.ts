import { describe, it, expect } from 'vitest';
import { validateEnv, getGoogleClient, ConfigError } from './env.js';

describe('packages/shared env validation', () => {
  it('parses valid DRY_RUN string "true" to boolean true', () => {
    const result = validateEnv({ DRY_RUN: 'true', ENV: 'dev' });
    expect(result.DRY_RUN).toBe(true);
    expect(result.ENV).toBe('dev');
  });

  it('parses valid DRY_RUN string "false" to boolean false', () => {
    const result = validateEnv({ DRY_RUN: 'false', ENV: 'staging' });
    expect(result.DRY_RUN).toBe(false);
    expect(result.ENV).toBe('staging');
  });

  it('parses boolean DRY_RUN', () => {
    const result = validateEnv({ DRY_RUN: true, ENV: 'dev' });
    expect(result.DRY_RUN).toBe(true);
  });

  it('rejects a bad DRY_RUN value', () => {
    expect(() => validateEnv({ DRY_RUN: 'invalid', ENV: 'dev' })).toThrowError(
      /DRY_RUN must be "true" or "false"/,
    );
    expect(() => validateEnv({ DRY_RUN: 'yes', ENV: 'dev' })).toThrowError(
      /DRY_RUN must be "true" or "false"/,
    );
    expect(() => validateEnv({ DRY_RUN: 123, ENV: 'dev' })).toThrowError(
      /DRY_RUN must be "true" or "false"/,
    );
  });

  it('defaults LLM_PROVIDER to "workers-ai"', () => {
    const result = validateEnv({ DRY_RUN: 'true', ENV: 'dev' });
    expect(result.LLM_PROVIDER).toBe('workers-ai');
  });

  it('accepts "gemini" as LLM_PROVIDER and optional GEMINI_API_KEY', () => {
    const result = validateEnv({
      DRY_RUN: 'true',
      ENV: 'dev',
      LLM_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'test-gemini-key',
    });
    expect(result.LLM_PROVIDER).toBe('gemini');
    expect(result.GEMINI_API_KEY).toBe('test-gemini-key');
  });

  it('rejects any other value for LLM_PROVIDER', () => {
    expect(() =>
      validateEnv({
        DRY_RUN: 'true',
        ENV: 'dev',
        LLM_PROVIDER: 'openai',
      }),
    ).toThrowError(/LLM_PROVIDER/);

    expect(() =>
      validateEnv({
        DRY_RUN: 'true',
        ENV: 'dev',
        LLM_PROVIDER: 'claude',
      }),
    ).toThrowError(/LLM_PROVIDER/);
  });

  it('validates successfully with no ANTHROPIC_API_KEY and no GEMINI_API_KEY', () => {
    const result = validateEnv({ DRY_RUN: 'true', ENV: 'prod' });
    expect(result.GEMINI_API_KEY).toBeUndefined();
    expect(result.LLM_PROVIDER).toBe('workers-ai');
    expect(result).not.toHaveProperty('ANTHROPIC_API_KEY');
  });

  it('rejects missing or invalid ENV', () => {
    expect(() => validateEnv({ DRY_RUN: 'true' })).toThrowError(/ENV/);
    expect(() => validateEnv({ DRY_RUN: 'true', ENV: 'invalid' })).toThrowError(/ENV/);
  });

  describe('getGoogleClient helper', () => {
    it('throws ConfigError when GOOGLE_CLIENT_ID is missing', () => {
      expect(() => getGoogleClient({ GOOGLE_CLIENT_SECRET: 'sec' })).toThrow(ConfigError);
      expect(() => getGoogleClient({ GOOGLE_CLIENT_SECRET: 'sec' })).toThrow(/GOOGLE_CLIENT_ID/);
    });

    it('throws ConfigError when GOOGLE_CLIENT_SECRET is missing', () => {
      expect(() => getGoogleClient({ GOOGLE_CLIENT_ID: 'id' })).toThrow(ConfigError);
      expect(() => getGoogleClient({ GOOGLE_CLIENT_ID: 'id' })).toThrow(/GOOGLE_CLIENT_SECRET/);
    });

    it('returns clientId and clientSecret when both are present', () => {
      const client = getGoogleClient({
        GOOGLE_CLIENT_ID: 'my-client-id',
        GOOGLE_CLIENT_SECRET: 'my-client-secret',
      });
      expect(client).toEqual({
        clientId: 'my-client-id',
        clientSecret: 'my-client-secret',
      });
    });
  });
});
