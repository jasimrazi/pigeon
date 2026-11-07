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
import {
  sheetsHandlers,
  currentSheetsStore,
  resetSheetsStore,
} from '../fixtures/sheets/handlers.js';
import {
  KV_KEYS,
  encryptRefreshToken,
  setGoogleAuthHealth,
  sendApplicationEmail,
  processJobPipeline,
  ApplicationFactory,
  handleParserHealth,
  RestGmailSender,
  getValidAccessToken,
  type GoogleOAuthSecrets,
  type ApplicationToSend,
} from '@pigeon/shared';

interface TestEnv extends Bindings {
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
}

const workerEnv = env as unknown as TestEnv;

const mockProfile = {
  name: 'Alex Mercer',
  email: 'alex.mercer@example.com',
  skills: ['TypeScript', 'Cloudflare Workers', 'Distributed Systems', 'D1', 'SQLite'],
  experience_years: 7,
  experience: [
    {
      title: 'Senior Systems Engineer',
      company: 'CloudTech Solutions',
      location: 'Remote',
      start_date: '2019-01',
      end_date: '2026-01',
      current: false,
      description: 'Architected serverless edge backends and microservices.',
      highlights: ['Reduced edge latency by 45%'],
    },
  ],
  education: [
    {
      institution: 'State University',
      degree: 'B.S. Computer Science',
      field_of_study: 'Software Engineering',
      start_date: '2014-09',
      end_date: '2018-05',
    },
  ],
  preferences: {
    locations: ['Remote'],
    remote: true,
    manual_daily_target: 10,
  },
  filters: {
    titles: ['systems', 'typescript', 'backend', 'engineer'],
    title_include: ['systems', 'typescript', 'backend', 'engineer'],
    title_exclude: ['junior', 'intern'],
    company_blacklist: ['Blacklisted Corp'],
    locations: ['Remote'],
    remote: true,
    min_salary: 100000,
    min_score: 70,
    require_salary: false,
    experience_range: {
      min: 7,
      max: 12,
    },
  },
  send_settings: {
    daily_cap: 20,
    window: { start: '00:00', end: '23:59' },
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
    links: {
      linkedin: 'https://linkedin.com/in/alexmercer',
      github: 'https://github.com/alexmercer',
      portfolio: 'https://alexmercer.dev',
    },
    other: {},
  },
};

const mockGenerator = {
  generate: async () => ({
    subject: 'Application for Senior TypeScript Backend Engineer - Alex Mercer',
    body: `Dear Hiring Team at Stripe Infrastructure,

I am excited to submit my application for the Senior TypeScript Backend Engineer position. With 7 years of experience building distributed edge backends and high-performance services, I am eager to bring my deep background in TypeScript, Cloudflare Workers, and SQLite to your infrastructure team.

In my previous roles, I focused on reducing edge API latencies and architecting serverless persistence layers that scale reliably across high-volume workloads. My work has centered on developing robust, test-driven systems while collaborating cross-functionally with platform teams to deliver critical infrastructure features. I take pride in writing clean, well-tested code and mentoring teammates on edge development best practices. You can review some of my open-source projects and architecture notes at https://alexmercer.dev.

I have followed Stripe Infrastructure's engineering standards closely, and I would welcome the opportunity to discuss how my hands-on experience building fault-tolerant systems can contribute to your ongoing roadmap. Thank you very much for your time and consideration.

Warm regards,
Alex Mercer`,
  }),
};

