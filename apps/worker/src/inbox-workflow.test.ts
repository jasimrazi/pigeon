import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { applyD1Migrations, env } from 'cloudflare:test';
import { app } from './index.js';
import type { Bindings } from './env.js';
import { server } from '../fixtures/server.js';
import {
  googleHandlers,
  mockThreadsStore,
  resetMockThreadsStore,
} from '../fixtures/google/handlers.js';
import { KV_KEYS, encryptRefreshToken, setGoogleAuthHealth } from '@pigeon/shared';

interface TestEnv extends Bindings {
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
}

const workerEnv = env as unknown as TestEnv;

describe('Worker Inbox Poller & Outcome Tracking Workflow', () => {
  beforeAll(async () => {
    await applyD1Migrations(workerEnv.DB, workerEnv.TEST_MIGRATIONS);
    server.use(...googleHandlers);

    workerEnv.GOOGLE_CLIENT_ID = 'test-inbox-client-id';
    workerEnv.GOOGLE_CLIENT_SECRET = 'test-inbox-client-secret';
    workerEnv.GOOGLE_TOKEN_ENCRYPTION_KEY = 'test-encryption-key-for-wrangler';

    const nowIso = new Date().toISOString();
    await workerEnv.DB.prepare(
      `INSERT OR REPLACE INTO profile (id, data, updated_at) VALUES (?, ?, ?)`,
    )
      .bind(
        'default',
        JSON.stringify({
          name: 'Alex Mercer',
          email: 'alex@example.com',
          skills: ['TypeScript', 'Cloudflare Workers', 'Distributed Systems'],
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
            max_follow_ups: 1,
          },
          answers: {
            notice_period: '2 weeks',
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
    resetMockThreadsStore();
    server.use(...googleHandlers);

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

  it('POST /api/inbox/poll handles bounce, auto-reply, and human reply correctly', async () => {
    const nowIso = new Date().toISOString();

    // 1. Insert jobs
    await workerEnv.DB.prepare(
      `INSERT OR REPLACE INTO jobs (
        id, dedupe_key, source, source_kind, title, company, company_normalized,
        description, fetched_at, status, updated_at, contact_email
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        'job-inbox-bounce',
        'dedupe-inbox-bounce',
        'adzuna',
        'api',
        'Backend Engineer',
        'BadCompany Inc',
        'badcompany inc',
        'Job description',
        nowIso,
        'routed',
        nowIso,
        'bounce-target@badcompany.com',
      )
      .run();

    await workerEnv.DB.prepare(
      `INSERT OR REPLACE INTO jobs (
        id, dedupe_key, source, source_kind, title, company, company_normalized,
        description, fetched_at, status, updated_at, contact_email
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        'job-inbox-reply',
        'dedupe-inbox-reply',
        'lever',
        'ats',
        'Staff Architect',
        'GoodCompany Inc',
        'goodcompany inc',
        'Job description',
        nowIso,
        'routed',
        nowIso,
        'recruiter@goodcompany.com',
      )
      .run();

    await workerEnv.DB.prepare(
      `INSERT OR REPLACE INTO jobs (
        id, dedupe_key, source, source_kind, title, company, company_normalized,
        description, fetched_at, status, updated_at, contact_email
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        'job-inbox-ooo',
        'dedupe-inbox-ooo',
        'greenhouse',
        'ats',
        'Frontend Lead',
        'VacationCorp',
        'vacationcorp',
        'Job description',
        nowIso,
        'routed',
        nowIso,
        'vacation@vacationcorp.com',
      )
      .run();

    // 2. Insert applications (all sent in the last 30 days)
    await workerEnv.DB.prepare(
      `INSERT OR REPLACE INTO applications (
        id, job_id, kind, channel, status, sent_at, gmail_thread_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        'app-inbox-bounce',
        'job-inbox-bounce',
        'initial',
        'email',
        'sent',
        nowIso,
        'thread-bounce-1',
        nowIso,
      )
      .run();

    await workerEnv.DB.prepare(
      `INSERT OR REPLACE INTO applications (
        id, job_id, kind, channel, status, sent_at, gmail_thread_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        'app-inbox-reply',
        'job-inbox-reply',
        'initial',
        'email',
        'sent',
        nowIso,
        'thread-reply-1',
        nowIso,
      )
      .run();

    await workerEnv.DB.prepare(
      `INSERT OR REPLACE INTO applications (
        id, job_id, kind, channel, status, sent_at, gmail_thread_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        'app-inbox-ooo',
        'job-inbox-ooo',
        'initial',
        'email',
        'sent',
        nowIso,
        'thread-ooo-1',
        nowIso,
      )
      .run();

    // 3. Set up mock thread responses
    mockThreadsStore.set('thread-bounce-1', {
      id: 'thread-bounce-1',
      messages: [
        { id: 'm1', threadId: 'thread-bounce-1', snippet: 'Initial pitch email' },
        {
          id: 'm2',
          threadId: 'thread-bounce-1',
          snippet: 'Delivery Status Notification (Failure) - 550 User not found',
          payload: {
            headers: [
              { name: 'From', value: 'mailer-daemon@googlemail.com' },
              { name: 'Subject', value: 'Delivery Status Notification (Failure)' },
            ],
          },
        },
      ],
    });

    mockThreadsStore.set('thread-reply-1', {
      id: 'thread-reply-1',
      messages: [
        { id: 'm1', threadId: 'thread-reply-1', snippet: 'Initial pitch email' },
        {
          id: 'm2',
          threadId: 'thread-reply-1',
          snippet: 'Hi Alex, thank you for reaching out! We would love to chat further next week.',
          payload: {
            headers: [
              { name: 'From', value: 'recruiter@goodcompany.com' },
              { name: 'Subject', value: 'Re: Application for Staff Architect' },
            ],
          },
        },
      ],
    });

    mockThreadsStore.set('thread-ooo-1', {
      id: 'thread-ooo-1',
      messages: [
        { id: 'm1', threadId: 'thread-ooo-1', snippet: 'Initial pitch email' },
        {
          id: 'm2',
          threadId: 'thread-ooo-1',
          snippet: 'I am currently out of the office on annual leave with no email access.',
          payload: {
            headers: [
              { name: 'From', value: 'vacation@vacationcorp.com' },
              { name: 'Subject', value: 'Automatic reply: Out of office' },
              { name: 'Auto-Submitted', value: 'auto-replied' },
            ],
          },
        },
      ],
    });

    // 4. Trigger POST /api/inbox/poll
    const res = await app.fetch(
      new Request('http://localhost/api/inbox/poll', {
        method: 'POST',
      }),
      workerEnv,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      polledThreads: number;
      bouncedCount: number;
      repliedCount: number;
      autoReplyCount: number;
    };
    expect(body.ok).toBe(true);
    expect(body.polledThreads).toBe(3);
    expect(body.bouncedCount).toBe(1);
    expect(body.repliedCount).toBe(1);
    expect(body.autoReplyCount).toBe(1);

    // 5. Verify D1 status changes
    // Bounced application -> status = bounced
    const bouncedApp = await workerEnv.DB.prepare(
      `SELECT status FROM applications WHERE id = 'app-inbox-bounce'`,
    ).first<{ status: string }>();
    expect(bouncedApp?.status).toBe('bounced');

    // Bounce target added to do_not_contact
    const dnc = await workerEnv.DB.prepare(
      `SELECT value FROM do_not_contact WHERE value = 'bounce-target@badcompany.com'`,
    ).first<{ value: string }>();
    expect(dnc?.value).toBe('bounce-target@badcompany.com');

    // Human reply application -> status = replied
    const repliedApp = await workerEnv.DB.prepare(
      `SELECT status FROM applications WHERE id = 'app-inbox-reply'`,
    ).first<{ status: string }>();
    expect(repliedApp?.status).toBe('replied');

    // OOO auto-reply -> status remains sent
    const oooApp = await workerEnv.DB.prepare(
      `SELECT status FROM applications WHERE id = 'app-inbox-ooo'`,
    ).first<{ status: string }>();
    expect(oooApp?.status).toBe('sent');

    // 6. Idempotency test: calling POST /api/inbox/poll again should see threads unchanged
    // Note: bounced applications are excluded from subsequent polls, so only replied and sent apps are polled (2 apps)
    const res2 = await app.fetch(
      new Request('http://localhost/api/inbox/poll', {
        method: 'POST',
      }),
      workerEnv,
    );
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as {
      ok: boolean;
      polledThreads: number;
      unchangedThreads: number;
      bouncedCount: number;
      repliedCount: number;
    };
    expect(body2.polledThreads).toBe(2);
    expect(body2.unchangedThreads).toBe(2);
    expect(body2.bouncedCount).toBe(0);
    expect(body2.repliedCount).toBe(0);
  });

  it('Creates a polite follow-up in draft after 6 business days with no reply', async () => {
    // 7 days ago (skipping weekend, >= 6 business days)
    const sevenBusinessDaysAgo = new Date('2026-10-26T10:00:00Z').toISOString();
    const nowIso = new Date('2026-11-04T10:00:00Z').toISOString();

    await workerEnv.DB.prepare(
      `INSERT OR REPLACE INTO jobs (
        id, dedupe_key, source, source_kind, title, company, company_normalized,
        description, fetched_at, status, updated_at, contact_email
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        'job-inbox-followup',
        'dedupe-inbox-followup',
        'weworkremotely',
        'api',
        'Core Engineer',
        'Basecamp',
        'basecamp',
        'Job description for Basecamp',
        nowIso,
        'routed',
        nowIso,
        'jobs@basecamp.com',
      )
      .run();

    await workerEnv.DB.prepare(
      `INSERT OR REPLACE INTO applications (
        id, job_id, kind, channel, status, sent_at, gmail_thread_id, message_id_header,
        follow_up_count, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        'app-inbox-followup',
        'job-inbox-followup',
        'initial',
        'email',
        'sent',
        sevenBusinessDaysAgo,
        'thread-followup-1',
        '<msg-basecamp-orig@pigeon.local>',
        0,
        sevenBusinessDaysAgo,
      )
      .run();

    // The thread has only the initial 1 message (no reply from employer)
    mockThreadsStore.set('thread-followup-1', {
      id: 'thread-followup-1',
      messages: [{ id: 'm1', threadId: 'thread-followup-1', snippet: 'Initial pitch' }],
    });

    const res = await app.fetch(
      new Request('http://localhost/api/inbox/poll', {
        method: 'POST',
      }),
      workerEnv,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; followUpsCreated: number };
    expect(body.ok).toBe(true);
    expect(body.followUpsCreated).toBe(1);

    // Initial application has follow_up_count incremented to 1
    const initialApp = await workerEnv.DB.prepare(
      `SELECT follow_up_count FROM applications WHERE id = 'app-inbox-followup'`,
    ).first<{ follow_up_count: number }>();
    expect(initialApp?.follow_up_count).toBe(1);

    // A new application with kind=follow_up in draft status exists
    const followUpApp = await workerEnv.DB.prepare(
      `SELECT id, kind, status, message_id_header, gmail_thread_id, notes, subject, cover_letter
       FROM applications WHERE job_id = 'job-inbox-followup' AND kind = 'follow_up'`,
    ).first<{
      id: string;
      kind: string;
      status: string;
      message_id_header: string | null;
      gmail_thread_id: string | null;
      notes: string | null;
      subject: string;
      cover_letter: string;
    }>();
    expect(followUpApp).toBeDefined();
    expect(followUpApp?.kind).toBe('follow_up');
    expect(followUpApp?.status).toBe('draft');
    expect(followUpApp?.gmail_thread_id).toBe('thread-followup-1');
    expect(followUpApp?.message_id_header).toMatch(/^<[a-f0-9-]+@pigeon\.local>$/);
    expect(followUpApp?.notes).toContain('<msg-basecamp-orig@pigeon.local>');
    expect(followUpApp?.subject).toMatch(/^Re:\s+/);
    expect(followUpApp?.cover_letter).toContain('Alex Mercer');
  });

  it('Queue consumer processes poll_inbox action', async () => {
    const batch = {
      messages: [
        {
          id: 'msg-poll-1',
          timestamp: new Date(),
          body: { action: 'poll_inbox' },
          ack: () => {},
          retry: () => {},
        },
      ],
      queue: 'pigeon-jobs',
      ackAll: () => {},
      retryAll: () => {},
    };

    const workerModule = (await import('./index.js')).default;
    await expect(
      workerModule.queue(batch as unknown as Parameters<typeof workerModule.queue>[0], workerEnv),
    ).resolves.not.toThrow();
  });

  it('Skips polling completely when Google Auth Health is invalid', async () => {
    await setGoogleAuthHealth({
      config: workerEnv.CONFIG,
      status: 'invalid',
      reason: 'Token expired',
    });

    const res = await app.fetch(
      new Request('http://localhost/api/inbox/poll', {
        method: 'POST',
      }),
      workerEnv,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; skippedAuthInvalid?: boolean };
    expect(body.skippedAuthInvalid).toBe(true);
  });
});
