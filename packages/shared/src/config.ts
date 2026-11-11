import { z } from 'zod';
import { ConfigError } from './env.js';
import { decryptSetting, encryptSetting, validateMasterKey } from './settings-crypto.js';
import type { D1LikeDatabase } from './state-machine.js';

export const MIGRATED_SETTING_KEYS = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GEMINI_API_KEY',
  'TELEGRAM_BOT_TOKEN',
  'ADZUNA_APP_ID',
  'ADZUNA_APP_KEY',
  'GOOGLE_SHEET_ID',
  'SHEET_TAB_APPLICATIONS',
  'SHEET_TAB_METRICS',
  'LLM_PROVIDER',
  'LLM_MODEL',
  'TELEGRAM_CHAT_ID',
  'USER_AGENT_CONTACT_EMAIL',
  'TIMEZONE',
  'ALERT_FORWARDING_ADDRESS',
  'GOOGLE_REDIRECT_URI',
] as const;

export type MigratedSettingKey = (typeof MIGRATED_SETTING_KEYS)[number];

export type SettingGroup = 'google' | 'sheets' | 'llm' | 'telegram' | 'identity' | 'jobs';
export type SettingClass = 'SECRET' | 'SETTING';
export type SettingSource = 'ui' | 'env' | 'unset';

export interface SettingFieldDefinition {
  key: MigratedSettingKey;
  group: SettingGroup;
  class: SettingClass;
  type: 'string' | 'select' | 'email';
  options?: readonly string[];
  defaultValue?: string;
  description: string;
}

export const SETTING_DEFINITIONS: Record<MigratedSettingKey, SettingFieldDefinition> = {
  GOOGLE_CLIENT_ID: {
    key: 'GOOGLE_CLIENT_ID',
    group: 'google',
    class: 'SECRET',
    type: 'string',
    description: 'Google Cloud OAuth 2.0 Web Client ID',
  },
  GOOGLE_CLIENT_SECRET: {
    key: 'GOOGLE_CLIENT_SECRET',
    group: 'google',
    class: 'SECRET',
    type: 'string',
    description: 'Google Cloud OAuth 2.0 Client Secret',
  },
  GOOGLE_REDIRECT_URI: {
    key: 'GOOGLE_REDIRECT_URI',
    group: 'google',
    class: 'SETTING',
    type: 'string',
    description: 'Google OAuth Redirect URI override (leave unset to compute from request)',
  },
  GOOGLE_SHEET_ID: {
    key: 'GOOGLE_SHEET_ID',
    group: 'sheets',
    class: 'SETTING',
    type: 'string',
    description: 'Google Spreadsheet ID or URL for one-way application tracking',
  },
  SHEET_TAB_APPLICATIONS: {
    key: 'SHEET_TAB_APPLICATIONS',
    group: 'sheets',
    class: 'SETTING',
    type: 'string',
    defaultValue: 'Applications',
    description: 'Spreadsheet tab name for applications',
  },
  SHEET_TAB_METRICS: {
    key: 'SHEET_TAB_METRICS',
    group: 'sheets',
    class: 'SETTING',
    type: 'string',
    defaultValue: 'Metrics',
    description: 'Spreadsheet tab name for summary metrics',
  },
  LLM_PROVIDER: {
    key: 'LLM_PROVIDER',
    group: 'llm',
    class: 'SETTING',
    type: 'select',
    options: ['workers-ai', 'gemini'],
    defaultValue: 'workers-ai',
    description: 'LLM engine for scoring and letter generation',
  },
  LLM_MODEL: {
    key: 'LLM_MODEL',
    group: 'llm',
    class: 'SETTING',
    type: 'string',
    defaultValue: '@cf/meta/llama-3.3-70b-instruct',
    description: 'LLM Model ID',
  },
  GEMINI_API_KEY: {
    key: 'GEMINI_API_KEY',
    group: 'llm',
    class: 'SECRET',
    type: 'string',
    description: 'Google Gemini API Key (required only if provider is gemini)',
  },
  TELEGRAM_BOT_TOKEN: {
    key: 'TELEGRAM_BOT_TOKEN',
    group: 'telegram',
    class: 'SECRET',
    type: 'string',
    description: 'Telegram Bot Token from @BotFather',
  },
  TELEGRAM_CHAT_ID: {
    key: 'TELEGRAM_CHAT_ID',
    group: 'telegram',
    class: 'SETTING',
    type: 'string',
    description: 'Telegram Chat ID of recipient',
  },
  USER_AGENT_CONTACT_EMAIL: {
    key: 'USER_AGENT_CONTACT_EMAIL',
    group: 'identity',
    class: 'SETTING',
    type: 'email',
    description: 'Contact email included in outbound User-Agent header',
  },
  TIMEZONE: {
    key: 'TIMEZONE',
    group: 'identity',
    class: 'SETTING',
    type: 'string',
    defaultValue: 'UTC',
    description: 'Schedule and quiet-hours timezone (IANA format)',
  },
  ALERT_FORWARDING_ADDRESS: {
    key: 'ALERT_FORWARDING_ADDRESS',
    group: 'identity',
    class: 'SETTING',
    type: 'email',
    description: 'Expected inbound forwarding recipient for job alerts',
  },
  ADZUNA_APP_ID: {
    key: 'ADZUNA_APP_ID',
    group: 'jobs',
    class: 'SECRET',
    type: 'string',
    description: 'Adzuna API Application ID',
  },
  ADZUNA_APP_KEY: {
    key: 'ADZUNA_APP_KEY',
    group: 'jobs',
    class: 'SECRET',
    type: 'string',
    description: 'Adzuna API Key',
  },
};

