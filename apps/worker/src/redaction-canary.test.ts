import { describe, it, expect, beforeAll, beforeEach, vi, afterEach } from 'vitest';
import { applyD1Migrations, env } from 'cloudflare:test';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { app } from './index.js';
import type { Bindings } from './env.js';
import { invalidateConfigCache, setGoogleAuthHealth } from '@pigeon/shared';

interface TestEnv extends Bindings {
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
}

const workerEnv = env as unknown as TestEnv;
const masterKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

// Unique Canary Secrets
const CANARY_CLIENT_ID = 'CANARY_CLIENT_ID_12345678901234567890';
const CANARY_CLIENT_SECRET = 'CANARY_GOCSPX_SECRET_9876543210_XYZ';
const CANARY_GEMINI_KEY = 'CANARY_AIzaSy_KEY_44556677889900_ABC';
const CANARY_BOT_TOKEN = 'CANARY_TELEGRAM_TOKEN_112233445566_DEF';
const CANARY_MALICIOUS_INPUT = 'CANARY_MALICIOUS_PAYLOAD_DROP_ALL_SETTINGS_777';

const allCanaries = [
  CANARY_CLIENT_ID,
  CANARY_CLIENT_SECRET,
  CANARY_GEMINI_KEY,
  CANARY_BOT_TOKEN,
  CANARY_MALICIOUS_INPUT,
];

// MSW Server mocking upstream services that deliberately echo back secrets in error bodies
const server = setupServer(
  // Google OAuth token endpoint echoes back client secret in error description
  http.post('https://oauth2.googleapis.com/token', () => {
    return HttpResponse.json(
      {
        error: 'invalid_client',
        error_description: `Upstream error: client secret ${CANARY_CLIENT_SECRET} is invalid`,
      },
      { status: 400 },
    );
  }),

  // Google Gemini API endpoint echoes back Gemini API key in error message
  http.post('https://generativelanguage.googleapis.com/v1beta/models/:model', () => {
    return HttpResponse.json(
      {
        error: {
          code: 400,
          message: `API_KEY_INVALID: Upstream rejected key ${CANARY_GEMINI_KEY}`,
          status: 'INVALID_ARGUMENT',
        },
      },
      { status: 400 },
    );
  }),

  // Telegram bot API endpoint echoes back bot token in error description
  http.post('https://api.telegram.org/bot:token/sendMessage', () => {
    return HttpResponse.json(
      {
        ok: false,
        error_code: 401,
        description: `Unauthorized: Token ${CANARY_BOT_TOKEN} is malformed or revoked`,
      },
      { status: 401 },
    );
  }),

  // Google Sheets metadata endpoint echoes auth header in error body
  http.get('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId', () => {
    return HttpResponse.json(
      {
        error: {
          code: 403,
          message: `The caller does not have permission to access spreadsheet with token ${CANARY_CLIENT_SECRET}`,
          status: 'PERMISSION_DENIED',
        },
      },
      { status: 403 },
    );
  }),
);

