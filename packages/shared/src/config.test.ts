import { describe, it, expect, beforeEach } from 'vitest';
import {
  getConfig,
  setAppSetting,
  deleteAppSetting,
  invalidateConfigCache,
  normalizeSpreadsheetId,
} from './config.js';
import { ConfigError } from './env.js';
import type { D1LikeDatabase } from './state-machine.js';

describe('AppConfig Layer (Precedence, Caching, and Fail-Closed)', () => {
  const masterKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  interface SettingRow {
    key: string;
    value: string | null;
    ciphertext: string | null;
    iv: string | null;
    key_version: number;
    is_secret: number;
    updated_at: string;
    updated_by: string;
  }

  let dbRows: Map<string, SettingRow>;
  let mockDb: D1LikeDatabase;

  beforeEach(() => {
    invalidateConfigCache();
    dbRows = new Map();

    mockDb = {
      prepare(query: string) {
        return {
          bind(...args: unknown[]) {
            return {
              async run() {
                if (
                  query.includes('INSERT INTO app_settings') &&
                  query.includes('VALUES (?, NULL,')
                ) {
                  // Secret insert
                  const [key, ciphertext, iv, key_version, updated_at, updated_by] = args as [
                    string,
                    string,
                    string,
                    number,
                    string,
                    string,
                  ];
                  dbRows.set(key, {
                    key,
                    value: null,
                    ciphertext,
                    iv,
                    key_version,
                    is_secret: 1,
                    updated_at,
                    updated_by,
                  });
                } else if (query.includes('INSERT INTO app_settings')) {
                  // Plaintext insert
                  const [key, value, updated_at, updated_by] = args as [
                    string,
                    string,
                    string,
                    string,
                  ];
                  dbRows.set(key, {
                    key,
                    value,
                    ciphertext: null,
                    iv: null,
                    key_version: 1,
                    is_secret: 0,
                    updated_at,
                    updated_by,
                  });
                } else if (query.includes('DELETE FROM app_settings')) {
                  const [key] = args as [string];
                  dbRows.delete(key);
                }
                return { success: true };
              },
              async first<T = unknown>(): Promise<T | null> {
                return null;
              },
              async all<T = unknown>(): Promise<{ results: T[] }> {
                if (
                  query.includes(
                    'SELECT key, value, ciphertext, iv, key_version, is_secret, updated_at FROM app_settings',
                  )
                ) {
                  return { results: Array.from(dbRows.values()) as unknown as T[] };
                }
                return { results: [] };
              },
            };
          },
        };
      },
      async batch() {
        return [];
      },
    };
  });

  describe('Precedence in Dev vs Staging/Prod', () => {
    it('in dev: prefers UI value over env value', async () => {
      // Seed UI setting in D1
      await setAppSetting(
        mockDb,
        masterKey,
        'GOOGLE_CLIENT_ID',
        'ui-client-id.apps.googleusercontent.com',
      );

      const env = {
        ENV: 'dev',
        SETTINGS_ENCRYPTION_KEY: masterKey,
        GOOGLE_CLIENT_ID: 'dev-env-client-id.apps.googleusercontent.com',
      };

      const config = await getConfig(env, mockDb);
      const field = config.getField('GOOGLE_CLIENT_ID');
      expect(field.source).toBe('ui');
      expect(config.getRawValue('GOOGLE_CLIENT_ID')).toBe(
        'ui-client-id.apps.googleusercontent.com',
      );
    });

    it('in dev: falls back to same-named env var when UI setting is unset', async () => {
      const env = {
        ENV: 'dev',
        SETTINGS_ENCRYPTION_KEY: masterKey,
        GOOGLE_CLIENT_ID: 'dev-env-client-id.apps.googleusercontent.com',
      };

      const config = await getConfig(env, mockDb);
      const field = config.getField('GOOGLE_CLIENT_ID');
      expect(field.source).toBe('env');
      expect(config.getRawValue('GOOGLE_CLIENT_ID')).toBe(
        'dev-env-client-id.apps.googleusercontent.com',
      );
    });

    it('in prod/staging: ignores env value for migrated names and reports legacy notice', async () => {
      const env = {
        ENV: 'prod',
        SETTINGS_ENCRYPTION_KEY: masterKey,
        GOOGLE_CLIENT_ID: 'prod-ignored-env-client-id.apps.googleusercontent.com',
      };

      const config = await getConfig(env, mockDb);
      const field = config.getField('GOOGLE_CLIENT_ID');
      // Must be unset in prod because env value is ignored!
      expect(field.source).toBe('unset');
      expect(field.isSet).toBe(false);
      expect(config.getRawValue('GOOGLE_CLIENT_ID')).toBeUndefined();
      // Flags legacy env detection
      expect(config.hasLegacyEnv('GOOGLE_CLIENT_ID')).toBe(true);
      expect(config.getLegacyEnvKeys()).toContain('GOOGLE_CLIENT_ID');
    });
  });

  describe('Fail Closed Per Feature', () => {
    it('Google OAuth throws ConfigError when credentials are missing', async () => {
      const env = { ENV: 'dev', SETTINGS_ENCRYPTION_KEY: masterKey };
      const config = await getConfig(env, mockDb);
      expect(() => config.getGoogleOAuth()).toThrow(ConfigError);
    });

    it('Gemini provider throws ConfigError when GEMINI_API_KEY is missing', async () => {
      await setAppSetting(mockDb, masterKey, 'LLM_PROVIDER', 'gemini');
      const env = { ENV: 'dev', SETTINGS_ENCRYPTION_KEY: masterKey };
      const config = await getConfig(env, mockDb);
      expect(() => config.getLlmConfig()).toThrow(ConfigError);
    });

    it('Workers AI provider succeeds without any API key', async () => {
      const env = { ENV: 'dev', SETTINGS_ENCRYPTION_KEY: masterKey };
      const config = await getConfig(env, mockDb);
      const llm = config.getLlmConfig();
      expect(llm.provider).toBe('workers-ai');
      expect(llm.geminiApiKey).toBeUndefined();
    });

    it('Telegram reports isConfigured: false when tokens are unset without throwing', async () => {
      const env = { ENV: 'dev', SETTINGS_ENCRYPTION_KEY: masterKey };
      const config = await getConfig(env, mockDb);
      const tg = config.getTelegramConfig();
      expect(tg.isConfigured).toBe(false);
    });
  });

  describe('Caching and Invalidation', () => {
    it('caches per isolate and invalidates on local write', async () => {
      const env = { ENV: 'dev', SETTINGS_ENCRYPTION_KEY: masterKey };

      // Initial read (empty)
      const config1 = await getConfig(env, mockDb);
      expect(config1.getField('SHEET_TAB_APPLICATIONS').value).toBe('Applications');

      // Update in D1 via setAppSetting
      await setAppSetting(mockDb, masterKey, 'SHEET_TAB_APPLICATIONS', 'MyCustomTab');

      // Next read gets fresh value because setAppSetting invalidates cache
      const config2 = await getConfig(env, mockDb);
      expect(config2.getField('SHEET_TAB_APPLICATIONS').value).toBe('MyCustomTab');
    });

    it('deletes setting and invalidates cache', async () => {
      const env = { ENV: 'dev', SETTINGS_ENCRYPTION_KEY: masterKey };
      await setAppSetting(mockDb, masterKey, 'SHEET_TAB_APPLICATIONS', 'CustomTab');
      const config1 = await getConfig(env, mockDb);
      expect(config1.getField('SHEET_TAB_APPLICATIONS').value).toBe('CustomTab');

      await deleteAppSetting(mockDb, 'SHEET_TAB_APPLICATIONS');
      const config2 = await getConfig(env, mockDb);
      expect(config2.getField('SHEET_TAB_APPLICATIONS').value).toBe('Applications');
    });

    it('send path and health check read fresh when fresh: true is passed', async () => {
      const env = { ENV: 'dev', SETTINGS_ENCRYPTION_KEY: masterKey };

      // Warm cache
      await getConfig(env, mockDb);

      // Directly manipulate dbRows without calling setAppSetting (simulating background change)
      dbRows.set('TIMEZONE', {
        key: 'TIMEZONE',
        value: 'America/Los_Angeles',
        ciphertext: null,
        iv: null,
        key_version: 1,
        is_secret: 0,
        updated_at: new Date().toISOString(),
        updated_by: 'manual',
      });

      // Regular read gets cached value
      const cached = await getConfig(env, mockDb);
      expect(cached.getField('TIMEZONE').value).toBe('UTC');

      // Fresh read bypasses cache
      const fresh = await getConfig(env, mockDb, { fresh: true });
      expect(fresh.getField('TIMEZONE').value).toBe('America/Los_Angeles');
    });
  });

  describe('Normalisation and Helpers', () => {
    it('normalises pasted Google Spreadsheet URL to raw ID', () => {
      const url =
        'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0';
      expect(normalizeSpreadsheetId(url)).toBe('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms');
    });

    it('leaves plain spreadsheet ID unchanged', () => {
      expect(normalizeSpreadsheetId('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms')).toBe(
        '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
      );
    });
  });
});
