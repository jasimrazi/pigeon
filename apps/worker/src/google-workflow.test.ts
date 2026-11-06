import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { applyD1Migrations, env } from 'cloudflare:test';
import { app } from './index.js';
import type { Bindings } from './env.js';
import { server } from '../fixtures/server.js';
import { googleHandlers } from '../fixtures/google/handlers.js';

interface TestEnv extends Bindings {
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
}

const workerEnv = env as unknown as TestEnv;

const mockProfile = {
  name: 'Alex Mercer',
  email: 'alex.mercer@example.com',
  skills: ['TypeScript', 'Cloudflare Workers', 'Distributed Systems'],
  experience: [
    {
      title: 'Senior Systems Engineer',
      company: 'Tech Corp',
      location: 'Remote',
      start_date: '2019-01',
      end_date: '2026-01',
      current: false,
      description: 'Distributed systems.',
      highlights: [],
    },
  ],
  education: [],
  preferences: {
    locations: ['Remote'],
    remote: true,
  },
  filters: {
    titles: ['Systems Engineer'],
    locations: ['Remote'],
    company_blacklist: [],
    min_score: 70,
    require_salary: false,
    experience_range: { min: 7, max: 12 },
  },
  send_settings: {
    daily_cap: 20,
    window: { start: '00:00', end: '23:59' }, // Wide window for tests
    timezone: 'UTC',
    ramp_base: 5,
    ramp_step: 2,
    auto_approve_above_score: 85,
  },
  answers: {
    notice_period: '2 weeks',
    current_ctc: '$160,000',
    expected_ctc: '$180,000',
    work_authorisation: 'Citizen',
    links: { portfolio: 'https://alexmercer.dev' },
    other: {},
  },
};

const validCoverLetter = `Dear Hiring Team at Stripe,

I am writing to enthusiastically submit my application for the Senior Systems Engineer position. With 7 years of hands-on experience designing and operating distributed systems and high-throughput backend services, I am excited about the opportunity to contribute to Stripe's world-class platform and infrastructure engineering efforts.

Throughout my career, I have specialized in building robust TypeScript and Cloudflare Workers services, optimizing database access patterns, and ensuring low-latency communication across distributed clusters. At my previous roles, I led initiatives to improve service resilience and decrease edge API response times under heavy traffic loads. You can review my architecture notes and projects at https://alexmercer.dev.

I deeply admire Stripe's engineering culture and dedication to reliability and developer experience. I welcome the opportunity to discuss how my technical background in distributed systems and systems architecture aligns with your team's goals. Thank you very much for your time and consideration.

Warm regards,
Alex Mercer`;

