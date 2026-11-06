import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { applyD1Migrations, env } from 'cloudflare:test';
import { app } from './index.js';
import type { Bindings } from './env.js';
import { server } from '../fixtures/server.js';
import { googleHandlers } from '../fixtures/google/handlers.js';
import {
  KV_KEYS,
  encryptRefreshToken,
  setGoogleAuthHealth,
  sendApplicationEmail,
} from '@pigeon/shared';

interface TestEnv extends Bindings {
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
}

const workerEnv = env as unknown as TestEnv;

describe('Worker Operations, Review Queue & Kill Switch Workflow', () => {
  beforeAll(async () => {
    await applyD1Migrations(workerEnv.DB, workerEnv.TEST_MIGRATIONS);
    server.use(...googleHandlers);

    workerEnv.GOOGLE_CLIENT_ID = 'test-ops-client-id';
    workerEnv.GOOGLE_CLIENT_SECRET = 'test-ops-client-secret';
    workerEnv.GOOGLE_TOKEN_ENCRYPTION_KEY = 'test-encryption-key-for-wrangler';

    // Disable CF Access in this test file so we test operations logic directly
    delete workerEnv.CF_ACCESS_AUD;
    delete workerEnv.CF_ACCESS_TEAM_DOMAIN;

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
          experience_years: 7,
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
            links: {
              portfolio: 'https://alexmercer.dev',
            },
            other: {},
          },
        }),
        nowIso,
      )
      .run();
  });

  beforeEach(async () => {
    server.use(...googleHandlers);
    delete workerEnv.CF_ACCESS_AUD;
    delete workerEnv.CF_ACCESS_TEAM_DOMAIN;

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
    // Ensure Kill Switch is OFF by default
    await workerEnv.CONFIG.put('kill_switch', 'false');
    await workerEnv.CONFIG.put('KILL_SWITCH', 'false');
  });

  it('Kill switch ON: send worker sends nothing, even for approved items; turning it OFF resumes sending', async () => {
    const nowIso = new Date().toISOString();

    // 1. Insert job and approved application
    await workerEnv.DB.prepare(
      `INSERT OR REPLACE INTO jobs (
        id, dedupe_key, source, source_kind, title, company, company_normalized,
        description, fetched_at, status, updated_at, contact_email, contact_source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        'job-ks-1',
        'dedupe-ks-1',
        'greenhouse',
        'ats',
        'Lead Infrastructure Engineer',
        'AcmeOps Corp',
        'acmeops corp',
        'Job description for AcmeOps Corp',
        nowIso,
        'routed',
        nowIso,
        'recruiter@acmeops.com',
        'posting',
      )
      .run();

    const validKsLetter = `Dear Hiring Team at AcmeOps Corp,

I am excited to submit my application for the Lead Infrastructure Engineer position at AcmeOps Corp. With 7 years of experience building distributed backend services and high-performance serverless systems, I am eager to bring my background in TypeScript, Cloudflare Workers, and Distributed Systems to your infrastructure team.

In my previous roles, I focused on reducing edge API latencies and developing scalable persistence layers that handle millions of requests reliably. My work has centered on developing robust, test-driven systems while collaborating cross-functionally with product teams to deliver critical platform features. You can review some of my open-source projects and architecture notes at https://alexmercer.dev.

I have followed AcmeOps Corp's mission and engineering standards closely, and I would welcome the opportunity to discuss how my hands-on experience building fault-tolerant services can contribute to your team's ongoing roadmap. Thank you very much for your time and consideration of my application.

Warm regards,
Alex Mercer`;

    await workerEnv.DB.prepare(
      `INSERT OR REPLACE INTO applications (
        id, job_id, kind, channel, status, cover_letter, subject, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        'app-ks-1',
        'job-ks-1',
        'initial',
        'email',
        'approved',
        validKsLetter,
        'Application for Lead Infrastructure Engineer',
        nowIso,
      )
      .run();

    // 2. Turn Kill Switch ON via API
    const ksRes = await app.fetch(
      new Request('http://localhost/api/settings/kill-switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
        body: JSON.stringify({ kill_switch: true, confirmed: true }),
      }),
      workerEnv,
    );
    expect(ksRes.status).toBe(200);

    // 3. Attempt to send while Kill Switch is ON -> must refuse to send!
    const sendRes1 = await app.fetch(
      new Request('http://localhost/api/applications/app-ks-1/send', {
        method: 'POST',
        headers: { Origin: 'http://localhost:5173' },
      }),
      workerEnv,
    );
    const sendBody1 = (await sendRes1.json()) as { ok: boolean; error?: string };
    expect(sendBody1.ok).toBe(false);
    expect(sendBody1.error).toContain('Kill switch is active');

    // Verify status remains approved (not sent)
    const checkApp1 = await workerEnv.DB.prepare('SELECT status FROM applications WHERE id = ?')
      .bind('app-ks-1')
      .first<{ status: string }>();
    expect(checkApp1?.status).toBe('approved');

    // 4. Turn Kill Switch OFF
    const ksOffRes = await app.fetch(
      new Request('http://localhost/api/settings/kill-switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
        body: JSON.stringify({ kill_switch: false, confirmed: true }),
      }),
      workerEnv,
    );
    expect(ksOffRes.status).toBe(200);

    // 5. Attempt send again -> resumes sending!
    // Set DRY_RUN=false for send test
    workerEnv.DRY_RUN = 'false';
    const sendRes2 = await app.fetch(
      new Request('http://localhost/api/applications/app-ks-1/send', {
        method: 'POST',
        headers: { Origin: 'http://localhost:5173' },
      }),
      workerEnv,
    );
    const sendBody2 = (await sendRes2.json()) as { ok: boolean; status?: string };
    expect(sendBody2.ok).toBe(true);

    const checkApp2 = await workerEnv.DB.prepare('SELECT status FROM applications WHERE id = ?')
      .bind('app-ks-1')
      .first<{ status: string }>();
    expect(checkApp2?.status).toBe('sent');
  });

  it('Kill switch: KV read throws -> nothing sent', async () => {
    const throwingConfig = {
      ...workerEnv.CONFIG,
      async get(key: string) {
        if (key === 'kill_switch') throw new Error('KV network fault');
        return workerEnv.CONFIG.get(key);
      },
    };

    const res = await sendApplicationEmail({
      db: workerEnv.DB,
      config: throwingConfig as unknown as Parameters<typeof sendApplicationEmail>[0]['config'],
      resumesBucket: workerEnv.RESUMES,
      gmailSender: {
        async send() {
          throw new Error('Gmail send should not be reached when KV read throws');
        },
        async searchSentByMessageId() {
          return null;
        },
      },
      profile: {
        name: 'Alex Mercer',
        email: 'alex@example.com',
        skills: ['TypeScript'],
        filters: {
          titles: ['Engineer'],
          locations: ['Remote'],
          company_blacklist: [],
          min_score: 0,
          require_salary: false,
        },
        send_settings: {
          daily_cap: 20,
          window: { start: '00:00', end: '23:59' },
          timezone: 'UTC',
          ramp_base: 5,
          ramp_step: 2,
          auto_approve_above_score: 85,
        },
        experience: [],
        education: [],
        preferences: { locations: ['Remote'], remote: true },
        answers: {
          notice_period: '',
          current_ctc: '',
          expected_ctc: '',
          work_authorisation: '',
          links: {},
          other: {},
        },
      },
      dryRun: false,
      application: {
        id: 'app-ks-fail',
        job_id: 'job-1',
        title: 'Platform Architect',
        company: 'Cloud Corp',
        contact_email: 'jobs@cloudcorp.com',
        cover_letter: 'I am excited to submit my application for the Platform Architect role...',
        status: 'approved',
      } as unknown as Parameters<typeof sendApplicationEmail>[0]['application'],
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain('Kill switch is active');
  });

  it('Editing a cover letter in the Review Queue persists and re-runs the guardrail validator', async () => {
    const nowIso = new Date().toISOString();

    await workerEnv.DB.prepare(
      `INSERT OR REPLACE INTO jobs (
        id, dedupe_key, source, source_kind, title, company, company_normalized,
        description, fetched_at, status, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        'job-edit-1',
        'dedupe-edit-1',
        'lever',
        'ats',
        'Senior Platform Engineer',
        'Vercel',
        'vercel',
        'Job description for Vercel',
        nowIso,
        'routed',
        nowIso,
      )
      .run();

    await workerEnv.DB.prepare(
      `INSERT OR REPLACE INTO applications (
        id, job_id, kind, channel, status, cover_letter, subject, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        'app-edit-1',
        'job-edit-1',
        'initial',
        'email',
        'draft',
        'Initial unverified letter body',
        'Application for Senior Platform Engineer',
        nowIso,
      )
      .run();

    // 1. Edit with missing company name -> fails guardrails
    const editRes1 = await app.fetch(
      new Request('http://localhost/api/applications/app-edit-1/letter', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
        body: JSON.stringify({
          cover_letter: 'Hi there, I am excited about the Senior Platform Engineer role.',
        }),
      }),
      workerEnv,
    );
    expect(editRes1.status).toBe(200);
    const editBody1 = (await editRes1.json()) as { ok: boolean; validator_errors: string[] };
    expect(editBody1.ok).toBe(true);
    expect(editBody1.validator_errors.length).toBeGreaterThan(0);
    expect(editBody1.validator_errors[0]).toContain("Company name 'Vercel' must be present");

    // Verify stored in D1
    const storedApp1 = await workerEnv.DB.prepare(
      'SELECT validator_errors, cover_letter FROM applications WHERE id = ?',
    )
      .bind('app-edit-1')
      .first<{ validator_errors: string; cover_letter: string }>();
    expect(storedApp1?.cover_letter).toContain('Senior Platform Engineer');
    expect(storedApp1?.validator_errors).toContain("Company name 'Vercel'");

    // 2. Edit with valid letter containing company name, role, skills, signed by Alex Mercer (150-250 words)
    const validLetter = `Dear Hiring Team at Vercel,

I am excited to submit my application for the Senior Platform Engineer position at Vercel. With 7 years of experience building distributed backend services and high-performance serverless systems, I am eager to bring my background in TypeScript, Cloudflare Workers, and Distributed Systems to your infrastructure team.

In my previous roles, I focused on reducing edge API latencies and developing scalable persistence layers that handle millions of requests reliably. My work has centered on developing robust, test-driven systems while collaborating cross-functionally with product teams to deliver critical platform features. You can review some of my open-source projects and architecture notes at https://alexmercer.dev.

I have followed Vercel's mission and engineering standards closely, and I would welcome the opportunity to discuss how my hands-on experience building fault-tolerant services can contribute to your team's ongoing roadmap. Thank you very much for your time and consideration of my application.

Warm regards,
Alex Mercer`;

    const editRes2 = await app.fetch(
      new Request('http://localhost/api/applications/app-edit-1/letter', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
        body: JSON.stringify({ cover_letter: validLetter }),
      }),
      workerEnv,
    );
    expect(editRes2.status).toBe(200);
    const editBody2 = (await editRes2.json()) as { ok: boolean; validator_errors: string[] };
    expect(editBody2.ok).toBe(true);
    // Guardrail errors should now be cleared
    expect(editBody2.validator_errors.length).toBe(0);

    const storedApp2 = await workerEnv.DB.prepare(
      'SELECT validator_errors, cover_letter FROM applications WHERE id = ?',
    )
      .bind('app-edit-1')
      .first<{ validator_errors: string | null; cover_letter: string }>();
    expect(storedApp2?.cover_letter).toBe(validLetter);
    expect(storedApp2?.validator_errors).toBeNull();
  });

  it('GET /api/overview returns system operations metrics', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/overview', {
        method: 'GET',
      }),
      workerEnv,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      sendsToday: number;
      effectiveCap: number;
      dailyCap: number;
      jobsByStatus: Record<string, number>;
      authHealth: { status: string };
      killSwitch: boolean;
    };
    expect(typeof data.sendsToday).toBe('number');
    expect(typeof data.effectiveCap).toBe('number');
    expect(typeof data.dailyCap).toBe('number');
    expect(data.authHealth.status).toBe('ok');
    expect(typeof data.killSwitch).toBe('boolean');
  });

  it('Settings validation rejects an out-of-range cap, invalid send window, or invalid min_score', async () => {
    const baseProfile = {
      name: 'Alex Mercer',
      email: 'alex@example.com',
      skills: ['TypeScript'],
      send_settings: {
        daily_cap: 20,
        window: { start: '09:00', end: '17:00' },
        timezone: 'UTC',
        ramp_base: 5,
        ramp_step: 2,
        auto_approve_above_score: 85,
      },
      experience: [],
      education: [],
      preferences: { locations: ['Remote'], remote: true },
      filters: {
        titles: ['Engineer'],
        locations: ['Remote'],
        company_blacklist: [],
        min_score: 70,
      },
      answers: {
        notice_period: '',
        current_ctc: '',
        expected_ctc: '',
        work_authorisation: '',
        links: {},
        other: {},
      },
    };

    // 1. Rejects daily_cap = 0
    const resZeroCap = await app.fetch(
      new Request('http://localhost/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
        body: JSON.stringify({
          profile: {
            ...baseProfile,
            send_settings: { ...baseProfile.send_settings, daily_cap: 0 },
          },
        }),
      }),
      workerEnv,
    );
    expect(resZeroCap.status).toBe(400);

    // 2. Rejects daily_cap = 201 (out of range max)
    const resMaxCap = await app.fetch(
      new Request('http://localhost/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
        body: JSON.stringify({
          profile: {
            ...baseProfile,
            send_settings: { ...baseProfile.send_settings, daily_cap: 201 },
          },
        }),
      }),
      workerEnv,
    );
    expect(resMaxCap.status).toBe(400);

    // 3. Rejects invalid send window format (26:00)
    const resInvalidWindow = await app.fetch(
      new Request('http://localhost/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
        body: JSON.stringify({
          profile: {
            ...baseProfile,
            send_settings: {
              ...baseProfile.send_settings,
              window: { start: '26:00', end: '17:00' },
            },
          },
        }),
      }),
      workerEnv,
    );
    expect(resInvalidWindow.status).toBe(400);

    // 4. Rejects send window with start >= end (e.g. 18:00 to 09:00)
    const resInvertedWindow = await app.fetch(
      new Request('http://localhost/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
        body: JSON.stringify({
          profile: {
            ...baseProfile,
            send_settings: {
              ...baseProfile.send_settings,
              window: { start: '18:00', end: '09:00' },
            },
          },
        }),
      }),
      workerEnv,
    );
    expect(resInvertedWindow.status).toBe(400);

    // 5. Rejects min_score < 0
    const resNegativeScore = await app.fetch(
      new Request('http://localhost/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
        body: JSON.stringify({
          profile: {
            ...baseProfile,
            filters: { ...baseProfile.filters, min_score: -5 },
          },
        }),
      }),
      workerEnv,
    );
    expect(resNegativeScore.status).toBe(400);

    // 6. Rejects min_score > 100
    const resOverScore = await app.fetch(
      new Request('http://localhost/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
        body: JSON.stringify({
          profile: {
            ...baseProfile,
            filters: { ...baseProfile.filters, min_score: 105 },
          },
        }),
      }),
      workerEnv,
    );
    expect(resOverScore.status).toBe(400);

    // 7. Accepts valid settings with score threshold min_score
    const resValid = await app.fetch(
      new Request('http://localhost/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
        body: JSON.stringify({
          profile: {
            ...baseProfile,
            filters: { ...baseProfile.filters, min_score: 75 },
          },
        }),
      }),
      workerEnv,
    );
    expect(resValid.status).toBe(200);
    const validBody = (await resValid.json()) as {
      ok: boolean;
      profile: { filters: { min_score: number } };
    };
    expect(validBody.profile.filters.min_score).toBe(75);
  });

  it('Kill switch toggle requires confirmation step', async () => {
    // Unconfirmed toggle rejected
    const resUnconfirmed = await app.fetch(
      new Request('http://localhost/api/settings/kill-switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
        body: JSON.stringify({ kill_switch: true, confirmed: false }),
      }),
      workerEnv,
    );
    expect(resUnconfirmed.status).toBe(400);
    const body = (await resUnconfirmed.json()) as { error: string };
    expect(body.error).toMatch(/confirmation/i);

    // Confirmed toggle accepted
    const resConfirmed = await app.fetch(
      new Request('http://localhost/api/settings/kill-switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
        body: JSON.stringify({ kill_switch: true, confirmed: true }),
      }),
      workerEnv,
    );
    expect(resConfirmed.status).toBe(200);
  });

  it('Switching DRY_RUN to false requires confirmation', async () => {
    // Unconfirmed switch to false rejected
    const resUnconfirmed = await app.fetch(
      new Request('http://localhost/api/settings/dry-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
        body: JSON.stringify({ dry_run: false, confirmed: false }),
      }),
      workerEnv,
    );
    expect(resUnconfirmed.status).toBe(400);

    // Confirmed switch to false accepted
    const resConfirmed = await app.fetch(
      new Request('http://localhost/api/settings/dry-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
        body: JSON.stringify({ dry_run: false, confirmed: true }),
      }),
      workerEnv,
    );
    expect(resConfirmed.status).toBe(200);
  });
});
