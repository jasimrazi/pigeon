import { describe, it, expect, beforeAll } from 'vitest';
import { applyD1Migrations, env } from 'cloudflare:test';
import { app } from './index.js';
import worker from './index.js';
import type { Bindings } from './env.js';

interface TestEnv extends Bindings {
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
}

const workerEnv = env as unknown as TestEnv;

const mockProfile = {
  name: 'Alex Mercer',
  email: 'alex.mercer@example.com',
  skills: ['TypeScript', 'Cloudflare Workers', 'Distributed Systems', 'D1', 'SQLite'],
  experience: [
    {
      title: 'Senior Systems Engineer',
      company: 'CloudTech Solutions',
      location: 'Remote',
      start_date: '2021-03',
      end_date: '2024-08',
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
      start_date: '2016-09',
      end_date: '2020-05',
    },
  ],
  preferences: {
    locations: ['Remote', 'San Francisco, CA', 'New York, NY'],
    remote: true,
    roles: ['Backend Engineer', 'Systems Engineer', 'Full Stack Engineer'],
  },
  filters: {
    title_include: ['systems', 'typescript', 'backend', 'engineer'],
    title_exclude: ['junior', 'intern', 'php'],
    company_blacklist: ['Spammy Recruitment LLC'],
    locations: ['Remote', 'USA'],
    remote: true,
    min_salary: 140000,
    min_score: 70,
    require_salary: false,
    experience_range: {
      min: 3,
      max: 10,
    },
  },
  send_settings: {
    daily_cap: 10,
    window: { start: '09:00', end: '17:00' },
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
      linkedin: 'https://linkedin.com/in/alex-mercer',
      github: 'https://github.com/alex-mercer',
      portfolio: 'https://alexmercer.dev',
    },
    other: {},
  },
};