describe('Worker Google OAuth & Gmail Sending API', () => {
  beforeAll(async () => {
    await applyD1Migrations(workerEnv.DB, workerEnv.TEST_MIGRATIONS);
    server.use(...googleHandlers);

    // Set workerEnv vars for Google
    workerEnv.GOOGLE_CLIENT_ID = 'test-worker-client-id';
    workerEnv.GOOGLE_CLIENT_SECRET = 'test-worker-client-secret';
    workerEnv.GOOGLE_TOKEN_ENCRYPTION_KEY = 'test-encryption-key-for-wrangler';

    const nowIso = new Date().toISOString();
    await workerEnv.DB.prepare(
      `INSERT OR REPLACE INTO profile (id, data, updated_at) VALUES (?, ?, ?)`,
    )
      .bind('default', JSON.stringify(mockProfile), nowIso)
      .run();

    await workerEnv.DB.prepare(
      `INSERT OR REPLACE INTO resumes (id, label, r2_key, tags, is_default, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind('res-gw-1', 'Systems Resume', 'resumes/standard.pdf', '["ts"]', 1, nowIso)
      .run();

    await workerEnv.RESUMES.put('resumes/standard.pdf', new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  });

  beforeEach(() => {
    server.use(...googleHandlers);
  });

  it('GET /auth/google/start redirects with 302 to Google authorization URL', async () => {
    const res = await app.fetch(new Request('http://localhost/auth/google/start'), workerEnv);
    expect(res.status).toBe(302);
    const location = res.headers.get('Location');
    expect(location).toContain('https://accounts.google.com/o/oauth2/v2/auth?');
    expect(location).toContain('client_id=test-worker-client-id');
    expect(location).toContain('gmail.send');
    expect(location).toContain('spreadsheets');
  });

  it('GET /auth/google/callback exchanges code, encrypts refresh token, and restores health', async () => {
    const res = await app.fetch(
      new Request('http://localhost/auth/google/callback?code=mock_auth_code_123'),
      workerEnv,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; message: string };
    expect(data.ok).toBe(true);

    // Verify encrypted token in KV
    const stored = await workerEnv.CONFIG.get('google_refresh_token_encrypted');
    expect(stored).not.toBeNull();

    // Verify health is ok
    const healthJson = await workerEnv.CONFIG.get('auth_health');
    expect(healthJson).toContain('"status":"ok"');
  });

  it('GET /api/auth/google/health returns health state', async () => {
    const res = await app.fetch(new Request('http://localhost/api/auth/google/health'), workerEnv);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; health: { status: string } };
    expect(data.ok).toBe(true);
    expect(data.health.status).toBe('ok');
  });

  it('POST /api/auth/google/ping pings Gmail users.getProfile successfully', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/auth/google/ping', {
        method: 'POST',
        headers: { Origin: 'http://localhost:5173' },
      }),
      workerEnv,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; health: { status: string } };
    expect(data.ok).toBe(true);
    expect(data.health.status).toBe('ok');
  });

  it('POST /api/applications/:id/approve approves needs_review only with confirm_risk=true', async () => {
    const nowIso = new Date().toISOString();

    // Insert Job and Application
    await workerEnv.DB.prepare(
      `INSERT OR REPLACE INTO jobs (
        id, dedupe_key, source, source_kind, source_job_id,
        title, company, company_normalized, location, remote,
        description, contact_email, contact_source, status, apply_route, updated_at, fetched_at
      ) VALUES ('job-appr-w1', 'd-appr-1', 'ats', 'ats', 'src-1', 'Senior Systems Engineer', 'Stripe', 'stripe', 'Remote', 1, 'Desc', 'jobs@stripe.com', 'posting', 'routed', 'auto_email', ?, ?)`,
    )
      .bind(nowIso, nowIso)
      .run();

    await workerEnv.DB.prepare(
      `INSERT OR REPLACE INTO applications (
        id, job_id, kind, channel, cover_letter, subject, status, updated_at
      ) VALUES ('app-appr-w1', 'job-appr-w1', 'initial', 'email', ?, 'Application for Senior Systems Engineer', 'needs_review', ?)`,
    )
      .bind(validCoverLetter, nowIso)
      .run();

    // 1. Without confirm_risk: rejected
    const failRes = await app.fetch(
      new Request('http://localhost/api/applications/app-appr-w1/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
        body: JSON.stringify({ confirm_risk: false }),
      }),
      workerEnv,
    );
    expect(failRes.status).toBe(500);

    // 2. With confirm_risk: approved
    const okRes = await app.fetch(
      new Request('http://localhost/api/applications/app-appr-w1/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
        body: JSON.stringify({ confirm_risk: true }),
      }),
      workerEnv,
    );
    expect(okRes.status).toBe(200);

    const updated = await workerEnv.DB.prepare('SELECT status FROM applications WHERE id = ?')
      .bind('app-appr-w1')
      .first<{ status: string }>();
    expect(updated?.status).toBe('approved');
  });

  it('POST /api/applications/approve-bulk bulk approves eligible applications', async () => {
    const nowIso = new Date().toISOString();

    // App 1: Valid
    await workerEnv.DB.prepare(
      `INSERT OR REPLACE INTO jobs (id, dedupe_key, source, source_kind, title, company, company_normalized, description, contact_email, contact_source, status, apply_route, updated_at, fetched_at)
       VALUES ('job-bulk-1', 'd-b-1', 'ats', 'ats', 'Senior Systems Engineer', 'Stripe', 'stripe', 'Desc', 'jobs@stripe.com', 'posting', 'routed', 'auto_email', ?, ?)`,
    )
      .bind(nowIso, nowIso)
      .run();

    await workerEnv.DB.prepare(
      `INSERT OR REPLACE INTO applications (id, job_id, kind, channel, cover_letter, subject, status, updated_at)
       VALUES ('app-bulk-good', 'job-bulk-1', 'initial', 'email', ?, 'Application', 'draft', ?)`,
    )
      .bind(validCoverLetter, nowIso)
      .run();

    // App 2: Guessed contact (ineligible)
    await workerEnv.DB.prepare(
      `INSERT OR REPLACE INTO jobs (id, dedupe_key, source, source_kind, title, company, company_normalized, description, contact_email, contact_source, status, apply_route, updated_at, fetched_at)
       VALUES ('job-bulk-2', 'd-b-2', 'ats', 'ats', 'Senior Systems Engineer', 'Stripe', 'stripe', 'Desc', 'careers@stripe.com', 'guessed', 'routed', 'auto_email', ?, ?)`,
    )
      .bind(nowIso, nowIso)
      .run();

    await workerEnv.DB.prepare(
      `INSERT OR REPLACE INTO applications (id, job_id, kind, channel, cover_letter, subject, status, updated_at)
       VALUES ('app-bulk-bad', 'job-bulk-2', 'initial', 'email', ?, 'Application', 'draft', ?)`,
    )
      .bind(validCoverLetter, nowIso)
      .run();

    const res = await app.fetch(
      new Request('http://localhost/api/applications/approve-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
        body: JSON.stringify({ ids: ['app-bulk-good', 'app-bulk-bad'] }),
      }),
      workerEnv,
    );

    expect(res.status).toBe(200);
    const data = (await res.json()) as { approved: string[]; rejected: Array<{ id: string }> };
    expect(data.approved).toEqual(['app-bulk-good']);
    expect(data.rejected.some((r) => r.id === 'app-bulk-bad')).toBe(true);
  });

  it('POST /api/applications/:id/send handles DRY_RUN and live sending', async () => {
    const nowIso = new Date().toISOString();

    await workerEnv.DB.prepare(
      `INSERT OR REPLACE INTO jobs (id, dedupe_key, source, source_kind, title, company, company_normalized, description, contact_email, contact_source, status, apply_route, updated_at, fetched_at)
       VALUES ('job-send-w1', 'd-s-w1', 'ats', 'ats', 'Senior Systems Engineer', 'Stripe', 'stripe', 'Desc', 'jobs@stripe.com', 'posting', 'routed', 'auto_email', ?, ?)`,
    )
      .bind(nowIso, nowIso)
      .run();

    await workerEnv.DB.prepare(
      `INSERT OR REPLACE INTO applications (id, job_id, kind, channel, cover_letter, subject, resume_id, status, updated_at)
       VALUES ('app-send-w1', 'job-send-w1', 'initial', 'email', ?, 'Application for Senior Systems Engineer', 'res-gw-1', 'approved', ?)`,
    )
      .bind(validCoverLetter, nowIso)
      .run();

    // 1. DRY_RUN=true: writes event and keeps status approved
    workerEnv.DRY_RUN = 'true';
    const dryRes = await app.fetch(
      new Request('http://localhost/api/applications/app-send-w1/send', {
        method: 'POST',
        headers: { Origin: 'http://localhost:5173' },
      }),
      workerEnv,
    );
    expect(dryRes.status).toBe(200);
    const dryData = (await dryRes.json()) as { ok: boolean; dryRun: boolean };
    expect(dryData.dryRun).toBe(true);

    const event = await workerEnv.DB.prepare(
      `SELECT type, payload FROM events WHERE entity_id = 'app-send-w1' AND type = 'email_dry_run'`,
    ).first<{ type: string; payload: string }>();
    expect(event).not.toBeNull();
    expect(event?.payload).toContain('jobs@stripe.com');

    // 2. DRY_RUN=false: sends live via Gmail REST API mock, sets status sent, records gmail IDs
    workerEnv.DRY_RUN = 'false';
    const liveRes = await app.fetch(
      new Request('http://localhost/api/applications/app-send-w1/send', {
        method: 'POST',
        headers: { Origin: 'http://localhost:5173' },
      }),
      workerEnv,
    );
    expect(liveRes.status).toBe(200);
    const liveData = (await liveRes.json()) as { ok: boolean; success: boolean };
    expect(liveData.success).toBe(true);

    const updatedApp = await workerEnv.DB.prepare(
      `SELECT status, gmail_message_id, gmail_thread_id, sent_at FROM applications WHERE id = 'app-send-w1'`,
    ).first<{
      status: string;
      gmail_message_id: string;
      gmail_thread_id: string;
      sent_at: string;
    }>();

    expect(updatedApp?.status).toBe('sent');
    expect(updatedApp?.gmail_message_id).toBe('mock-gmail-msg-id-777');
    expect(updatedApp?.gmail_thread_id).toBe('mock-gmail-thread-id-888');
    expect(updatedApp?.sent_at).not.toBeNull();

    // Verify companies_contacted upserted
    const contactRow = await workerEnv.DB.prepare(
      `SELECT company_normalized, last_channel FROM companies_contacted WHERE company_normalized = 'stripe'`,
    ).first<{ company_normalized: string; last_channel: string }>();

    expect(contactRow?.company_normalized).toBe('stripe');
    expect(contactRow?.last_channel).toBe('email');
  });
});