describe('Redaction Canary Verification (Stage 7)', () => {
  const allowedOrigin = 'http://localhost:5173';
  const consoleLogs: string[] = [];

  // Console spies
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    await applyD1Migrations(workerEnv.DB, workerEnv.TEST_MIGRATIONS);
    server.listen({ onUnhandledRequest: 'bypass' });
  });

  afterEach(() => {
    server.resetHandlers();
    logSpy?.mockRestore();
    warnSpy?.mockRestore();
    errorSpy?.mockRestore();
  });

  beforeEach(async () => {
    invalidateConfigCache();
    consoleLogs.length = 0;

    // Spy on console output to capture any accidental leak
    logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      consoleLogs.push(args.map(String).join(' '));
    });
    warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args) => {
      consoleLogs.push(args.map(String).join(' '));
    });
    errorSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      consoleLogs.push(args.map(String).join(' '));
    });

    workerEnv.ENV = 'dev';
    workerEnv.ALLOW_INSECURE_DEV_AUTH = true;
    workerEnv.SETTINGS_ENCRYPTION_KEY = masterKey;

    await workerEnv.DB.prepare('DELETE FROM app_settings').run();
    await workerEnv.DB.prepare('DELETE FROM events WHERE entity = ?').bind('settings').run();

    // Mark Google auth health as ok so test endpoints can run
    await setGoogleAuthHealth({
      config: workerEnv.CONFIG,
      status: 'ok',
      reason: null,
    });
  });

  it('canary secret values are NEVER returned in GET /api/settings response', async () => {
    // 1. Store canary secrets via PUT
    await app.request(
      '/api/settings/GOOGLE_CLIENT_ID',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Origin: allowedOrigin },
        body: JSON.stringify({ value: CANARY_CLIENT_ID }),
      },
      workerEnv,
    );

    await app.request(
      '/api/settings/GOOGLE_CLIENT_SECRET',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Origin: allowedOrigin },
        body: JSON.stringify({ value: CANARY_CLIENT_SECRET }),
      },
      workerEnv,
    );

    await app.request(
      '/api/settings/GEMINI_API_KEY',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Origin: allowedOrigin },
        body: JSON.stringify({ value: CANARY_GEMINI_KEY }),
      },
      workerEnv,
    );

    await app.request(
      '/api/settings/TELEGRAM_BOT_TOKEN',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Origin: allowedOrigin },
        body: JSON.stringify({ value: CANARY_BOT_TOKEN }),
      },
      workerEnv,
    );

    // 2. Fetch settings
    const res = await app.request(
      '/api/settings',
      {
        headers: { Origin: allowedOrigin },
      },
      workerEnv,
    );

    expect(res.status).toBe(200);
    const bodyText = await res.text();

    // Assert zero canary secrets appear in the response body
    for (const canary of allCanaries) {
      expect(bodyText).not.toContain(canary);
    }

    // But masked hint (last 4 chars) is present for confirmation
    expect(bodyText).toContain('_XYZ');
    expect(bodyText).toContain('_ABC');
    expect(bodyText).toContain('_DEF');
  });

  it('canary secrets are NEVER included in non-secret export (GET /api/settings/export)', async () => {
    await app.request(
      '/api/settings/GOOGLE_CLIENT_SECRET',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Origin: allowedOrigin },
        body: JSON.stringify({ value: CANARY_CLIENT_SECRET }),
      },
      workerEnv,
    );

    await app.request(
      '/api/settings/GOOGLE_SHEET_ID',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Origin: allowedOrigin },
        body: JSON.stringify({ value: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms' }),
      },
      workerEnv,
    );

    const res = await app.request(
      '/api/settings/export',
      {
        headers: { Origin: allowedOrigin },
      },
      workerEnv,
    );

    expect(res.status).toBe(200);
    const bodyText = await res.text();

    for (const canary of allCanaries) {
      expect(bodyText).not.toContain(canary);
    }
    // Only non-secret GOOGLE_SHEET_ID is present
    expect(bodyText).toContain('GOOGLE_SHEET_ID');
    expect(bodyText).not.toContain('GOOGLE_CLIENT_SECRET');
  });

  it('PUT validation errors NEVER echo malicious input containing canaries', async () => {
    // Submit invalid email containing canary to USER_AGENT_CONTACT_EMAIL
    const badEmail = `invalid-email-${CANARY_MALICIOUS_INPUT}`;
    const res = await app.request(
      '/api/settings/USER_AGENT_CONTACT_EMAIL',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Origin: allowedOrigin },
        body: JSON.stringify({ value: badEmail }),
      },
      workerEnv,
    );

    expect(res.status).toBe(400);
    const errorBody = await res.text();

    // Must return 400 but NEVER echo the malicious submitted value
    expect(errorBody).not.toContain(CANARY_MALICIOUS_INPUT);
    expect(errorBody).not.toContain(badEmail);
  });

  it('test endpoints NEVER pass through upstream response bodies echoing canary secrets', async () => {
    // Configure canaries in settings
    await app.request(
      '/api/settings/GOOGLE_CLIENT_ID',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Origin: allowedOrigin },
        body: JSON.stringify({ value: CANARY_CLIENT_ID }),
      },
      workerEnv,
    );

    await app.request(
      '/api/settings/GOOGLE_CLIENT_SECRET',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Origin: allowedOrigin },
        body: JSON.stringify({ value: CANARY_CLIENT_SECRET }),
      },
      workerEnv,
    );

    await app.request(
      '/api/settings/LLM_PROVIDER',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Origin: allowedOrigin },
        body: JSON.stringify({ value: 'gemini' }),
      },
      workerEnv,
    );

    await app.request(
      '/api/settings/GEMINI_API_KEY',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Origin: allowedOrigin },
        body: JSON.stringify({ value: CANARY_GEMINI_KEY }),
      },
      workerEnv,
    );

    await app.request(
      '/api/settings/TELEGRAM_BOT_TOKEN',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Origin: allowedOrigin },
        body: JSON.stringify({ value: CANARY_BOT_TOKEN }),
      },
      workerEnv,
    );

    await app.request(
      '/api/settings/TELEGRAM_CHAT_ID',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Origin: allowedOrigin },
        body: JSON.stringify({ value: '123456789' }),
      },
      workerEnv,
    );

    // 1. Test google-oauth-config endpoint (upstream echoes CANARY_CLIENT_SECRET)
    const googleRes = await app.request(
      '/api/settings/test/google-oauth-config',
      {
        method: 'POST',
        headers: { Origin: allowedOrigin },
      },
      workerEnv,
    );
    const googleBody = await googleRes.text();
    expect(googleBody).not.toContain(CANARY_CLIENT_SECRET);
    expect(googleBody).not.toContain('Upstream error');

    // 2. Test LLM endpoint (upstream echoes CANARY_GEMINI_KEY)
    const llmRes = await app.request(
      '/api/settings/test/llm',
      {
        method: 'POST',
        headers: { Origin: allowedOrigin },
      },
      workerEnv,
    );
    const llmBody = await llmRes.text();
    expect(llmBody).not.toContain(CANARY_GEMINI_KEY);
    expect(llmBody).not.toContain('API_KEY_INVALID');

    // 3. Test Telegram endpoint (upstream echoes CANARY_BOT_TOKEN)
    const telegramRes = await app.request(
      '/api/settings/test/telegram',
      {
        method: 'POST',
        headers: { Origin: allowedOrigin },
      },
      workerEnv,
    );
    const telegramBody = await telegramRes.text();
    expect(telegramBody).not.toContain(CANARY_BOT_TOKEN);
    expect(telegramBody).not.toContain('Unauthorized: Token');
  });

  it('canary secrets NEVER appear in console logs or events database audit trail', async () => {
    // 1. Check all intercepted console outputs
    const fullConsoleOutput = consoleLogs.join('\n');
    for (const canary of allCanaries) {
      expect(
        fullConsoleOutput,
        `Canary secret "${canary}" leaked into console logs!`,
      ).not.toContain(canary);
    }

    // 2. Check events table
    const { results } = await workerEnv.DB.prepare('SELECT payload FROM events').all<{
      payload: string;
    }>();
    const allPayloads = (results || []).map((r) => r.payload).join(' ');

    for (const canary of allCanaries) {
      expect(
        allPayloads,
        `Canary secret "${canary}" leaked into events table audit trail!`,
      ).not.toContain(canary);
    }
  });
});