describe('Worker Scoring & Routing Pipeline Integration', () => {
  beforeAll(async () => {
    await applyD1Migrations(workerEnv.DB, workerEnv.TEST_MIGRATIONS);
  });

  it('POST /api/pipeline/run returns 400 when profile is not configured', async () => {
    await workerEnv.DB.prepare('DELETE FROM profile WHERE id = ?').bind('default').run();

    const res = await app.request('/api/pipeline/run', { method: 'POST' }, workerEnv);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Profile not configured');
  });

  it('runs end-to-end scoring and routing pipeline on new jobs', async () => {
    const nowIso = new Date().toISOString();

    // 1. Insert profile
    await workerEnv.DB.prepare(
      `INSERT OR REPLACE INTO profile (id, data, updated_at) VALUES (?, ?, ?)`,
    )
      .bind('default', JSON.stringify(mockProfile), nowIso)
      .run();

    // Clean existing test jobs
    await workerEnv.DB.prepare('DELETE FROM jobs').run();
    await workerEnv.DB.prepare('DELETE FROM events').run();

    // 2. Insert 3 new jobs
    // Job 1: Excluded title (Junior PHP Developer)
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
        'job-worker-1',
        'dedupe-1',
        'remoteok',
        'api',
        'src-1',
        'Junior PHP Developer',
        'OldTech Corp',
        'oldtech corp',
        'Remote',
        1,
        60000,
        70000,
        'USD',
        '$60k',
        'PHP maintenance role.',
        'https://remoteok.com/job-1',
        'careers@oldtech.com',
        'posting',
        nowIso,
        nowIso,
        'new',
        nowIso,
      )
      .run();

    // Job 2: High match TypeScript Engineer with valid email -> auto_email, OK
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
        'job-worker-2',
        'dedupe-2',
        'ashby',
        'ats',
        'src-2',
        'Staff TypeScript Engineer',
        'CloudScale Systems',
        'cloudscale systems',
        'Remote',
        1,
        170000,
        190000,
        'USD',
        '$170k - $190k',
        'Build edge systems with TypeScript and SQLite. Send CV to recruiting@cloudscale.com',
        'https://ashby.com/cloudscale/2',
        'recruiting@cloudscale.com',
        'posting',
        nowIso,
        nowIso,
        'new',
        nowIso,
      )
      .run();

    // Job 3: Alert email portal job -> manual_portal, PORTAL_NO_EMAIL
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
        'job-worker-3',
        'dedupe-3',
        'linkedin_alert',
        'alert_email',
        'src-3',
        'Senior Backend Engineer',
        'PortalTech Inc',
        'portaltech inc',
        'Remote',
        1,
        160000,
        180000,
        'USD',
        '$160k',
        'Senior Backend role building cloud microservices.',
        'https://linkedin.com/jobs/view/333',
        null,
        'none',
        nowIso,
        nowIso,
        'new',
        nowIso,
      )
      .run();

    const mockAi = {
      run: async () => ({
        response: JSON.stringify({
          score: 88,
          matched_skills: ['TypeScript', 'Cloudflare Workers', 'Distributed Systems'],
          missing_skills: [],
          red_flags: [],
          reasons: 'Strong match for senior distributed systems.',
        }),
      }),
    };

    const res = await app.request(
      '/api/pipeline/run',
      { method: 'POST' },
      { ...workerEnv, AI: mockAi, LLM_PROVIDER: 'workers-ai' },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      stats: {
        processed: number;
        filtered_out: number;
        scored: number;
        routed: number;
      };
    };

    expect(body.ok).toBe(true);
    expect(body.stats.processed).toBe(3);
    expect(body.stats.filtered_out).toBe(1); // Job 1 rejected by title_exclude
    expect(body.stats.scored).toBe(2); // Job 2 and 3 scored
    expect(body.stats.routed).toBe(2); // Both routed

    // Check Job 1 in D1
    const j1 = await workerEnv.DB.prepare('SELECT * FROM jobs WHERE id = ?')
      .bind('job-worker-1')
      .first<{ status: string; filter_reason: string }>();
    expect(j1?.status).toBe('filtered_out');
    expect(j1?.filter_reason).toBe('TITLE_EXCLUDED');

    // Check Job 2 in D1 (routed to auto_email, OK)
    const j2 = await workerEnv.DB.prepare('SELECT * FROM jobs WHERE id = ?')
      .bind('job-worker-2')
      .first<{
        status: string;
        apply_route: string;
        route_reason: string;
        match_score: number;
      }>();
    expect(j2?.status).toBe('routed');
    expect(j2?.apply_route).toBe('auto_email');
    expect(j2?.route_reason).toBe('OK');
    expect(j2?.match_score).toBe(88);

    // Check Job 3 in D1 (routed to manual_portal, PORTAL_NO_EMAIL)
    const j3 = await workerEnv.DB.prepare('SELECT * FROM jobs WHERE id = ?')
      .bind('job-worker-3')
      .first<{
        status: string;
        apply_route: string;
        route_reason: string;
      }>();
    expect(j3?.status).toBe('routed');
    expect(j3?.apply_route).toBe('manual_portal');
    expect(j3?.route_reason).toBe('PORTAL_NO_EMAIL');

    // Check that state transitions wrote status_change events
    const { results: events } = await workerEnv.DB.prepare(
      `SELECT entity_id, type, payload FROM events WHERE type = 'status_change'`,
    ).all<{ entity_id: string; type: string; payload: string }>();

    expect(events.length).toBeGreaterThanOrEqual(3);
  });

  it('queue consumer processes score_and_route message action', async () => {
    const mockAi = {
      run: async () => ({
        response: JSON.stringify({
          score: 80,
          matched_skills: ['TypeScript'],
          missing_skills: [],
          red_flags: [],
          reasons: 'Good match.',
        }),
      }),
    };

    let ackCalled = false;
    const batch = {
      messages: [
        {
          id: 'msg-score-route-1',
          body: { action: 'score_and_route' },
          ack: () => {
            ackCalled = true;
          },
          retry: () => {},
        },
      ],
      queue: 'pigeon-jobs',
    };

    await worker.queue(
      batch as unknown as MessageBatch<unknown>,
      { ...workerEnv, AI: mockAi, LLM_PROVIDER: 'workers-ai' } as unknown as Bindings,
    );

    expect(ackCalled).toBe(true);
  });
});
