import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { applyD1Migrations, env } from 'cloudflare:test';
import { app } from './index.js';
import type { Bindings } from './env.js';
import { server } from '../fixtures/server.js';
import { http, HttpResponse } from 'msw';
import { bytesToBase64Url, clearJwksCache, type JwkKey, type JwksResponse } from '@pigeon/shared';

interface TestEnv extends Bindings {
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
}

const workerEnv = env as unknown as TestEnv;

describe('Worker Cloudflare Access & API Security Middleware', () => {
  let keyPair: CryptoKeyPair;
  let publicJwk: JwkKey;
  const keyId = 'worker-access-key-1';
  const teamDomain = 'security-team.cloudflareaccess.com';
  const audience = 'worker-aud-tag-999';
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

    keyPair = (await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair;

    const exported = (await crypto.subtle.exportKey('jwk', keyPair.publicKey)) as unknown as JwkKey;
    publicJwk = {
      ...exported,
      kid: keyId,
      alg: 'RS256',
      use: 'sig',
    };
  });

  beforeEach(() => {
    clearJwksCache();
    // Configure CF Access env vars
    workerEnv.CF_ACCESS_TEAM_DOMAIN = teamDomain;
    workerEnv.CF_ACCESS_AUD = audience;
    workerEnv.DASHBOARD_ORIGIN = dashboardOrigin;
    workerEnv.ALLOW_INSECURE_DEV_AUTH = false;

    // Register MSW handler in beforeEach because setup.ts resets handlers after each test
    server.use(
      http.get(`https://${teamDomain}/cdn-cgi/access/certs`, () => {
        const jwks: JwksResponse = { keys: [publicJwk] };
        return HttpResponse.json(jwks);
      }),
    );
  });

  afterAll(() => {
    delete workerEnv.CF_ACCESS_TEAM_DOMAIN;
    delete workerEnv.CF_ACCESS_AUD;
    delete workerEnv.DASHBOARD_ORIGIN;
    clearJwksCache();
  });

  async function createSignedJwt(
    payloadOverrides: Record<string, unknown> = {},
    keyIdToUse = keyId,
    tamperSignature = false,
  ): Promise<string> {
    const header = {
      alg: 'RS256',
      kid: keyIdToUse,
      typ: 'JWT',
    };

    const nowSec = Math.floor(Date.now() / 1000);
    const payload = {
      iss: `https://${teamDomain}`,
      aud: audience,
      sub: 'owner@example.com',
      email: 'owner@example.com',
      iat: nowSec - 60,
      exp: nowSec + 3600,
      ...payloadOverrides,
    };

    const headerB64 = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(header)));
    const payloadB64 = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
    const dataToSign = new TextEncoder().encode(`${headerB64}.${payloadB64}`);

    const signatureBytes = new Uint8Array(
      await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, dataToSign),
    );

    if (tamperSignature && signatureBytes.length > 0) {
      signatureBytes[0] = (signatureBytes[0] ?? 0) ^ 0xff;
    }

    const signatureB64 = bytesToBase64Url(signatureBytes);
    return `${headerB64}.${payloadB64}.${signatureB64}`;
  }

  it('rejects /api requests with no JWT (401)', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/overview', {
        method: 'GET',
      }),
      workerEnv,
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Missing Cf-Access-Jwt-Assertion header');
  });

  it('rejects /api requests with a bad signature (401)', async () => {
    const badToken = await createSignedJwt({}, keyId, true /* tamper */);
    const res = await app.fetch(
      new Request('http://localhost/api/overview', {
        method: 'GET',
        headers: {
          'Cf-Access-Jwt-Assertion': badToken,
        },
      }),
      workerEnv,
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Invalid signature');
  });

  it('rejects /api requests with a wrong audience (401)', async () => {
    const wrongAudToken = await createSignedJwt({ aud: 'wrong-audience-tag' });
    const res = await app.fetch(
      new Request('http://localhost/api/overview', {
        method: 'GET',
        headers: {
          'Cf-Access-Jwt-Assertion': wrongAudToken,
        },
      }),
      workerEnv,
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Invalid audience');
  });

  it('rejects /api requests with an expired token (401)', async () => {
    const expiredSec = Math.floor(Date.now() / 1000) - 100;
    const expiredToken = await createSignedJwt({ exp: expiredSec });
    const res = await app.fetch(
      new Request('http://localhost/api/overview', {
        method: 'GET',
        headers: {
          'Cf-Access-Jwt-Assertion': expiredToken,
        },
      }),
      workerEnv,
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Token expired');
  });

  it('accepts /api requests with a valid Cloudflare Access token (200)', async () => {
    const validToken = await createSignedJwt();
    const res = await app.fetch(
      new Request('http://localhost/api/overview', {
        method: 'GET',
        headers: {
          'Cf-Access-Jwt-Assertion': validToken,
        },
      }),
      workerEnv,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sendsToday: number; authHealth: unknown };
    expect(body.authHealth).toBeDefined();
  });

  it('rejects access token with non-RS256 algorithm (401)', async () => {
    const header = { alg: 'HS256', kid: keyId, typ: 'JWT' };
    const payload = {
      iss: `https://${teamDomain}`,
      aud: audience,
      email: 'alex@example.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const headerB64 = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(header)));
    const payloadB64 = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
    const token = `${headerB64}.${payloadB64}.fakeSignature`;

    const res = await app.fetch(
      new Request('http://localhost/api/overview', {
        method: 'GET',
        headers: { 'Cf-Access-Jwt-Assertion': token },
      }),
      workerEnv,
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Unsupported algorithm: expected RS256');
  });

  it('Access middleware refreshes JWKS once on unknown kid (200)', async () => {
    // Generate rotated key pair
    const keyPairRotated = (await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair;

    const exportedRotated = (await crypto.subtle.exportKey(
      'jwk',
      keyPairRotated.publicKey,
    )) as unknown as JwkKey;
    const publicJwkRotated: JwkKey = {
      ...exportedRotated,
      kid: 'rotated-worker-key-2',
      alg: 'RS256',
      use: 'sig',
    };

    // Sign token with rotated key
    const nowSec = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', kid: 'rotated-worker-key-2', typ: 'JWT' };
    const payload = {
      iss: `https://${teamDomain}`,
      aud: audience,
      sub: 'alex@example.com',
      email: 'alex@example.com',
      exp: nowSec + 3600,
    };
    const headerB64 = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(header)));
    const payloadB64 = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
    const dataToSign = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const sigBytes = new Uint8Array(
      await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPairRotated.privateKey, dataToSign),
    );
    const rotatedToken = `${headerB64}.${payloadB64}.${bytesToBase64Url(sigBytes)}`;

    // MSW handler returns refreshed key set on subsequent call
    let fetchCount = 0;
    server.use(
      http.get(`https://${teamDomain}/cdn-cgi/access/certs`, () => {
        fetchCount++;
        if (fetchCount === 1) {
          // Cached response initially only has key 1
          return HttpResponse.json({ keys: [publicJwk] });
        }
        // Refreshed response includes key 2
        return HttpResponse.json({ keys: [publicJwk, publicJwkRotated] });
      }),
    );

    const res = await app.fetch(
      new Request('http://localhost/api/overview', {
        method: 'GET',
        headers: { 'Cf-Access-Jwt-Assertion': rotatedToken },
      }),
      workerEnv,
    );
    expect(res.status).toBe(200);
    expect(fetchCount).toBe(2);
  });

  it('Access middleware requires email claim to match CF_ACCESS_ALLOWED_EMAIL', async () => {
    workerEnv.CF_ACCESS_ALLOWED_EMAIL = 'owner@example.com';
    try {
      // 1. Token with matching email succeeds
      const tokenMatching = await createSignedJwt({ email: 'owner@example.com' });
      const resOk = await app.fetch(
        new Request('http://localhost/api/overview', {
          method: 'GET',
          headers: { 'Cf-Access-Jwt-Assertion': tokenMatching },
        }),
        workerEnv,
      );
      expect(resOk.status).toBe(200);

      // 2. Token with mismatched email fails with 401
      const tokenMismatched = await createSignedJwt({ email: 'intruder@example.com' });
      const resFail = await app.fetch(
        new Request('http://localhost/api/overview', {
          method: 'GET',
          headers: { 'Cf-Access-Jwt-Assertion': tokenMismatched },
        }),
        workerEnv,
      );
      expect(resFail.status).toBe(401);
      const failJson = (await resFail.json()) as { error: string };
      expect(failJson.error).toContain('Forbidden email');
    } finally {
      delete workerEnv.CF_ACCESS_ALLOWED_EMAIL;
    }
  });

  it('rejects missing or wrong Origin on every state-changing route including multipart /api/resumes (403)', async () => {
    const validToken = await createSignedJwt();

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
      { method: 'POST', path: '/api/sheets/sync', body: '{}' },
      { method: 'POST', path: '/api/inbox/poll', body: '{}' },
      // Multipart /api/resumes
      { method: 'POST', path: '/api/resumes' },
    ];

    for (const route of stateChangingRoutes) {
      // 1. Missing Origin -> 403
      const headersMissingOrigin: Record<string, string> = {
        'Cf-Access-Jwt-Assertion': validToken,
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
        'Cf-Access-Jwt-Assertion': validToken,
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
    const validToken = await createSignedJwt();
    const res = await app.fetch(
      new Request('http://localhost/api/settings/dry-run', {
        method: 'POST',
        headers: {
          'Cf-Access-Jwt-Assertion': validToken,
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
    const validToken = await createSignedJwt();
    const res = await app.fetch(
      new Request('http://localhost/api/settings/dry-run', {
        method: 'POST',
        headers: {
          'Cf-Access-Jwt-Assertion': validToken,
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

  it('returns 503 when any required config variable is missing in staging or prod on /api and /auth', async () => {
    const origEnv = workerEnv.ENV;
    const origAud = workerEnv.CF_ACCESS_AUD;
    const origTeamDomain = workerEnv.CF_ACCESS_TEAM_DOMAIN;
    const origAllowedEmail = workerEnv.CF_ACCESS_ALLOWED_EMAIL;
    const origOwnerGmail = workerEnv.OWNER_GMAIL;

    const environments = ['staging', 'prod'];
    const requiredVars = [
      'CF_ACCESS_AUD',
      'CF_ACCESS_TEAM_DOMAIN',
      'CF_ACCESS_ALLOWED_EMAIL',
      'OWNER_GMAIL',
    ] as const;

    try {
      for (const envMode of environments) {
        for (const varToOmit of requiredVars) {
          workerEnv.ENV = envMode;
          workerEnv.CF_ACCESS_AUD = 'worker-aud-tag-999';
          workerEnv.CF_ACCESS_TEAM_DOMAIN = 'security-team.cloudflareaccess.com';
          workerEnv.CF_ACCESS_ALLOWED_EMAIL = 'alex@example.com';
          workerEnv.OWNER_GMAIL = 'alex@example.com';

          // Delete target variable without dynamic delete
          if (varToOmit === 'CF_ACCESS_AUD') delete workerEnv.CF_ACCESS_AUD;
          else if (varToOmit === 'CF_ACCESS_TEAM_DOMAIN') delete workerEnv.CF_ACCESS_TEAM_DOMAIN;
          else if (varToOmit === 'CF_ACCESS_ALLOWED_EMAIL')
            delete workerEnv.CF_ACCESS_ALLOWED_EMAIL;
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
      if (origAud) workerEnv.CF_ACCESS_AUD = origAud;
      if (origTeamDomain) workerEnv.CF_ACCESS_TEAM_DOMAIN = origTeamDomain;
      if (origAllowedEmail) workerEnv.CF_ACCESS_ALLOWED_EMAIL = origAllowedEmail;
      if (origOwnerGmail) workerEnv.OWNER_GMAIL = origOwnerGmail;
    }
  });

  it('returns 503 when ENV=dev and ALLOW_INSECURE_DEV_AUTH is not set or false and vars are missing', async () => {
    delete workerEnv.CF_ACCESS_AUD;
    delete workerEnv.CF_ACCESS_TEAM_DOMAIN;
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
    expect(body.error).toContain('Cloudflare Access not configured');
  });

  it('allows request when ENV=dev and ALLOW_INSECURE_DEV_AUTH=true even with missing vars', async () => {
    delete workerEnv.CF_ACCESS_AUD;
    delete workerEnv.CF_ACCESS_TEAM_DOMAIN;
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

  it('rejects request with 401 when email claim does not match CF_ACCESS_ALLOWED_EMAIL', async () => {
    workerEnv.CF_ACCESS_ALLOWED_EMAIL = 'correct-owner@example.com';
    try {
      const token = await createSignedJwt({ email: 'wrong-user@example.com' });
      const res = await app.fetch(
        new Request('http://localhost/api/overview', {
          method: 'GET',
          headers: {
            'Cf-Access-Jwt-Assertion': token,
          },
        }),
        workerEnv,
      );
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('Forbidden email');
    } finally {
      delete workerEnv.CF_ACCESS_ALLOWED_EMAIL;
    }
  });

  it('puts /auth/google/start and /auth/google/callback behind the same Access check', async () => {
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

    // 2. With valid Access token -> allowed past middleware (start redirects to Google)
    workerEnv.GOOGLE_CLIENT_ID = 'test-client-id';
    workerEnv.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    const validToken = await createSignedJwt();
    const resStart = await app.fetch(
      new Request('http://localhost/auth/google/start', {
        method: 'GET',
        headers: {
          'Cf-Access-Jwt-Assertion': validToken,
        },
      }),
      workerEnv,
    );
    // start returns 302 redirect
    expect(resStart.status).toBe(302);
  });
});