/**
 * Normalises spreadsheet input (extracts ID from full URL if pasted).
 */
export function normalizeSpreadsheetId(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  // Pattern: https://docs.google.com/spreadsheets/d/<ID>/edit...
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match?.[1]) {
    return match[1];
  }
  return trimmed;
}

export const SETTING_SCHEMAS: Record<MigratedSettingKey, z.ZodType<string>> = {
  GOOGLE_CLIENT_ID: z
    .string()
    .trim()
    .min(1, 'GOOGLE_CLIENT_ID cannot be empty')
    .max(256, 'GOOGLE_CLIENT_ID exceeds 256 characters'),
  GOOGLE_CLIENT_SECRET: z
    .string()
    .trim()
    .min(1, 'GOOGLE_CLIENT_SECRET cannot be empty')
    .max(256, 'GOOGLE_CLIENT_SECRET exceeds 256 characters'),
  GOOGLE_REDIRECT_URI: z
    .string()
    .trim()
    .max(512, 'GOOGLE_REDIRECT_URI exceeds 512 characters')
    .refine((val) => {
      if (!val) return true;
      try {
        new URL(val);
        return true;
      } catch {
        return false;
      }
    }, 'GOOGLE_REDIRECT_URI must be a valid URL'),
  GOOGLE_SHEET_ID: z
    .string()
    .trim()
    .min(1, 'GOOGLE_SHEET_ID cannot be empty')
    .max(256, 'GOOGLE_SHEET_ID exceeds 256 characters')
    .transform(normalizeSpreadsheetId),
  SHEET_TAB_APPLICATIONS: z
    .string()
    .trim()
    .min(1, 'SHEET_TAB_APPLICATIONS cannot be empty')
    .max(100, 'SHEET_TAB_APPLICATIONS exceeds 100 characters'),
  SHEET_TAB_METRICS: z
    .string()
    .trim()
    .min(1, 'SHEET_TAB_METRICS cannot be empty')
    .max(100, 'SHEET_TAB_METRICS exceeds 100 characters'),
  LLM_PROVIDER: z.enum(['workers-ai', 'gemini'], {
    errorMap: () => ({ message: 'LLM_PROVIDER must be workers-ai or gemini' }),
  }),
  LLM_MODEL: z
    .string()
    .trim()
    .min(1, 'LLM_MODEL cannot be empty')
    .max(128, 'LLM_MODEL exceeds 128 characters'),
  GEMINI_API_KEY: z
    .string()
    .trim()
    .min(1, 'GEMINI_API_KEY cannot be empty')
    .max(256, 'GEMINI_API_KEY exceeds 256 characters'),
  TELEGRAM_BOT_TOKEN: z
    .string()
    .trim()
    .min(1, 'TELEGRAM_BOT_TOKEN cannot be empty')
    .max(256, 'TELEGRAM_BOT_TOKEN exceeds 256 characters'),
  TELEGRAM_CHAT_ID: z
    .string()
    .trim()
    .min(1, 'TELEGRAM_CHAT_ID cannot be empty')
    .max(64, 'TELEGRAM_CHAT_ID exceeds 64 characters'),
  USER_AGENT_CONTACT_EMAIL: z
    .string()
    .trim()
    .email('USER_AGENT_CONTACT_EMAIL must be a valid email address')
    .max(256, 'USER_AGENT_CONTACT_EMAIL exceeds 256 characters'),
  TIMEZONE: z
    .string()
    .trim()
    .max(64, 'TIMEZONE exceeds 64 characters')
    .refine((tz) => {
      try {
        Intl.DateTimeFormat(undefined, { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, 'TIMEZONE must be a valid IANA timezone (e.g. UTC, America/New_York)'),
  ALERT_FORWARDING_ADDRESS: z
    .string()
    .trim()
    .email('ALERT_FORWARDING_ADDRESS must be a valid email address')
    .max(256, 'ALERT_FORWARDING_ADDRESS exceeds 256 characters'),
  ADZUNA_APP_ID: z.string().trim().max(128, 'ADZUNA_APP_ID exceeds 128 characters'),
  ADZUNA_APP_KEY: z.string().trim().max(128, 'ADZUNA_APP_KEY exceeds 128 characters'),
};

export function validateSettingValue(
  key: MigratedSettingKey,
  rawValue: unknown,
): { success: true; data: string } | { success: false; error: string } {
  const schema = SETTING_SCHEMAS[key];
  if (!schema) {
    return { success: false, error: 'Unknown setting key' };
  }
  const result = schema.safeParse(rawValue);
  if (!result.success) {
    const msg = result.error.errors[0]?.message || 'Invalid setting format';
    return { success: false, error: msg };
  }
  return { success: true, data: result.data };
}

export function getMasterKey(env: Record<string, unknown>): string | undefined {
  const sk = env.SETTINGS_ENCRYPTION_KEY;
  if (typeof sk === 'string' && sk.trim()) {
    return sk.trim();
  }
  const gk = env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (typeof gk === 'string' && gk.trim()) {
    return gk.trim();
  }
  return undefined;
}

export interface SettingFieldSummary {
  key: MigratedSettingKey;
  group: SettingGroup;
  type: string;
  class: SettingClass;
  source: SettingSource;
  isSet: boolean;
  updatedAt: string | null;
  maskedHint?: string | undefined;
  value?: string | undefined;
}

export interface AppConfig {
  env: string;
  isDev: boolean;
  masterKeyConfigured: boolean;
  masterKeyError?: string | undefined;

  // Typed Feature Accessors
  hasGoogleOAuth(): boolean;
  getGoogleOAuth(): {
    clientId: string;
    clientSecret: string;
    redirectUri?: string | undefined;
  };
  getSheetsConfig(): {
    spreadsheetId?: string | undefined;
    tabApplications: string;
    tabMetrics: string;
    isConfigured: boolean;
  };
  getLlmConfig(): {
    provider: 'workers-ai' | 'gemini';
    model: string;
    geminiApiKey?: string | undefined;
  };
  getTelegramConfig(): {
    botToken?: string | undefined;
    chatId?: string | undefined;
    isConfigured: boolean;
  };
  getIdentityConfig(): {
    userAgentContactEmail?: string | undefined;
    userAgent: string;
    timezone: string;
    alertForwardingAddress?: string | undefined;
  };

  // Generic metadata accessors
  getField(key: MigratedSettingKey): SettingFieldSummary;
  getAllFields(): SettingFieldSummary[];
  hasLegacyEnv(key: MigratedSettingKey): boolean;
  getLegacyEnvKeys(): MigratedSettingKey[];
  getRawValue(key: MigratedSettingKey): string | undefined;
}

interface RawSettingRow {
  key: string;
  value: string | null;
  ciphertext: string | null;
  iv: string | null;
  key_version: number;
  is_secret: number;
  updated_at: string;
}

let isolateCache: { config: AppConfig; expiresAt: number } | null = null;

export function invalidateConfigCache(): void {
  isolateCache = null;
}

/**
 * Internal helper to resolve configuration from D1 app_settings and env.
 */
async function resolveConfig(env: Record<string, unknown>, db: D1LikeDatabase): Promise<AppConfig> {
  const envMode = typeof env['ENV'] === 'string' ? env['ENV'] : 'dev';
  const isDev = envMode === 'dev';

  const masterKey =
    (typeof env['SETTINGS_ENCRYPTION_KEY'] === 'string' && env['SETTINGS_ENCRYPTION_KEY']) ||
    (typeof env['GOOGLE_TOKEN_ENCRYPTION_KEY'] === 'string' &&
      env['GOOGLE_TOKEN_ENCRYPTION_KEY']) ||
    null;

  const previousMasterKey =
    typeof env['PREVIOUS_SETTINGS_ENCRYPTION_KEY'] === 'string'
      ? env['PREVIOUS_SETTINGS_ENCRYPTION_KEY']
      : null;

  let masterKeyValid = false;
  let masterKeyError: string | undefined;
  try {
    validateMasterKey(masterKey);
    masterKeyValid = true;
  } catch (err) {
    masterKeyError = err instanceof Error ? err.message : String(err);
  }

  // Load all app_settings from D1
  const uiSettingsMap = new Map<string, RawSettingRow>();
  try {
    const rows = await db
      .prepare(
        'SELECT key, value, ciphertext, iv, key_version, is_secret, updated_at FROM app_settings',
      )
      .bind()
      .all<RawSettingRow>();
    for (const r of rows.results || []) {
      uiSettingsMap.set(r.key, r);
    }
  } catch {
    // If table does not exist or DB fails, treat UI settings as empty
  }

  const legacyEnvKeys: MigratedSettingKey[] = [];
  const fieldSummaries = new Map<MigratedSettingKey, SettingFieldSummary>();
  const resolvedValues = new Map<MigratedSettingKey, string | undefined>();

  for (const key of MIGRATED_SETTING_KEYS) {
    const def = SETTING_DEFINITIONS[key];
    const isSecret = def.class === 'SECRET';
    const uiRow = uiSettingsMap.get(key);

    const envValRaw = env[key];
    const hasEnvVal = typeof envValRaw === 'string' && envValRaw.trim().length > 0;

    if (!isDev && hasEnvVal && !uiRow) {
      legacyEnvKeys.push(key);
    }

    let finalValue: string | undefined;
    let finalSource: SettingSource = 'unset';
    let updatedAt: string | null = null;
    let isSet = false;

    if (uiRow) {
      if (isSecret) {
        if (!masterKeyValid) {
          // Cannot decrypt secret without valid master key
          finalValue = undefined;
        } else if (uiRow.ciphertext && uiRow.iv) {
          try {
            finalValue = await decryptSetting(
              key,
              uiRow.ciphertext,
              uiRow.iv,
              masterKey,
              previousMasterKey,
            );
            finalSource = 'ui';
            isSet = true;
            updatedAt = uiRow.updated_at;
          } catch {
            finalValue = undefined;
          }
        }
      } else {
        if (uiRow.value !== null && uiRow.value !== undefined) {
          finalValue = uiRow.value;
          finalSource = 'ui';
          isSet = true;
          updatedAt = uiRow.updated_at;
        }
      }
    }

    // Dev convenience env fallback (only when ENV=dev and UI row is unset)
    if (!isSet && isDev && hasEnvVal) {
      finalValue = (envValRaw as string).trim();
      finalSource = 'env';
      isSet = true;
    }

    // Non-secret defaults
    if (!isSet && !isSecret && def.defaultValue !== undefined) {
      finalValue = def.defaultValue;
      finalSource = 'unset';
    }

    resolvedValues.set(key, finalValue);

    // Build field summary
    let maskedHint: string | undefined;
    if (isSecret && isSet && finalValue && finalValue.length >= 16) {
      maskedHint = finalValue.slice(-4);
    }

    const summary: SettingFieldSummary = {
      key,
      group: def.group,
      type: def.type,
      class: def.class,
      source: finalSource,
      isSet,
      updatedAt,
      maskedHint,
      ...(isSecret ? {} : { value: finalValue ?? def.defaultValue ?? '' }),
    };

    fieldSummaries.set(key, summary);
  }

  return {
    env: envMode,
    isDev,
    masterKeyConfigured: masterKeyValid,
    masterKeyError,

    hasGoogleOAuth() {
      const clientId = resolvedValues.get('GOOGLE_CLIENT_ID');
      const clientSecret = resolvedValues.get('GOOGLE_CLIENT_SECRET');
      return !!(clientId && clientSecret);
    },

    getGoogleOAuth() {
      if (!masterKeyValid && uiSettingsMap.get('GOOGLE_CLIENT_SECRET')) {
        throw new ConfigError('Master encryption key is missing or invalid.');
      }
      const clientId = resolvedValues.get('GOOGLE_CLIENT_ID');
      const clientSecret = resolvedValues.get('GOOGLE_CLIENT_SECRET');
      const redirectUri = resolvedValues.get('GOOGLE_REDIRECT_URI');

      if (!clientId || !clientSecret) {
        throw new ConfigError(
          'Google OAuth credentials are not configured: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in Settings > Integrations.',
        );
      }
      return {
        clientId,
        clientSecret,
        ...(redirectUri ? { redirectUri } : {}),
      };
    },

    getSheetsConfig() {
      const spreadsheetId = resolvedValues.get('GOOGLE_SHEET_ID');
      const tabApplications = resolvedValues.get('SHEET_TAB_APPLICATIONS') || 'Applications';
      const tabMetrics = resolvedValues.get('SHEET_TAB_METRICS') || 'Metrics';

      return {
        spreadsheetId: spreadsheetId ? normalizeSpreadsheetId(spreadsheetId) : undefined,
        tabApplications,
        tabMetrics,
        isConfigured: Boolean(spreadsheetId && spreadsheetId.trim().length > 0),
      };
    },

    getLlmConfig() {
      const providerRaw = resolvedValues.get('LLM_PROVIDER') || 'workers-ai';
      const provider = providerRaw === 'gemini' ? 'gemini' : 'workers-ai';
      const model =
        resolvedValues.get('LLM_MODEL') ||
        (provider === 'gemini' ? 'gemini-2.5-flash' : '@cf/meta/llama-3.3-70b-instruct');
      const geminiApiKey = resolvedValues.get('GEMINI_API_KEY');

      if (provider === 'gemini' && !geminiApiKey) {
        throw new ConfigError(
          'Gemini API key is required when LLM provider is set to "gemini". Configure GEMINI_API_KEY in Settings > Integrations.',
        );
      }

      return {
        provider,
        model,
        geminiApiKey,
      };
    },

    getTelegramConfig() {
      const botToken = resolvedValues.get('TELEGRAM_BOT_TOKEN');
      const chatId = resolvedValues.get('TELEGRAM_CHAT_ID');
      const isConfigured = Boolean(botToken && chatId);

      return {
        botToken,
        chatId,
        isConfigured,
      };
    },

    getIdentityConfig() {
      const userAgentContactEmail = resolvedValues.get('USER_AGENT_CONTACT_EMAIL');
      const timezone = resolvedValues.get('TIMEZONE') || 'UTC';
      const alertForwardingAddress = resolvedValues.get('ALERT_FORWARDING_ADDRESS');

      const userAgent = userAgentContactEmail
        ? `Pigeon/1.0 (Job Application Assistant; +mailto:${userAgentContactEmail})`
        : 'Pigeon/1.0 (Job Application Assistant; +https://github.com/pigeon)';

      return {
        userAgentContactEmail,
        userAgent,
        timezone,
        alertForwardingAddress,
      };
    },

    getField(key: MigratedSettingKey) {
      const field = fieldSummaries.get(key);
      if (!field) {
        throw new ConfigError(`Unknown configuration key '${key}'`);
      }
      return field;
    },

    getAllFields() {
      return Array.from(fieldSummaries.values());
    },

    hasLegacyEnv(key: MigratedSettingKey) {
      return legacyEnvKeys.includes(key);
    },

    getLegacyEnvKeys() {
      return [...legacyEnvKeys];
    },

    getRawValue(key: MigratedSettingKey) {
      if (SETTING_DEFINITIONS[key]?.class === 'SECRET' && !masterKeyValid) {
        throw new ConfigError(
          'Cannot access secret value: master encryption key is missing or invalid.',
        );
      }
      return resolvedValues.get(key);
    },
  };
}

/**
 * Public config accessor with 15-second per-isolate caching and local write invalidation.
 */
export async function getConfig(
  env: Record<string, unknown>,
  db: D1LikeDatabase,
  options?: { fresh?: boolean },
): Promise<AppConfig> {
  const isFresh = options?.fresh === true;
  const now = Date.now();

  if (!isFresh && isolateCache && isolateCache.expiresAt > now) {
    return isolateCache.config;
  }

  const resolved = await resolveConfig(env, db);

  isolateCache = {
    config: resolved,
    expiresAt: now + 15_000,
  };

  return resolved;
}

/**
 * Helper to write a setting to D1 app_settings with proper validation, encryption, and cache invalidation.
 */
export async function setAppSetting(
  db: D1LikeDatabase,
  masterKey: string | null | undefined,
  key: MigratedSettingKey,
  rawValue: string,
  updatedBy = 'owner',
): Promise<void> {
  const def = SETTING_DEFINITIONS[key];
  if (!def) {
    throw new ConfigError(`Cannot set unknown configuration key '${key}'`);
  }

  const isSecret = def.class === 'SECRET';
  const nowIso = new Date().toISOString();

  if (isSecret) {
    const validKey = validateMasterKey(masterKey);
    const enc = await encryptSetting(key, rawValue, validKey);

    await db
      .prepare(
        `INSERT INTO app_settings (key, value, ciphertext, iv, key_version, is_secret, updated_at, updated_by)
         VALUES (?, NULL, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value = NULL,
           ciphertext = excluded.ciphertext,
           iv = excluded.iv,
           key_version = excluded.key_version,
           is_secret = 1,
           updated_at = excluded.updated_at,
           updated_by = excluded.updated_by`,
      )
      .bind(key, enc.ciphertext, enc.iv, enc.keyVersion, nowIso, updatedBy)
      .run();
  } else {
    let finalVal = rawValue.trim();
    if (key === 'GOOGLE_SHEET_ID') {
      finalVal = normalizeSpreadsheetId(finalVal);
    }

    await db
      .prepare(
        `INSERT INTO app_settings (key, value, ciphertext, iv, key_version, is_secret, updated_at, updated_by)
         VALUES (?, ?, NULL, NULL, 1, 0, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           ciphertext = NULL,
           iv = NULL,
           key_version = 1,
           is_secret = 0,
           updated_at = excluded.updated_at,
           updated_by = excluded.updated_by`,
      )
      .bind(key, finalVal, nowIso, updatedBy)
      .run();
  }

  invalidateConfigCache();
}

/**
 * Helper to delete a setting from D1 app_settings.
 */
export async function deleteAppSetting(db: D1LikeDatabase, key: MigratedSettingKey): Promise<void> {
  await db.prepare('DELETE FROM app_settings WHERE key = ?').bind(key).run();
  invalidateConfigCache();
}
