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
    locations: ['Remote', 'San Francisco, CA'],
    remote: true,
    roles: ['Backend Engineer', 'Systems Engineer'],
  },
  filters: {
    title_include: ['systems', 'typescript'],
    title_exclude: ['junior'],
    company_blacklist: ['Spammy Recruitment LLC'],
    locations: ['Remote'],
    remote: true,
    min_salary: 140000,
    min_score: 70,
    require_salary: false,
    experience_range: {
      min: 7,
      max: 12,
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
      portfolio: 'https://alexmercer.dev',
      github: 'https://github.com/alexmercer',
    },
    other: {},
  },
};

const validLetterBody = `Dear Hiring Team at CloudScale Systems,

I am excited to submit my application for the Staff TypeScript Engineer position. With 7 years of experience building distributed backend services and high-performance serverless systems, I am eager to bring my background in TypeScript, Cloudflare Workers, and SQLite database design to your infrastructure team.

In my previous roles, I focused on reducing edge API latencies and developing scalable persistence layers that handle millions of requests reliably. My work has centered on developing robust, test-driven systems while collaborating cross-functionally with product teams to deliver critical platform features. You can review some of my open-source projects and architecture notes at https://alexmercer.dev.

I have followed CloudScale Systems's mission and engineering standards closely, and I would welcome the opportunity to discuss how my hands-on experience building fault-tolerant services can contribute to your team's ongoing roadmap. Thank you very much for your time and consideration.

Warm regards,
Alex Mercer`;

const validSubject = 'Application for Staff TypeScript Engineer - Alex Mercer';

describe('Worker Application Factory Integration', () => {
  beforeAll(async () => {
    await applyD1Migrations(workerEnv.DB, workerEnv.TEST_MIGRATIONS);
  });

  it('POST /api/applications/create generates cover letter, attaches resume, and creates draft application', async () => {
    const nowIso = new Date().toISOString();

    // 1. Insert Profile
    await workerEnv.DB.prepare(
      `INSERT OR REPLACE INTO profile (id, data, updated_at) VALUES (?, ?, ?)`,
    )
      .bind('default', JSON.stringify(mockProfile), nowIso)
      .run();

    // 2. Insert Resume
    await workerEnv.DB.prepare(
      `INSERT OR REPLACE INTO resumes (id, label, r2_key, tags, is_default, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        'res-worker-1',
        'TypeScript Resume',
        'resumes/res-1.pdf',
        JSON.stringify(['typescript', 'edge']),
        1,
        nowIso,
      )
      .run();

    // 3. Insert Job (auto_email route)
    await workerEnv.DB.prepare(
      `INSERT OR REPLACE INTO jobs (
        id, dedupe_key, source, source_kind, source_job_id,
        title, company, company_normalized, location, remote,
        salary_min, salary_max, currency, salary_raw,
        description, apply_url, contact_email, contact_source,
        posted_at, fetched_at, status, apply_route, route_reason, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        'job-app-worker-1',
        'dedupe-app-1',
        'ashby',
        'ats',
        'src-app-1',
        'Staff TypeScript Engineer',
        'CloudScale Systems',
        'cloudscale systems',
        'Remote',
        1,
        170000,
        190000,
        'USD',
        '$170k - $190k',
        'Build edge systems with TypeScript.',
        'https://ashby.com/cloudscale/1',
        'recruiting@cloudscale.com',
        'posting',
        nowIso,
        nowIso,
        'routed',
        'auto_email',
        'OK',
        nowIso,
      )
      .run();

    const mockAi = {
      run: async () => ({
        response: JSON.stringify({
          subject: validSubject,
          body: validLetterBody,
        }),
      }),
    };

    const res = await app.request(
      '/api/applications/create',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
        body: JSON.stringify({ job_id: 'job-app-worker-1' }),
      },
      { ...workerEnv, AI: mockAi, LLM_PROVIDER: 'workers-ai' },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      created: boolean;
      validation_passed: boolean;
      application: {
        id: string;
        channel: string;
        status: string;
        resume_id: string;
        cover_letter: string;
      };
    };

    expect(body.ok).toBe(true);
    expect(body.created).toBe(true);
    expect(body.validation_passed).toBe(true);
    expect(body.application.channel).toBe('email');
    expect(body.application.status).toBe('draft');
    expect(body.application.resume_id).toBe('res-worker-1');

    // Test Idempotency: calling again returns created: false with the same application
    const resIdempotent = await app.request(
      '/api/applications/create',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
        body: JSON.stringify({ job_id: 'job-app-worker-1' }),
      },
      { ...workerEnv, AI: mockAi, LLM_PROVIDER: 'workers-ai' },
    );

    expect(resIdempotent.status).toBe(200);
    const idempotentBody = (await resIdempotent.json()) as {
      ok: boolean;
      created: boolean;
      application: { id: string };
    };
    expect(idempotentBody.created).toBe(false);
    expect(idempotentBody.application.id).toBe(body.application.id);

    // Test Editing the letter via PUT /api/applications/:id/letter
    const editRes = await app.request(
      `/api/applications/${body.application.id}/letter`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
        body: JSON.stringify({
          cover_letter: validLetterBody,
          subject: 'Updated Subject - Alex Mercer',
        }),
      },
      workerEnv,
    );

    expect(editRes.status).toBe(200);
    const editBody = (await editRes.json()) as {
      ok: boolean;
      validation_passed: boolean;
      errors: string[];
    };
    expect(editBody.ok).toBe(true);
    expect(editBody.validation_passed).toBe(true);
    expect(editBody.errors).toEqual([]);
  });

  it('queue consumer processes create_application message action', async () => {
    const mockAi = {
      run: async () => ({
        response: JSON.stringify({
          subject: validSubject,
          body: validLetterBody,
        }),
      }),
    };

    let ackCalled = false;
    const batch = {
      messages: [
        {
          id: 'msg-create-app-1',
          body: { action: 'create_application', jobId: 'job-app-worker-1' },
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