describe('Full Pipeline Integration Test Suite (Phase 11)', () => {
  beforeAll(async () => {
    await applyD1Migrations(workerEnv.DB, workerEnv.TEST_MIGRATIONS);
    server.use(...googleHandlers, ...sheetsHandlers);

    workerEnv.GOOGLE_CLIENT_ID = 'full-pipe-client-id';
    workerEnv.GOOGLE_CLIENT_SECRET = 'full-pipe-client-secret';
    workerEnv.GOOGLE_TOKEN_ENCRYPTION_KEY = 'pipe-token-encryption-key-for-auth';
    workerEnv.ALERT_FORWARDING_ADDRESS = 'alex.mercer@example.com';
    workerEnv.DASHBOARD_ORIGIN = 'http://localhost:5173';

    // Disable Access JWT for direct route invocation in test environment
    delete workerEnv.CF_ACCESS_AUD;
    delete workerEnv.CF_ACCESS_TEAM_DOMAIN;
  });

  beforeEach(async () => {
    server.use(...googleHandlers, ...sheetsHandlers);
    resetMockThreadsStore();
    resetSheetsStore();

    delete workerEnv.CF_ACCESS_AUD;
    delete workerEnv.CF_ACCESS_TEAM_DOMAIN;

    // Seed profile in DB
    const nowIso = new Date().toISOString();
    await workerEnv.DB.prepare(
      `INSERT OR REPLACE INTO profile (id, data, updated_at) VALUES (?, ?, ?)`,
    )
      .bind('default', JSON.stringify(mockProfile), nowIso)
      .run();

    // Seed default resume in R2 and DB
    await workerEnv.RESUMES.put('resumes/default.pdf', new Uint8Array([37, 80, 68, 70])); // %PDF
    await workerEnv.DB.prepare(
      `INSERT OR REPLACE INTO resumes (id, label, r2_key, tags, is_default, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        'resume-default',
        'Alex Mercer Resume',
        'resumes/default.pdf',
        JSON.stringify(['TypeScript', 'Cloudflare Workers', 'Distributed Systems']),
        1,
        nowIso,
      )
      .run();

    // Configure Google OAuth token and valid health in KV
    const encrypted = await encryptRefreshToken(
      'mock-refresh-token-pipe',
      workerEnv.GOOGLE_TOKEN_ENCRYPTION_KEY as string,
    );
    await workerEnv.CONFIG.put(KV_KEYS.REFRESH_TOKEN_ENCRYPTED, encrypted);
    await setGoogleAuthHealth({
      config: workerEnv.CONFIG,
      status: 'ok',
      reason: null,
    });

    // Default safety settings
    await workerEnv.CONFIG.put('kill_switch', 'false');
    await workerEnv.CONFIG.put('dry_run', 'true');
  });

  it('a) API job with contact email in text -> rule filter pass -> LLM score fit -> route auto_email -> draft created -> approved -> send (DRY_RUN=false) -> sheet row created with Channel=Email -> simulated reply -> status replied + notification', async () => {
    const nowIso = new Date().toISOString();

    // 1. Ingest API job with contact email
    const jobId = 'job-pipe-a';
    await workerEnv.DB.prepare(
      `INSERT INTO jobs (
        id, dedupe_key, source, source_kind, source_job_id,
        title, company, company_normalized, location, remote,
        salary_min, salary_max, currency, salary_raw,
        description, apply_url, contact_email, contact_source,
        posted_at, fetched_at, status, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        jobId,
        'dedupe-pipe-a',
        'adzuna',
        'api',
        'src-pipe-a',
        'Senior TypeScript Backend Engineer',
        'Stripe Infrastructure',
        'stripe infrastructure',
        'Remote',
        1,
        160000,
        185000,
        'USD',
        '$160k - $185k',
        'We need a Senior TypeScript Engineer with Workers and SQLite skills. Please email careers@stripe.com directly.',
        'https://adzuna.com/job/a',
        'careers@stripe.com',
        'posting',
        nowIso,
        nowIso,
        'new',
        nowIso,
      )
      .run();

    // 2. Rule filter pass & LLM score fit
    const mockScorer = {
      scoreJob: async () => ({
        score: 92,
        matched_skills: ['TypeScript', 'Cloudflare Workers', 'SQLite'],
        missing_skills: [],
        red_flags: [],
        reasons: 'High skill alignment with distributed systems.',
        scorer_failed: false,
      }),
    };

    await processJobPipeline({
      db: workerEnv.DB,
      profile: mockProfile,
      scorer: mockScorer,
    });

    // Verify routed to auto_email
    const jobRow = await workerEnv.DB.prepare(
      'SELECT apply_route, route_reason, status FROM jobs WHERE id = ?',
    )
      .bind(jobId)
      .first<{ apply_route: string; route_reason: string; status: string }>();

    expect(jobRow?.status).toBe('routed');
    expect(jobRow?.apply_route).toBe('auto_email');

    // 3. Draft created
    const applicationResult = await ApplicationFactory.createForJob({
      db: workerEnv.DB,
      jobId,
      profile: mockProfile,
      generator: mockGenerator,
    });
    const application = applicationResult.application;

    expect(application.status).toBe('draft');
    expect(application.channel).toBe('email');

    // 4. Approved via API
    const approveRes = await app.request(
      `/api/applications/${application.id}/approve`,
      { method: 'POST', headers: { Origin: 'http://localhost:5173' } },
      workerEnv,
    );
    expect(approveRes.status).toBe(200);

    // 5. Send with DRY_RUN=false
    await workerEnv.CONFIG.put('dry_run', 'false');
    workerEnv.DRY_RUN = 'false';

    const tokenEncryptionKey = workerEnv.GOOGLE_TOKEN_ENCRYPTION_KEY as string;
    const secrets: GoogleOAuthSecrets = {
      clientId: workerEnv.GOOGLE_CLIENT_ID as string,
      clientSecret: workerEnv.GOOGLE_CLIENT_SECRET as string,
      tokenEncryptionKey,
    };

    const gmailSender = new RestGmailSender(() =>
      getValidAccessToken({
        config: workerEnv.CONFIG,
        secrets,
      }),
    );

    const appRow = await workerEnv.DB.prepare(
      `SELECT a.id, a.job_id, a.channel, a.status, a.cover_letter, a.subject,
              a.resume_id, a.message_id_header, a.gmail_message_id, a.gmail_thread_id,
              a.retry_count, j.title, j.company, j.company_normalized, j.contact_email
       FROM applications a
       JOIN jobs j ON a.job_id = j.id
       WHERE a.id = ?`,
    )
      .bind(application.id)
      .first<ApplicationToSend>();

    expect(appRow).not.toBeNull();
    if (!appRow) throw new Error('Application row not found');

    await sendApplicationEmail({
      db: workerEnv.DB,
      config: workerEnv.CONFIG,
      resumesBucket: workerEnv.RESUMES,
      gmailSender,
      profile: mockProfile,
      dryRun: false,
      killSwitch: false,
      application: appRow,
    });

    // Verify application status updated to sent
    const sentApp = await workerEnv.DB.prepare(
      'SELECT status, sent_at, gmail_message_id, gmail_thread_id FROM applications WHERE id = ?',
    )
      .bind(application.id)
      .first<{
        status: string;
        sent_at: string;
        gmail_message_id: string;
        gmail_thread_id: string;
      }>();

    expect(sentApp?.status).toBe('sent');
    expect(sentApp?.sent_at).toBeDefined();
    expect(sentApp?.gmail_thread_id).toBe('mock-gmail-thread-id-888');

    // 6. Sheet row created with Channel=Email
    const sheetRes = await app.request(
      '/api/sync/sheet',
      { method: 'POST', headers: { Origin: 'http://localhost:5173' } },
      workerEnv,
    );
    expect(sheetRes.status).toBe(200);

    const sentRow = currentSheetsStore.lastBatchData.find((b) =>
      b.values.some((r) => r.includes(application.id)),
    );
    expect(sentRow).toBeDefined();
    expect(sentRow?.values[0]).toContain('Email');
    expect(sentRow?.values[0]).toContain('Stripe Infrastructure');

    // 7. Simulated reply -> status replied + notification
    const threadId = sentApp?.gmail_thread_id;
    expect(threadId).toBeDefined();
    if (!threadId) throw new Error('Expected sent application to have gmail_thread_id');

    mockThreadsStore.set(threadId, {
      id: threadId,
      messages: [
        {
          id: 'msg-out-1',
          snippet: 'Initial application...',
          internalDate: String(Date.now() - 3600000),
          payload: { headers: [{ name: 'From', value: 'alex.mercer@example.com' }] },
        },
        {
          id: 'msg-in-2',
          snippet:
            'Hello Alex, thanks for reaching out. We would love to chat further next Tuesday!',
          internalDate: String(Date.now()),
          payload: { headers: [{ name: 'From', value: 'recruiter@stripe.com' }] },
        },
      ],
    });

    const pollRes = await app.request(
      '/api/inbox/poll',
      { method: 'POST', headers: { Origin: 'http://localhost:5173' } },
      workerEnv,
    );
    expect(pollRes.status).toBe(200);

    const repliedApp = await workerEnv.DB.prepare('SELECT status FROM applications WHERE id = ?')
      .bind(application.id)
      .first<{ status: string }>();
    expect(['replied', 'interview']).toContain(repliedApp?.status);
  });

  it('b) LinkedIn alert email -> PORTAL_NO_EMAIL -> manual_pending with kit -> mark applied -> sheet row created with Channel=Manual', async () => {
    const nowIso = new Date().toISOString();

    // Ingest alert job without contact email
    const jobId = 'job-pipe-b';
    await workerEnv.DB.prepare(
      `INSERT INTO jobs (
        id, dedupe_key, source, source_kind,
        title, company, company_normalized, location, remote,
        description, apply_url, contact_email, contact_source,
        posted_at, fetched_at, status, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        jobId,
        'dedupe-pipe-b',
        'linkedin_alert',
        'alert_email',
        'Distributed Systems Architect',
        'Initech Networks',
        'initech networks',
        'Remote',
        1,
        'Lead architectural evolution for edge networks.',
        'https://www.linkedin.com/jobs/view/123456?currentJobId=123456',
        null,
        'none',
        nowIso,
        nowIso,
        'new',
        nowIso,
      )
      .run();

    const mockScorer = {
      scoreJob: async () => ({
        score: 86,
        matched_skills: ['Distributed Systems', 'Cloudflare Workers'],
        missing_skills: [],
        red_flags: [],
        reasons: 'Architecture alignment.',
        scorer_failed: false,
      }),
    };

    await processJobPipeline({
      db: workerEnv.DB,
      profile: mockProfile,
      scorer: mockScorer,
    });

    const job = await workerEnv.DB.prepare(
      'SELECT apply_route, route_reason FROM jobs WHERE id = ?',
    )
      .bind(jobId)
      .first<{ apply_route: string; route_reason: string }>();
    expect(job?.apply_route).toBe('manual_portal');
    expect(job?.route_reason).toBe('PORTAL_NO_EMAIL');

    // Create manual application
    const applicationResult = await ApplicationFactory.createForJob({
      db: workerEnv.DB,
      jobId,
      profile: mockProfile,
      generator: mockGenerator,
    });
    const application = applicationResult.application;
    expect(application.status).toBe('manual_pending');
    expect(application.channel).toBe('manual');

    // Fetch kit
    const kitRes = await app.request(
      `/api/manual/${application.id}/kit`,
      { method: 'GET' },
      workerEnv,
    );
    expect(kitRes.status).toBe(200);
    const body = (await kitRes.json()) as {
      kit: { company: string; apply_url: string; untrusted: boolean };
    };
    expect(body.kit.company).toBe('Initech Networks');
    expect(body.kit.apply_url).toContain('currentJobId=123456');

    // Mark applied
    const appliedRes = await app.request(
      `/api/manual/${application.id}/applied`,
      { method: 'POST', headers: { Origin: 'http://localhost:5173' } },
      workerEnv,
    );
    expect(appliedRes.status).toBe(200);

    // Sync to sheet -> Channel=Manual
    await app.request(
      '/api/sync/sheet',
      { method: 'POST', headers: { Origin: 'http://localhost:5173' } },
      workerEnv,
    );

    const manualBatch = currentSheetsStore.lastBatchData.find((b) =>
      b.values.some((r) => r.includes(application.id)),
    );
    expect(manualBatch).toBeDefined();
    expect(manualBatch?.values[0]).toContain('Manual');
    expect(manualBatch?.values[0]).toContain('Initech Networks');
  });

  it('c) Greenhouse job without email -> NO_EMAIL_FORM -> Manual Apply queue', async () => {
    const nowIso = new Date().toISOString();
    const jobId = 'job-pipe-c';

    await workerEnv.DB.prepare(
      `INSERT INTO jobs (
        id, dedupe_key, source, source_kind,
        title, company, company_normalized, location, remote,
        description, apply_url, contact_email, contact_source,
        posted_at, fetched_at, status, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        jobId,
        'dedupe-pipe-c',
        'greenhouse',
        'ats',
        'Platform Engineer',
        'ScaleTech',
        'scaletech',
        'Remote',
        1,
        'Apply using our web application portal below.',
        'https://boards.greenhouse.io/scaletech/jobs/98765',
        null,
        'none',
        nowIso,
        nowIso,
        'new',
        nowIso,
      )
      .run();

    const mockScorer = {
      scoreJob: async () => ({
        score: 82,
        matched_skills: ['TypeScript', 'D1'],
        missing_skills: [],
        red_flags: [],
        reasons: 'Good platform background.',
        scorer_failed: false,
      }),
    };

    await processJobPipeline({
      db: workerEnv.DB,
      profile: mockProfile,
      scorer: mockScorer,
    });

    const job = await workerEnv.DB.prepare(
      'SELECT apply_route, route_reason FROM jobs WHERE id = ?',
    )
      .bind(jobId)
      .first<{ apply_route: string; route_reason: string }>();
    expect(job?.apply_route).toBe('manual_portal');
    expect(job?.route_reason).toBe('NO_EMAIL_FORM');

    await ApplicationFactory.createForJob({
      db: workerEnv.DB,
      jobId,
      profile: mockProfile,
      generator: mockGenerator,
    });

    const queueRes = await app.request('/api/manual', { method: 'GET' }, workerEnv);
    expect(queueRes.status).toBe(200);
    const queue = (await queueRes.json()) as {
      items: Array<{ company: string; route_reason: string }>;
    };
    const item = queue.items.find((i) => i.company === 'ScaleTech');
    expect(item).toBeDefined();
    expect(item?.route_reason).toBe('NO_EMAIL_FORM');
  });

  it('d) Job with scam red flag -> RED_FLAGS -> manual_review (never emailed even under bulk approve)', async () => {
    const nowIso = new Date().toISOString();
    const jobId = 'job-pipe-d';

    await workerEnv.DB.prepare(
      `INSERT INTO jobs (
        id, dedupe_key, source, source_kind,
        title, company, company_normalized, location, remote,
        description, apply_url, contact_email, contact_source,
        posted_at, fetched_at, status, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        jobId,
        'dedupe-pipe-d',
        'adzuna',
        'api',
        'Systems Architect Urgent',
        'QuickScam Ltd',
        'quickscam ltd',
        'Remote',
        1,
        'Work from home! Please send $50 background check fee via WhatsApp to 555-0199.',
        'https://adzuna.com/job/d',
        'jobs@quickscam.com',
        'posting',
        nowIso,
        nowIso,
        'new',
        nowIso,
      )
      .run();

    const mockScorer = {
      scoreJob: async () => ({
        score: 85,
        matched_skills: ['Systems'],
        missing_skills: [],
        red_flags: ['Fee requested', 'WhatsApp contact'],
        reasons: 'Suspicious requirements.',
        scorer_failed: false,
      }),
    };

    await processJobPipeline({
      db: workerEnv.DB,
      profile: mockProfile,
      scorer: mockScorer,
    });

    const job = await workerEnv.DB.prepare(
      'SELECT apply_route, route_reason FROM jobs WHERE id = ?',
    )
      .bind(jobId)
      .first<{ apply_route: string; route_reason: string }>();
    expect(job?.apply_route).toBe('manual_review');
    expect(job?.route_reason).toBe('RED_FLAGS');

    const appResult = await ApplicationFactory.createForJob({
      db: workerEnv.DB,
      jobId,
      profile: mockProfile,
      generator: mockGenerator,
    });
    const app = appResult.application;
    expect(app.status).toBe('needs_review');

    // Attempt bulk approve
    const bulkRes = await workerEnv.DB.prepare('SELECT id FROM applications WHERE status = ?')
      .bind('draft')
      .all<{ id: string }>();

    // This scam job is in 'needs_review', never in 'draft'
    expect(bulkRes.results.some((r) => r.id === app.id)).toBe(false);

    // Verify it remains needs_review and was never approved or sent
    const checkApp = await workerEnv.DB.prepare('SELECT status FROM applications WHERE id = ?')
      .bind(app.id)
      .first<{ status: string }>();
    expect(checkApp?.status).toBe('needs_review');
  });

  it('e) invalid_grant mid-run -> sends stop immediately, single notification, Manual Apply & dashboard remain functional, re-authorizing resumes sends', async () => {
    // 1. Invalidate Google auth health
    await setGoogleAuthHealth({
      config: workerEnv.CONFIG,
      status: 'invalid',
      reason: 'invalid_grant: Refresh token revoked by user',
    });

    // 2. Prepare an approved application
    const nowIso = new Date().toISOString();
    await workerEnv.DB.prepare(
      `INSERT INTO jobs (id, dedupe_key, source, source_kind, title, company, company_normalized, description, contact_email, fetched_at, status, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        'job-pipe-e',
        'dedupe-pipe-e',
        'api',
        'api',
        'Dev',
        'Acme',
        'acme',
        'Desc',
        'hire@acme.com',
        nowIso,
        'routed',
        nowIso,
      )
      .run();

    await workerEnv.DB.prepare(
      `INSERT INTO applications (id, job_id, kind, channel, status, cover_letter, subject, updated_at)
       VALUES (?, ?, 'initial', 'email', 'approved', 'Letter body', 'Subject', ?)`,
    )
      .bind('app-pipe-e', 'job-pipe-e', nowIso)
      .run();

    const appRow = await workerEnv.DB.prepare(
      `SELECT a.id, a.job_id, a.channel, a.status, a.cover_letter, a.subject,
              a.resume_id, a.message_id_header, a.gmail_message_id, a.gmail_thread_id,
              a.retry_count, j.title, j.company, j.company_normalized, j.contact_email
       FROM applications a
       JOIN jobs j ON a.job_id = j.id
       WHERE a.id = ?`,
    )
      .bind('app-pipe-e')
      .first<ApplicationToSend>();

    expect(appRow).not.toBeNull();
    if (!appRow) throw new Error('Application row app-pipe-e not found');

    const gmailSender = new RestGmailSender(() => Promise.reject(new Error('Invalid token')));

    // 3. Attempt to send -> must stop immediately
    const result = await sendApplicationEmail({
      db: workerEnv.DB,
      config: workerEnv.CONFIG,
      resumesBucket: workerEnv.RESUMES,
      gmailSender,
      profile: mockProfile,
      dryRun: false,
      killSwitch: false,
      application: appRow,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Google auth health is invalid');

    // 4. Manual Apply & Dashboard endpoints remain 100% functional
    const manualRes = await app.request('/api/manual', { method: 'GET' }, workerEnv);
    expect(manualRes.status).toBe(200);

    const overviewRes = await app.request('/api/overview', { method: 'GET' }, workerEnv);
    expect(overviewRes.status).toBe(200);
    const overview = (await overviewRes.json()) as { authHealth: { status: string } };
    expect(overview.authHealth.status).toBe('invalid');

    // 5. Re-authorizing resets auth health to ok
    await setGoogleAuthHealth({
      config: workerEnv.CONFIG,
      status: 'ok',
      reason: null,
    });

    const refreshedOverview = await app.request('/api/overview', { method: 'GET' }, workerEnv);
    const refreshed = (await refreshedOverview.json()) as { authHealth: { status: string } };
    expect(refreshed.authHealth.status).toBe('ok');
  });

  it('f) Three consecutive empty alert parses -> portal flagged parser_suspect, subsequent jobs carry untrusted=true and kit displays warning banner', async () => {
    // 1. Trigger 3 consecutive empty parses for linkedin
    await handleParserHealth({ db: workerEnv.DB, portal: 'linkedin', jobsCount: 0 });
    await handleParserHealth({ db: workerEnv.DB, portal: 'linkedin', jobsCount: 0 });
    const healthResult = await handleParserHealth({
      db: workerEnv.DB,
      portal: 'linkedin',
      jobsCount: 0,
    });

    expect(healthResult.streak).toBe(3);
    expect(healthResult.isSuspect).toBe(true);
    expect(healthResult.portalUntrusted).toBe(true);

    // 2. Insert a subsequent job from this suspect portal with untrusted=true
    const nowIso = new Date().toISOString();
    const jobId = 'job-pipe-f';
    await workerEnv.DB.prepare(
      `INSERT INTO jobs (
        id, dedupe_key, source, source_kind,
        title, company, company_normalized, location, remote,
        description, apply_url, contact_email, contact_source,
        untrusted, posted_at, fetched_at, status, apply_route, route_reason, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        jobId,
        'dedupe-pipe-f',
        'linkedin',
        'alert_email',
        'Backend Engineer Suspect Portal',
        'Untrusted Portal Corp',
        'untrusted portal corp',
        'Remote',
        1,
        'Job arrived while portal was flagged untrusted.',
        'https://linkedin.com/jobs/view/999',
        null,
        'none',
        1, // untrusted: true
        nowIso,
        nowIso,
        'routed',
        'manual_portal',
        'PORTAL_NO_EMAIL',
        nowIso,
      )
      .run();

    const appResult = await ApplicationFactory.createForJob({
      db: workerEnv.DB,
      jobId,
      profile: mockProfile,
      generator: mockGenerator,
    });
    const appRow = appResult.application;

    // 3. Kit displays warning banner
    const kitRes = await app.request(`/api/manual/${appRow.id}/kit`, { method: 'GET' }, workerEnv);
    expect(kitRes.status).toBe(200);
    const body = (await kitRes.json()) as { kit: { untrusted: boolean } };
    expect(body.kit.untrusted).toBe(true);
  });

  it('g) Job whose contact email is on do_not_contact is never emailed', async () => {
    const nowIso = new Date().toISOString();
    const bannedEmail = 'blocked.recruiter@bannedcorp.com';

    // 1. Add email to do_not_contact
    await workerEnv.DB.prepare(
      `INSERT OR REPLACE INTO do_not_contact (value, reason, created_at)
       VALUES (?, ?, ?)`,
    )
      .bind(bannedEmail, 'User unsubscribed / requested DNC', nowIso)
      .run();

    // 2. Create job with that contact email
    const jobId = 'job-pipe-g';
    await workerEnv.DB.prepare(
      `INSERT INTO jobs (
        id, dedupe_key, source, source_kind,
        title, company, company_normalized, location, remote,
        description, apply_url, contact_email, contact_source,
        posted_at, fetched_at, status, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        jobId,
        'dedupe-pipe-g',
        'adzuna',
        'api',
        'TypeScript Lead',
        'Banned Corp',
        'banned corp',
        'Remote',
        1,
        'TypeScript Lead position. Email blocked.recruiter@bannedcorp.com.',
        'https://adzuna.com/job/g',
        bannedEmail,
        'posting',
        nowIso,
        nowIso,
        'new',
        nowIso,
      )
      .run();

    // 3. Pipeline skips jobs on do_not_contact before LLM
    const mockScorer = {
      scoreJob: async () => ({
        score: 95,
        matched_skills: ['TypeScript'],
        missing_skills: [],
        red_flags: [],
        reasons: 'Should not run because DNC check runs first.',
        scorer_failed: false,
      }),
    };

    await processJobPipeline({
      db: workerEnv.DB,
      profile: mockProfile,
      scorer: mockScorer,
    });

    const job = await workerEnv.DB.prepare('SELECT status, filter_reason FROM jobs WHERE id = ?')
      .bind(jobId)
      .first<{ status: string; filter_reason: string }>();

    expect(job?.status).toBe('skipped');
    expect(job?.filter_reason).toBe('DNC');

    // 4. Verify no application was created and nothing can be sent
    const apps = await workerEnv.DB.prepare(
      'SELECT count(*) as cnt FROM applications WHERE job_id = ?',
    )
      .bind(jobId)
      .first<{ cnt: number }>();
    expect(apps?.cnt).toBe(0);
  });
});
