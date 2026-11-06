import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { applyD1Migrations, env } from 'cloudflare:test';
import { app } from './index.js';
import type { Bindings } from './env.js';
import { server } from '../fixtures/server.js';
import { http, HttpResponse } from 'msw';
import {
  bytesToBase64Url,
  clearJwksCache,
  type JwkKey,
  type JwksResponse,
} from '@pigeon/shared';

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

    keyPair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    );

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

  it('handles CORS preflight OPTIONS requests with 204 and headers', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/overview', {
        method: 'OPTIONS',
        headers: {
          Origin: dashboardOrigin,
        },
      }),
      workerEnv,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(dashboardOrigin);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });
});
