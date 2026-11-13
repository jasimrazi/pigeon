import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { applyD1Migrations, env } from 'cloudflare:test';
import { app, verifyAdminPassword } from './index.js';
import type { Bindings } from './env.js';

interface TestEnv extends Bindings {
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
}

const workerEnv = env as unknown as TestEnv;

describe('Worker Owner Token Authentication & API Security Middleware', () => {
  const adminPassword = 'super-secret-owner-password-2026';
  const dashboardOrigin = 'https://pigeon-dashboard.pages.dev';

  beforeAll(async () => {
    await applyD1Migrations(workerEnv.DB, workerEnv.TEST_MIGRATIONS);

    const nowIso = new Date().toISOString();
    await workerEnv.DB.prepare(
      `INSERT OR REPLACE INTO profile (id, data, updated_at) VALUES (?, ?, ?)`,
    )
      .bind(
        'default',
        JSON.stringify({
          name: 'Alex Mercer',
          email: 'alex@example.com',
          skills: ['TypeScript', 'Cloudflare Workers'],
          send_settings: {
            daily_cap: 20,
            window: { start: '00:00', end: '23:59' },
            timezone: 'UTC',
            ramp_base: 5,
            ramp_step: 2,
            auto_approve_above_score: 85,
            max_follow_ups: 1,
          },
        }),
        nowIso,
      )
      .run();
  });

  beforeEach(() => {
    workerEnv.ADMIN_PASSWORD = adminPassword;
    workerEnv.DASHBOARD_ORIGIN = dashboardOrigin;
    workerEnv.ALLOW_INSECURE_DEV_AUTH = false;
    workerEnv.ENV = 'dev';
  });

  afterAll(() => {
    delete workerEnv.ADMIN_PASSWORD;
    delete workerEnv.DASHBOARD_ORIGIN;
  });

  describe('verifyAdminPassword helper', () => {
    it('returns true when provided matches expected exactly', async () => {
      const match = await verifyAdminPassword('secret-token-123', 'secret-token-123');
      expect(match).toBe(true);
    });

    it('returns false when provided does not match', async () => {
      const mismatch = await verifyAdminPassword('wrong-token', 'secret-token-123');
      expect(mismatch).toBe(false);
    });

    it('returns false on length mismatch without timing leak', async () => {
      const mismatch = await verifyAdminPassword('short', 'much-longer-secret-token');
      expect(mismatch).toBe(false);
    });
  });

  describe('Owner Bearer Token Authentication', () => {
    it('rejects /api requests with no Authorization header or cookie (401)', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/overview', {
          method: 'GET',
        }),
        workerEnv,
      );
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('Missing Authorization header');
    });

    it('rejects /api requests with invalid Authorization format (401)', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/overview', {
          method: 'GET',
          headers: {
            Authorization: 'Basic invalid-basic-auth',
          },
        }),
        workerEnv,
      );
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('Invalid Authorization header format');
    });

    it('rejects /api requests with wrong admin password / token (401)', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/overview', {
          method: 'GET',
          headers: {
            Authorization: 'Bearer wrong-password-xyz',
          },
        }),
        workerEnv,
      );
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('Invalid admin password');
    });

    it('accepts /api requests with valid Bearer token (200)', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/overview', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${adminPassword}`,
          },
        }),
        workerEnv,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { sendsToday: number; authHealth: unknown };
      expect(body.authHealth).toBeDefined();
    });

    it('accepts /api requests with valid pigeon_token cookie (200)', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/overview', {
          method: 'GET',
          headers: {
            Cookie: `pigeon_token=${adminPassword}`,
          },
        }),
        workerEnv,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { sendsToday: number; authHealth: unknown };
      expect(body.authHealth).toBeDefined();
    });

    it('GET /api/auth/verify returns 200 with valid Bearer token and 401 without', async () => {
      const resUnauth = await app.fetch(
        new Request('http://localhost/api/auth/verify', {
          method: 'GET',
        }),
        workerEnv,
      );
      expect(resUnauth.status).toBe(401);

      const resAuth = await app.fetch(
        new Request('http://localhost/api/auth/verify', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${adminPassword}`,
          },
        }),
        workerEnv,
      );
      expect(resAuth.status).toBe(200);
      const body = (await resAuth.json()) as { ok: boolean };
      expect(body.ok).toBe(true);
    });
  });

  describe('CORS and Origin Security Controls', () => {
    it('rejects missing or wrong Origin on every state-changing route (403)', async () => {
      const stateChangingRoutes: Array<{ method: string; path: string; body?: string }> = [
        { method: 'POST', path: '/api/settings/dry-run', body: JSON.stringify({ dry_run: true }) },
        {
          method: 'POST',
          path: '/api/settings/kill-switch',
          body: JSON.stringify({ kill_switch: true, confirmed: true }),
        },
        {
          method: 'POST',
          path: '/api/settings',
          body: JSON.stringify({ profile: { name: 'A', email: 'a@b.com' } }),
        },
        {
          method: 'POST',
          path: '/api/applications/bulk-approve',
          body: JSON.stringify({ application_ids: [] }),
        },
        {
          method: 'PATCH',
          path: '/api/applications/app-test/letter',
          body: JSON.stringify({ cover_letter: 'text' }),
        },
        {
          method: 'PATCH',
          path: '/api/applications/app-test/resume',
          body: JSON.stringify({ resume_id: 'res-1' }),
        },
        { method: 'POST', path: '/api/applications/app-test/approve', body: '{}' },
        {
          method: 'POST',
          path: '/api/applications/app-test/reject',
          body: JSON.stringify({ reason: 'not interested' }),
        },
        { method: 'POST', path: '/api/applications/app-test/send', body: '{}' },
        {
          method: 'POST',
          path: '/api/manual/app-test/applied',
          body: JSON.stringify({ channel: 'manual' }),
        },
        { method: 'POST', path: '/api/manual/app-test/snooze', body: JSON.stringify({ days: 3 }) },
        {
          method: 'POST',
          path: '/api/manual/app-test/reject',
          body: JSON.stringify({ reason: 'skip' }),
        },
        {
          method: 'POST',
          path: '/api/manual/app-test/send-by-email',
          body: JSON.stringify({ confirm_risk: true }),
        },
        { method: 'POST', path: '/api/sync/sheet', body: '{}' },
        { method: 'POST', path: '/api/inbox/poll', body: '{}' },
        { method: 'POST', path: '/api/resumes' },
      ];

      for (const route of stateChangingRoutes) {
        // 1. Missing Origin -> 403
        const headersMissingOrigin: Record<string, string> = {
          Authorization: `Bearer ${adminPassword}`,
        };
        if (route.body) {
          headersMissingOrigin['Content-Type'] = 'application/json';
        }

        const reqInitMissing: RequestInit = {
          method: route.method,
          headers: headersMissingOrigin,
        };
        if (route.body) {
          reqInitMissing.body = route.body;
        }

        const resMissing = await app.fetch(
          new Request(`http://localhost${route.path}`, reqInitMissing),
          workerEnv,
        );
        expect(
          resMissing.status,
          `Expected 403 for missing Origin on ${route.method} ${route.path}, got ${resMissing.status}`,
        ).toBe(403);
        const jsonMissing = (await resMissing.json()) as { error: string };
        expect(jsonMissing.error).toContain('Origin mismatch');

        // 2. Wrong Origin -> 403
        const headersWrongOrigin: Record<string, string> = {
          Authorization: `Bearer ${adminPassword}`,
          Origin: 'https://malicious-attacker.com',
        };
        if (route.body) {
          headersWrongOrigin['Content-Type'] = 'application/json';
        }

        const reqInitWrong: RequestInit = {
          method: route.method,
          headers: headersWrongOrigin,
        };
        if (route.body) {
          reqInitWrong.body = route.body;
        }

        const resWrong = await app.fetch(
          new Request(`http://localhost${route.path}`, reqInitWrong),
          workerEnv,
        );
        expect(
          resWrong.status,
          `Expected 403 for wrong Origin on ${route.method} ${route.path}, got ${resWrong.status}`,
        ).toBe(403);
        const jsonWrong = (await resWrong.json()) as { error: string };
        expect(jsonWrong.error).toContain('Origin mismatch');
      }
    });

    it('rejects state-changing endpoint with mismatched Origin (403)', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/settings/dry-run', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${adminPassword}`,
            'Content-Type': 'application/json',
            Origin: 'https://malicious-site.com',
          },
          body: JSON.stringify({ dry_run: true }),
        }),
        workerEnv,
      );
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('Origin mismatch');
    });

    it('rejects state-changing endpoint with invalid Content-Type (415)', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/settings/dry-run', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${adminPassword}`,
            'Content-Type': 'text/plain',
            Origin: dashboardOrigin,
          },
          body: JSON.stringify({ dry_run: true }),
        }),
        workerEnv,
      );
      expect(res.status).toBe(415);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('Unsupported Media Type');
    });
  });

  describe('Environment and Bootstrap Config Gate Controls', () => {
    it('returns 503 when ENV is missing or invalid on /api and /auth', async () => {
      const origEnv = workerEnv.ENV;
      try {
        // 1. Missing ENV
        delete workerEnv.ENV;
        const resApiMissing = await app.fetch(
          new Request('http://localhost/api/overview', { method: 'GET' }),
          workerEnv,
        );
        expect(resApiMissing.status).toBe(503);

        const resAuthMissing = await app.fetch(
          new Request('http://localhost/auth/google/start', { method: 'GET' }),
          workerEnv,
        );
        expect(resAuthMissing.status).toBe(503);

        // 2. Invalid ENV
        workerEnv.ENV = 'invalid-env';
        const resApiInvalid = await app.fetch(
          new Request('http://localhost/api/overview', { method: 'GET' }),
          workerEnv,
        );
        expect(resApiInvalid.status).toBe(503);

        const resAuthInvalid = await app.fetch(
          new Request('http://localhost/auth/google/start', { method: 'GET' }),
          workerEnv,
        );
        expect(resAuthInvalid.status).toBe(503);
      } finally {
        workerEnv.ENV = origEnv;
      }
    });

    it('returns 503 when ADMIN_PASSWORD or OWNER_GMAIL is missing in staging or prod on /api and /auth', async () => {
      const origEnv = workerEnv.ENV;
      const origPass = workerEnv.ADMIN_PASSWORD;
      const origOwnerGmail = workerEnv.OWNER_GMAIL;

      const environments = ['staging', 'prod'];
      const requiredVars = ['ADMIN_PASSWORD', 'OWNER_GMAIL'] as const;

      try {
        for (const envMode of environments) {
          for (const varToOmit of requiredVars) {
            workerEnv.ENV = envMode;
            workerEnv.ADMIN_PASSWORD = 'admin-password-test-123';
            workerEnv.OWNER_GMAIL = 'alex@example.com';

            if (varToOmit === 'ADMIN_PASSWORD') delete workerEnv.ADMIN_PASSWORD;
            else if (varToOmit === 'OWNER_GMAIL') delete workerEnv.OWNER_GMAIL;

            const resApi = await app.fetch(
              new Request('http://localhost/api/overview', { method: 'GET' }),
              workerEnv,
            );
            expect(
              resApi.status,
              `Expected 503 for /api/overview when ${varToOmit} is missing in ${envMode}`,
            ).toBe(503);

            const resAuth = await app.fetch(
              new Request('http://localhost/auth/google/start', { method: 'GET' }),
              workerEnv,
            );
            expect(
              resAuth.status,
              `Expected 503 for /auth/google/start when ${varToOmit} is missing in ${envMode}`,
            ).toBe(503);
          }
        }
      } finally {
        workerEnv.ENV = origEnv;
        if (origPass) workerEnv.ADMIN_PASSWORD = origPass;
        if (origOwnerGmail) workerEnv.OWNER_GMAIL = origOwnerGmail;
      }
    });

    it('returns 503 when ENV=dev and ALLOW_INSECURE_DEV_AUTH is not set or false and ADMIN_PASSWORD is missing', async () => {
      delete workerEnv.ADMIN_PASSWORD;
      workerEnv.ENV = 'dev';
      workerEnv.ALLOW_INSECURE_DEV_AUTH = false;
      const res = await app.fetch(
        new Request('http://localhost/api/overview', {
          method: 'GET',
        }),
        workerEnv,
      );
      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('Admin password not configured');
    });

    it('allows request when ENV=dev and ALLOW_INSECURE_DEV_AUTH=true even with missing ADMIN_PASSWORD', async () => {
      delete workerEnv.ADMIN_PASSWORD;
      workerEnv.ENV = 'dev';
      workerEnv.ALLOW_INSECURE_DEV_AUTH = true;
      const res = await app.fetch(
        new Request('http://localhost/api/overview', {
          method: 'GET',
        }),
        workerEnv,
      );
      expect(res.status).toBe(200);
    });

    it('puts /auth/google/start and /auth/google/callback behind the same auth check', async () => {
      workerEnv.ALLOW_INSECURE_DEV_AUTH = false;
      workerEnv.ADMIN_PASSWORD = adminPassword;

      // 1. Without token -> 401
      const resStart401 = await app.fetch(
        new Request('http://localhost/auth/google/start', {
          method: 'GET',
        }),
        workerEnv,
      );
      expect(resStart401.status).toBe(401);

      const resCallback401 = await app.fetch(
        new Request('http://localhost/auth/google/callback?code=abc&state=xyz', {
          method: 'GET',
        }),
        workerEnv,
      );
      expect(resCallback401.status).toBe(401);

      // 2. With valid Bearer token -> allowed past middleware (start redirects to Google)
      workerEnv.GOOGLE_CLIENT_ID = 'test-client-id';
      workerEnv.GOOGLE_CLIENT_SECRET = 'test-client-secret';
      const resStart = await app.fetch(
        new Request('http://localhost/auth/google/start', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${adminPassword}`,
          },
        }),
        workerEnv,
      );
      // start returns 302 redirect
      expect(resStart.status).toBe(302);
    });
  });
});
