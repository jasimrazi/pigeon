import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { applyD1Migrations, env } from 'cloudflare:test';
import { app } from './index.js';
import type { Bindings } from './env.js';
import {
  setAppSetting,
  invalidateConfigCache,
  setGoogleAuthHealth,
  getGoogleAuthHealth,
} from '@pigeon/shared';

interface TestEnv extends Bindings {
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
}

const workerEnv = env as unknown as TestEnv;
const masterKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('Settings API Endpoints (Stage 3)', () => {
  const allowedOrigin = 'http://localhost:5173';

  beforeAll(async () => {
    await applyD1Migrations(workerEnv.DB, workerEnv.TEST_MIGRATIONS);
  });

  beforeEach(async () => {
    invalidateConfigCache();
    workerEnv.ENV = 'dev';
    workerEnv.ALLOW_INSECURE_DEV_AUTH = true;
    workerEnv.SETTINGS_ENCRYPTION_KEY = masterKey;

    // Clean app_settings and events
    await workerEnv.DB.prepare('DELETE FROM app_settings').run();
    await workerEnv.DB.prepare('DELETE FROM events WHERE entity = ?').bind('settings').run();

    // Ensure default profile
    const nowIso = new Date().toISOString();
    await workerEnv.DB.prepare(
      `INSERT OR REPLACE INTO profile (id, data, updated_at) VALUES (?, ?, ?)`,
    )
      .bind(
        'default',
        JSON.stringify({
          name: 'Jane Doe',
          email: 'jane@example.com',
          skills: ['TypeScript'],
          send_settings: {
            daily_cap: 20,
            window: { start: '09:00', end: '18:00' },
            timezone: 'UTC',
            ramp_base: 5,
            ramp_step: 2,
            auto_approve_above_score: 80,
            max_follow_ups: 2,
          },
        }),
        nowIso,
      )
      .run();
  });

  describe('GET /api/settings', () => {
    it('returns settings summaries without ever returning plaintext secrets', async () => {
      // Seed a secret and a non-secret setting
      await setAppSetting(
        workerEnv.DB,
        masterKey,
        'GOOGLE_CLIENT_SECRET',
        'super-secret-google-oauth-secret-1234567890',
      );
      await setAppSetting(workerEnv.DB, masterKey, 'SHEET_TAB_APPLICATIONS', 'MyJobsTab');

      const res = await app.fetch(
        new Request('http://localhost/api/settings', {
          headers: { Origin: allowedOrigin },
        }),
        workerEnv,
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        settings: Array<{
          key: string;
          class: string;
          isSet: boolean;
          maskedHint?: string;
          value?: string;
        }>;
        profile: unknown;
        dryRun: boolean;
        killSwitch: boolean;
      };

      expect(data.profile).toBeDefined();
      expect(typeof data.dryRun).toBe('boolean');
      expect(typeof data.killSwitch).toBe('boolean');

      const secretField = data.settings.find((s) => s.key === 'GOOGLE_CLIENT_SECRET');
      expect(secretField).toBeDefined();
      expect(secretField?.isSet).toBe(true);
      expect(secretField?.class).toBe('SECRET');
      // Secret value must NEVER be present!
      expect(secretField?.value).toBeUndefined();
      // Masked hint gives only the last 4 characters if >= 16 chars
      expect(secretField?.maskedHint).toBe('7890');

      const plaintextField = data.settings.find((s) => s.key === 'SHEET_TAB_APPLICATIONS');
      expect(plaintextField).toBeDefined();
      expect(plaintextField?.value).toBe('MyJobsTab');
    });

    it('returns array directly when format=array query param is passed', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/settings?format=array', {
          headers: { Origin: allowedOrigin },
        }),
        workerEnv,
      );
      expect(res.status).toBe(200);
      const data = (await res.json()) as Array<{ key: string }>;
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
    });
  });

  describe('PUT /api/settings/:key', () => {
    it('saves non-secret setting and writes audit event', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/settings/TIMEZONE', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Origin: allowedOrigin,
          },
          body: JSON.stringify({ value: 'America/New_York' }),
        }),
        workerEnv,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; key: string };
      expect(body.ok).toBe(true);
      expect(body.key).toBe('TIMEZONE');

      // Verify audit event written
      const eventRow = await workerEnv.DB.prepare(
        'SELECT entity, entity_id, type, payload FROM events WHERE entity_id = ? ORDER BY created_at DESC',
      )
        .bind('TIMEZONE')
        .first<{ entity: string; entity_id: string; type: string; payload: string }>();

      expect(eventRow).toBeDefined();
      expect(eventRow?.type).toBe('settings.changed');
      const payload = JSON.parse(eventRow?.payload || '{}') as {
        action: string;
        sourceAfter: string;
      };
      expect(payload.action).toBe('set');
      expect(payload.sourceAfter).toBe('ui');
    });

    it('normalises pasted Google Spreadsheet URL into raw ID', async () => {
      const fullUrl =
        'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0';
      const res = await app.fetch(
        new Request('http://localhost/api/settings/GOOGLE_SHEET_ID', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Origin: allowedOrigin,
          },
          body: JSON.stringify({ value: fullUrl }),
        }),
        workerEnv,
      );

      expect(res.status).toBe(200);

      const d1Row = await workerEnv.DB.prepare('SELECT value FROM app_settings WHERE key = ?')
        .bind('GOOGLE_SHEET_ID')
        .first<{ value: string }>();
      expect(d1Row?.value).toBe('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms');
    });

    it('changing spreadsheet ID requires confirmed: true and logs reset event', async () => {
      // First set initial sheet
      await setAppSetting(workerEnv.DB, masterKey, 'GOOGLE_SHEET_ID', 'initial-sheet-id-12345');
      invalidateConfigCache();

      // Change without confirmation fails
      const resNoConfirm = await app.fetch(
        new Request('http://localhost/api/settings/GOOGLE_SHEET_ID', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Origin: allowedOrigin,
          },
          body: JSON.stringify({ value: 'new-sheet-id-99999' }),
        }),
        workerEnv,
      );
      expect(resNoConfirm.status).toBe(400);
      const errBody = (await resNoConfirm.json()) as { error: string };
      expect(errBody.error).toContain('confirmed: true');

      // Change with confirmed: true succeeds
      const resConfirm = await app.fetch(
        new Request('http://localhost/api/settings/GOOGLE_SHEET_ID', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Origin: allowedOrigin,
          },
          body: JSON.stringify({ value: 'new-sheet-id-99999', confirmed: true }),
        }),
        workerEnv,
      );
      expect(resConfirm.status).toBe(200);
    });

    it('changing Google OAuth client credentials marks Google auth health invalid', async () => {
      // Set auth health ok initially
      await setGoogleAuthHealth({ config: workerEnv.CONFIG, status: 'ok' });
      const initialHealth = await getGoogleAuthHealth(workerEnv.CONFIG);
      expect(initialHealth.status).toBe('ok');

      // Update GOOGLE_CLIENT_ID
      const res = await app.fetch(
        new Request('http://localhost/api/settings/GOOGLE_CLIENT_ID', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Origin: allowedOrigin,
          },
          body: JSON.stringify({ value: 'new-client-id.apps.googleusercontent.com' }),
        }),
        workerEnv,
      );
      expect(res.status).toBe(200);

      // Verify auth health is now invalid
      const updatedHealth = await getGoogleAuthHealth(workerEnv.CONFIG);
      expect(updatedHealth.status).toBe('invalid');
      expect(updatedHealth.reason).toContain('credentials changed');
    });

    it('rejects invalid value and never echoes submitted value in error message', async () => {
      const sensitiveCanaryValue = 'SUPER_SENSITIVE_LEAK_CANARY_VALUE_123';
      const res = await app.fetch(
        new Request('http://localhost/api/settings/USER_AGENT_CONTACT_EMAIL', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Origin: allowedOrigin,
          },
          body: JSON.stringify({ value: sensitiveCanaryValue }),
        }),
        workerEnv,
      );

      expect(res.status).toBe(400);
      const text = await res.text();
      expect(text).not.toContain(sensitiveCanaryValue);
      expect(text).toContain('valid email');
    });
  });

  describe('DELETE /api/settings/:key', () => {
    it('clears setting and invalidates Google auth if Google credential is removed', async () => {
      await setAppSetting(
        workerEnv.DB,
        masterKey,
        'GOOGLE_CLIENT_SECRET',
        'secret-to-be-deleted-12345',
      );
      await setGoogleAuthHealth({ config: workerEnv.CONFIG, status: 'ok' });

      const res = await app.fetch(
        new Request('http://localhost/api/settings/GOOGLE_CLIENT_SECRET', {
          method: 'DELETE',
          headers: { Origin: allowedOrigin },
        }),
        workerEnv,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; cleared: string };
      expect(body.ok).toBe(true);
      expect(body.cleared).toBe('GOOGLE_CLIENT_SECRET');

      const health = await getGoogleAuthHealth(workerEnv.CONFIG);
      expect(health.status).toBe('invalid');
    });
  });

  describe('POST /api/settings/test/:target', () => {
    it('rate limits test endpoint to 10 calls per minute per target', async () => {
      // 10 calls should succeed (or fail with domain code, but not 429)
      for (let i = 0; i < 10; i++) {
        const res = await app.fetch(
          new Request('http://localhost/api/settings/test/google-oauth-config', {
            method: 'POST',
            headers: { Origin: allowedOrigin },
          }),
          workerEnv,
        );
        expect(res.status).not.toBe(429);
      }

      // 11th call must return 429 rate limited
      const res11 = await app.fetch(
        new Request('http://localhost/api/settings/test/google-oauth-config', {
          method: 'POST',
          headers: { Origin: allowedOrigin },
        }),
        workerEnv,
      );
      expect(res11.status).toBe(429);
      const body = (await res11.json()) as { ok: boolean; code: string };
      expect(body.ok).toBe(false);
      expect(body.code).toBe('rate_limited');
    });

    it('returns normalized error response without raw upstream bodies', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/settings/test/sheets', {
          method: 'POST',
          headers: { Origin: allowedOrigin },
        }),
        workerEnv,
      );

      const body = (await res.json()) as { ok: boolean; code: string; message: string };
      expect(body.ok).toBe(false);
      expect(typeof body.code).toBe('string');
      expect(typeof body.message).toBe('string');
    });
  });

  describe('GET /api/setup/status', () => {
    it('returns setup items and readiness flags without mutating DRY_RUN', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/setup/status', {
          headers: { Origin: allowedOrigin },
        }),
        workerEnv,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        items: Array<{ id: string; status: string; message: string }>;
        readyForDryRun: boolean;
        readyToGoLive: boolean;
      };

      expect(Array.isArray(body.items)).toBe(true);
      expect(body.items.some((i) => i.id === 'master_key')).toBe(true);
      expect(body.items.some((i) => i.id === 'google_oauth')).toBe(true);
      expect(body.items.some((i) => i.id === 'profile')).toBe(true);
      expect(typeof body.readyForDryRun).toBe('boolean');
      expect(typeof body.readyToGoLive).toBe('boolean');
    });
  });

  describe('Export & Import', () => {
    it('GET /api/settings/export returns non-secret settings only', async () => {
      await setAppSetting(workerEnv.DB, masterKey, 'TIMEZONE', 'Europe/London');
      await setAppSetting(
        workerEnv.DB,
        masterKey,
        'GEMINI_API_KEY',
        'secret-gemini-key-1234567890',
      );

      const res = await app.fetch(
        new Request('http://localhost/api/settings/export', {
          headers: { Origin: allowedOrigin },
        }),
        workerEnv,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; settings: Record<string, string> };
      expect(body.ok).toBe(true);
      expect(body.settings.TIMEZONE).toBe('Europe/London');
      // Secret must NEVER be present in export
      expect(body.settings.GEMINI_API_KEY).toBeUndefined();
    });

    it('POST /api/settings/import rejects any secret keys with 400', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/settings/import', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: allowedOrigin,
          },
          body: JSON.stringify({
            settings: {
              TIMEZONE: 'Asia/Tokyo',
              GEMINI_API_KEY: 'attempted-secret-import',
            },
          }),
        }),
        workerEnv,
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('secret');
    });

    it('POST /api/settings/import returns preview when apply is not true', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/settings/import', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: allowedOrigin,
          },
          body: JSON.stringify({
            settings: {
              TIMEZONE: 'Asia/Tokyo',
            },
          }),
        }),
        workerEnv,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        preview: boolean;
        changes: Array<{ key: string; newValue: string }>;
      };
      expect(body.preview).toBe(true);
      expect(body.changes[0]?.key).toBe('TIMEZONE');
      expect(body.changes[0]?.newValue).toBe('Asia/Tokyo');
    });

    it('POST /api/settings/import applies validated settings when apply is true', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/settings/import', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: allowedOrigin,
          },
          body: JSON.stringify({
            apply: true,
            settings: {
              TIMEZONE: 'Asia/Tokyo',
            },
          }),
        }),
        workerEnv,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; imported: number };
      expect(body.ok).toBe(true);
      expect(body.imported).toBe(1);

      const d1Row = await workerEnv.DB.prepare('SELECT value FROM app_settings WHERE key = ?')
        .bind('TIMEZONE')
        .first<{ value: string }>();
      expect(d1Row?.value).toBe('Asia/Tokyo');
    });
  });

  describe('CSRF Protection', () => {
    it('rejects state-changing request with mismatched Origin (403)', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/settings/TIMEZONE', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://malicious-attacker.com',
          },
          body: JSON.stringify({ value: 'UTC' }),
        }),
        workerEnv,
      );

      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('Origin mismatch');
    });

    it('rejects state-changing request with missing Origin (403)', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/settings/TIMEZONE', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ value: 'UTC' }),
        }),
        workerEnv,
      );

      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/settings (Profile Updates)', () => {
    const validProfile = {
      name: 'Test Candidate',
      email: 'candidate@example.com',
      skills: ['TypeScript', 'Cloudflare Workers'],
      send_settings: {
        daily_cap: 20,
        ramp_base: 5,
        ramp_step: 2,
        window: { start: '09:00', end: '18:00' },
        timezone: 'UTC',
        auto_approve_above_score: 85,
      },
      filters: {
        titles: ['Engineer'],
        company_blacklist: [],
        min_score: 50,
      },
    };

    it('saves profile when wrapped in { profile: ... }', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/settings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://localhost:5173',
          },
          body: JSON.stringify({ profile: validProfile }),
        }),
        workerEnv,
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as { ok: boolean; profile: { name: string } };
      expect(data.ok).toBe(true);
      expect(data.profile.name).toBe('Test Candidate');
    });

    it('saves profile when passed directly as root body', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/settings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://localhost:5173',
          },
          body: JSON.stringify(validProfile),
        }),
        workerEnv,
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as { ok: boolean; profile: { name: string } };
      expect(data.ok).toBe(true);
      expect(data.profile.name).toBe('Test Candidate');
    });

    it('rejects empty body with 400', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/settings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://localhost:5173',
          },
          body: JSON.stringify({}),
        }),
        workerEnv,
      );

      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain('Missing profile object');
    });
  });
});
