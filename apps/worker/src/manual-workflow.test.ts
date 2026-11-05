import { describe, it, expect, beforeAll } from 'vitest';
import { applyD1Migrations, env } from 'cloudflare:test';
import { app } from './index.js';
import type { Bindings } from './env.js';

interface TestEnv extends Bindings {
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
}

const workerEnv = env as unknown as TestEnv;

const mockProfile = {
  name: 'Alex Mercer',
  email: 'alex.mercer@example.com',
  skills: ['TypeScript', 'Cloudflare Workers', 'Distributed Systems'],
  experience: [],
  education: [],
  preferences: {
    locations: ['Remote'],
    remote: true,
    manual_daily_target: 2,
  },
  filters: {
    title_include: ['systems', 'typescript'],
    title_exclude: [],
    company_blacklist: [],
    locations: ['Remote'],
    remote: true,
    min_salary: 100000,
    min_score: 70,
    require_salary: false,
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

describe('Worker Manual Apply Workflow API', () => {
  beforeAll(async () => {
    await applyD1Migrations(workerEnv.DB, workerEnv.TEST_MIGRATIONS);

    const nowIso = new Date().toISOString();
    // 1. Insert Profile
    await workerEnv.DB.prepare(
      `INSERT OR REPLACE INTO profile (id, data, updated_at) VALUES (?, ?, ?)`,
    )
      .bind('default', JSON.stringify(mockProfile), nowIso)
      .run();

    // 2. Insert Resume into D1 and R2
    await workerEnv.DB.prepare(
      `INSERT OR REPLACE INTO resumes (id, label, r2_key, tags, is_default, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind('res-pdf-1', 'Standard PDF Resume', 'resumes/standard.pdf', '["ts"]', 1, nowIso)
      .run();

    await workerEnv.RESUMES.put('resumes/standard.pdf', new Uint8Array([0x25, 0x50, 0x44, 0x46])); // %PDF

    // 3. Insert Jobs
    await workerEnv.DB.prepare(
      `INSERT OR REPLACE INTO jobs (
        id, dedupe_key, source, source_kind, source_job_id,
        title, company, company_normalized, location, remote,
        salary_min, salary_max, currency, salary_raw,
        description, apply_url, contact_email, contact_source,
        match_score, match_reasons, red_flags,
        posted_at, fetched_at, status, apply_route, route_reason, updated_at
      ) VALUES
      (
        'job-manual-1', 'dedupe-m-1', 'ashby', 'ats', 'src-m-1',
        'Staff Systems Engineer', 'Stripe', 'stripe', 'Remote', 1,
        150000, 200000, 'USD', '$150k - $200k',
        'Looking for Staff Systems Engineer.', 'https://stripe.com/jobs/1', NULL, 'none',
        95, '{"matched_skills":["TypeScript"]}', '[]',
        ?, ?, 'manual_review', 'manual_portal', 'NO_EMAIL_FORM', ?
      ),
      (
        'job-manual-2', 'dedupe-m-2', 'greenhouse', 'ats', 'src-m-2',
        'Lead Infrastructure Engineer', 'Vercel', 'vercel', 'Remote', 1,
        160000, 210000, 'USD', '$160k - $210k',
        'Looking for Lead Infrastructure Engineer.', 'https://vercel.com/careers/2', 'careers@vercel.com', 'guessed',
        90, '{"matched_skills":["TypeScript"]}', '[]',
        ?, ?, 'manual_review', 'manual_review', 'GUESSED_EMAIL', ?
      )`,
    )
      .bind(nowIso, nowIso, nowIso, nowIso, nowIso, nowIso)
      .run();

    // 4. Insert Applications
    await workerEnv.DB.prepare(
      `INSERT OR REPLACE INTO applications (
        id, job_id, kind, channel, resume_id, cover_letter, subject,
        status, updated_at
      ) VALUES
      (
        'app-m-1', 'job-manual-1', 'initial', 'manual', 'res-pdf-1',
        'Dear Stripe, I am applying for Staff Systems Engineer...',
        'Application for Staff Systems Engineer',
        'manual_pending', ?
      ),
      (
        'app-m-2', 'job-manual-2', 'initial', 'manual', 'res-pdf-1',
        'Dear Vercel, I am applying for Lead Infrastructure Engineer...',
        'Application for Lead Infrastructure Engineer',
        'needs_review', ?
      )`,
    )
      .bind(nowIso, nowIso)
      .run();
  });

  it('GET /api/manual returns queue items, todays focus, and attention groups', async () => {
    const res = await app.fetch(new Request('http://localhost/api/manual'), workerEnv);
    expect(res.status).toBe(200);

    const data = (await res.json()) as {
      ok: boolean;
      items: Array<{ application_id: string; title: string }>;
      todays_focus: Array<{ application_id: string }>;
      needs_attention: Array<{ application_id: string }>;
      counts: { total: number; manual_pending: number; needs_review: number };
    };

    expect(data.ok).toBe(true);
    expect(data.counts.total).toBe(2);
    expect(data.todays_focus.length).toBeLessThanOrEqual(2);
    expect(data.needs_attention.some((item) => item.application_id === 'app-m-2')).toBe(true);
  });

  it('GET /api/manual/:id/kit returns kit with sanitized apply link and answers', async () => {
    const res = await app.fetch(new Request('http://localhost/api/manual/app-m-1/kit'), workerEnv);
    expect(res.status).toBe(200);

    const data = (await res.json()) as {
      ok: boolean;
      kit: {
        title: string;
        company: string;
        apply_url: string;
        apply_domain: string;
        answers: Record<string, unknown>;
        resume: { download_url: string };
      };
    };

    expect(data.ok).toBe(true);
    expect(data.kit.title).toBe('Staff Systems Engineer');
    expect(data.kit.company).toBe('Stripe');
    expect(data.kit.apply_url).toBe('https://stripe.com/jobs/1');
    expect(data.kit.apply_domain).toBe('stripe.com');
    expect(data.kit.resume.download_url).toBe('/api/resumes/res-pdf-1/download');
    expect(data.kit.answers['notice_period']).toBe('2 weeks');
  });

  it('GET /api/manual/:id/kit returns 404 for non-existent application', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/manual/non-existent/kit'),
      workerEnv,
    );
    expect(res.status).toBe(404);
  });

  it('GET /api/resumes/:id/download streams PDF and sets headers', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/resumes/res-pdf-1/download'),
      workerEnv,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition')).toContain('Standard_PDF_Resume.pdf');

    const bodyBytes = new Uint8Array(await res.arrayBuffer());
    expect(bodyBytes[0]).toBe(0x25); // %
    expect(bodyBytes[1]).toBe(0x50); // P
  });

  it('GET /api/resumes/:id/download returns 404 for unknown resume', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/resumes/unknown-res/download'),
      workerEnv,
    );
    expect(res.status).toBe(404);
  });

  it('POST /api/manual/:id/snooze snoozes application and hides from active queue', async () => {
    const snoozeRes = await app.fetch(
      new Request('http://localhost/api/manual/app-m-1/snooze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: 3 }),
      }),
      workerEnv,
    );
    expect(snoozeRes.status).toBe(200);

    const queueRes = await app.fetch(new Request('http://localhost/api/manual'), workerEnv);
    const queueData = (await queueRes.json()) as {
      items: Array<{ application_id: string }>;
      counts: { snoozed: number };
    };

    expect(queueData.items.some((item) => item.application_id === 'app-m-1')).toBe(false);
    expect(queueData.counts.snoozed).toBe(1);
  });

  it('POST /api/manual/:id/send-by-email requires confirm_risk for guessed email and approves when supplied', async () => {
    // 1. Without confirm_risk: fails
    const failRes = await app.fetch(
      new Request('http://localhost/api/manual/app-m-2/send-by-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm_risk: false }),
      }),
      workerEnv,
    );
    expect(failRes.status).toBe(500); // Handled by global error handler returning JSON { error }
    const failJson = (await failRes.json()) as { error: string };
    expect(failJson.error).toContain('confirm_risk');

    // 2. With confirm_risk: succeeds
    const okRes = await app.fetch(
      new Request('http://localhost/api/manual/app-m-2/send-by-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm_risk: true }),
      }),
      workerEnv,
    );
    expect(okRes.status).toBe(200);
    const okJson = (await okRes.json()) as { ok: boolean; success: boolean };
    expect(okJson.ok).toBe(true);
    expect(okJson.success).toBe(true);

    // Verify row status is now 'approved' and channel is 'email'
    const updated = await workerEnv.DB.prepare(
      'SELECT status, channel FROM applications WHERE id = ?',
    )
      .bind('app-m-2')
      .first<{ status: string; channel: string }>();
    expect(updated?.status).toBe('approved');
    expect(updated?.channel).toBe('email');
  });

  it('POST /api/manual/:id/applied marks application applied and updates companies_contacted', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/manual/app-m-1/applied', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: 'Applied via Stripe Greenhouse form' }),
      }),
      workerEnv,
    );
    expect(res.status).toBe(200);

    const contactRow = await workerEnv.DB.prepare(
      'SELECT company_normalized, last_channel FROM companies_contacted WHERE company_normalized = ?',
    )
      .bind('stripe')
      .first<{ company_normalized: string; last_channel: string }>();

    expect(contactRow?.company_normalized).toBe('stripe');
    expect(contactRow?.last_channel).toBe('manual');
  });

  it('POST /api/applications/:id/outcome records application outcome', async () => {
    // 1. Invalid status rejected with 400
    const badRes = await app.fetch(
      new Request('http://localhost/api/applications/app-m-1/outcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'invalid_status' }),
      }),
      workerEnv,
    );
    expect(badRes.status).toBe(400);

    // 2. Valid outcome recorded
    const goodRes = await app.fetch(
      new Request('http://localhost/api/applications/app-m-1/outcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'interview' }),
      }),
      workerEnv,
    );
    expect(goodRes.status).toBe(200);

    const appRow = await workerEnv.DB.prepare('SELECT status FROM applications WHERE id = ?')
      .bind('app-m-1')
      .first<{ status: string }>();
    expect(appRow?.status).toBe('interview');
  });

  it('POST /api/manual/bulk validates input and applies bulk action', async () => {
    // 1. Invalid payload: missing ids
    const badRes = await app.fetch(
      new Request('http://localhost/api/manual/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'applied' }),
      }),
      workerEnv,
    );
    expect(badRes.status).toBe(400);

    // 2. Insert new manual_pending application for bulk testing
    const nowIso = new Date().toISOString();
    await workerEnv.DB.prepare(
      `INSERT OR REPLACE INTO applications (id, job_id, kind, channel, status, updated_at)
       VALUES ('app-bulk-1', 'job-manual-1', 'initial', 'manual', 'manual_pending', ?)`,
    )
      .bind(nowIso)
      .run();

    const goodRes = await app.fetch(
      new Request('http://localhost/api/manual/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ['app-bulk-1'], action: 'skip', reason: 'Not interested' }),
      }),
      workerEnv,
    );
    expect(goodRes.status).toBe(200);
    const goodData = (await goodRes.json()) as { ok: boolean; processed: string[]; action: string };
    expect(goodData.ok).toBe(true);
    expect(goodData.processed).toEqual(['app-bulk-1']);

    const updated = await workerEnv.DB.prepare(
      'SELECT status, notes FROM applications WHERE id = ?',
    )
      .bind('app-bulk-1')
      .first<{ status: string; notes: string }>();
    expect(updated?.status).toBe('manual_skipped');
    expect(updated?.notes).toBe('Not interested');
  });
});
