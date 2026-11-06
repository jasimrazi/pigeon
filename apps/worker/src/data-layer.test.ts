import { describe, it, expect, beforeAll } from 'vitest';
import { applyD1Migrations, env } from 'cloudflare:test';
import { transition, IllegalTransitionError, type Profile } from '@pigeon/shared';
import { app } from './index.js';
import type { Bindings } from './env.js';

interface TestEnv extends Bindings {
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
}

const workerEnv = env as unknown as TestEnv;

const validProfileFixture: Profile = {
  name: 'Alex Mercer',
  email: 'alex.mercer@example.com',
  skills: ['TypeScript', 'Cloudflare Workers', 'Node.js', 'React', 'SQL'],
  experience: [
    {
      title: 'Senior Systems Engineer',
      company: 'CloudTech Solutions',
      location: 'Remote',
      start_date: '2021-03',
      end_date: '2024-08',
      current: false,
      description: 'Architected serverless edge backends and microservices.',
      highlights: ['Reduced edge latency by 45%', 'Designed D1-backed real-time caching layer'],
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
    locations: ['Remote', 'San Francisco, CA'],
    remote: true,
    roles: ['Backend Engineer', 'Systems Engineer'],
  },
  filters: {
    titles: ['Senior Software Engineer', 'Backend Engineer'],
    locations: ['Remote'],
    min_salary: 140000,
    experience_range: {
      min: 4,
      max: 10,
    },
    company_blacklist: ['SpamCorp'],
    min_score: 75,
    require_salary: false,
  },
  send_settings: {
    daily_cap: 10,
    window: {
      start: '09:00',
      end: '17:00',
    },
    timezone: 'America/New_York',
    ramp_base: 2,
    ramp_step: 1,
    auto_approve_above_score: 85,
  },
  answers: {
    notice_period: '2 weeks',
    current_ctc: '$160,000',
    expected_ctc: '$180,000',
    work_authorisation: 'US Citizen',
    links: {
      linkedin: 'https://linkedin.com/in/alex-mercer',
      github: 'https://github.com/alex-mercer',
    },
    other: {
      relocation: 'no',
    },
  },
};

describe('Pigeon Data Layer & Schema Tests', () => {
  beforeAll(async () => {
    // Migrations apply from an empty database
    const testMigrations = workerEnv.TEST_MIGRATIONS;
    expect(testMigrations).toBeDefined();
    expect(testMigrations.length).toBeGreaterThan(0);
    await applyD1Migrations(workerEnv.DB, testMigrations);
  });

  describe('Database Constraints', () => {
    it('rejects duplicate dedupe_key on jobs', async () => {
      const now = new Date().toISOString();
      const jobId1 = 'job_1';
      const jobId2 = 'job_2';
      const dedupeKey = 'unique-dedupe-key-1';

      // First insert should succeed
      await workerEnv.DB.prepare(
        `INSERT INTO jobs (
          id, dedupe_key, source, source_kind, title, company, company_normalized,
          description, fetched_at, status, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          jobId1,
          dedupeKey,
          'greenhouse',
          'ats',
          'Senior Engineer',
          'Acme Corp',
          'acme corp',
          'Job description',
          now,
          'new',
          now,
        )
        .run();

      // Second insert with same dedupe_key must be rejected
      await expect(
        workerEnv.DB.prepare(
          `INSERT INTO jobs (
            id, dedupe_key, source, source_kind, title, company, company_normalized,
            description, fetched_at, status, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(
            jobId2,
            dedupeKey,
            'lever',
            'ats',
            'Another Title',
            'Acme Corp',
            'acme corp',
            'Description 2',
            now,
            'new',
            now,
          )
          .run(),
      ).rejects.toThrow();
    });

    it('rejects a second initial application for the same job, but allows multiple follow-ups', async () => {
      const now = new Date().toISOString();
      const jobId = 'job_for_apps';

      // Insert job first
      await workerEnv.DB.prepare(
        `INSERT INTO jobs (
          id, dedupe_key, source, source_kind, title, company, company_normalized,
          description, fetched_at, status, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          jobId,
          'dedupe_job_for_apps',
          'greenhouse',
          'ats',
          'DevOps Engineer',
          'CloudCorp',
          'cloudcorp',
          'Desc',
          now,
          'new',
          now,
        )
        .run();

      // First initial application succeeds
      await workerEnv.DB.prepare(
        `INSERT INTO applications (
          id, job_id, kind, channel, status, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
        .bind('app_init_1', jobId, 'initial', 'email', 'draft', now)
        .run();

      // Second initial application for same job must fail UNIQUE constraint
      await expect(
        workerEnv.DB.prepare(
          `INSERT INTO applications (
            id, job_id, kind, channel, status, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
          .bind('app_init_2', jobId, 'initial', 'email', 'draft', now)
          .run(),
      ).rejects.toThrow();

      // Multiple follow_up applications for the same job are permitted
      await expect(
        workerEnv.DB.prepare(
          `INSERT INTO applications (
            id, job_id, kind, channel, status, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
          .bind('app_followup_1', jobId, 'follow_up', 'email', 'draft', now)
          .run(),
      ).resolves.toBeDefined();

      await expect(
        workerEnv.DB.prepare(
          `INSERT INTO applications (
            id, job_id, kind, channel, status, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
          .bind('app_followup_2', jobId, 'follow_up', 'email', 'draft', now)
          .run(),
      ).resolves.toBeDefined();
    });
  });

  describe('State Machine & Events Integration', () => {
    it('executes allowed transition, updates status and writes exactly one events row', async () => {
      const now = new Date().toISOString();
      const jobId = 'job_sm_test';
      const appId = 'app_sm_test';

      await workerEnv.DB.prepare(
        `INSERT INTO jobs (
          id, dedupe_key, source, source_kind, title, company, company_normalized,
          description, fetched_at, status, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          jobId,
          'dedupe_sm_test',
          'workday',
          'ats',
          'Full Stack Dev',
          'MetaCorp',
          'metacorp',
          'Desc',
          now,
          'new',
          now,
        )
        .run();

      await workerEnv.DB.prepare(
        `INSERT INTO applications (
          id, job_id, kind, channel, status, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
        .bind(appId, jobId, 'initial', 'email', 'draft', now)
        .run();

      // Get count of events before transition
      const countBefore = await workerEnv.DB.prepare(
        `SELECT COUNT(*) as count FROM events WHERE entity_id = ?`,
      )
        .bind(appId)
        .first<{ count: number }>();

      expect(countBefore?.count).toBe(0);

      // Perform allowed transition: draft -> approved
      const result = await transition(
        workerEnv.DB,
        'application',
        appId,
        'approved',
        'Auto-approved based on score',
      );

      expect(result.id).toBe(appId);
      expect(result.from).toBe('draft');
      expect(result.to).toBe('approved');
      expect(result.reason).toBe('Auto-approved based on score');

      // Verify DB application status updated
      const updatedApp = await workerEnv.DB.prepare(
        `SELECT status, updated_at FROM applications WHERE id = ?`,
      )
        .bind(appId)
        .first<{ status: string; updated_at: string }>();

      expect(updatedApp?.status).toBe('approved');

      // Verify exactly ONE events row was written
      const countAfter = await workerEnv.DB.prepare(
        `SELECT COUNT(*) as count FROM events WHERE entity_id = ?`,
      )
        .bind(appId)
        .first<{ count: number }>();

      expect(countAfter?.count).toBe(1);

      // Check event payload details
      const eventRow = await workerEnv.DB.prepare(
        `SELECT entity, entity_id, type, payload FROM events WHERE entity_id = ?`,
      )
        .bind(appId)
        .first<{
          entity: string;
          entity_id: string;
          type: string;
          payload: string;
        }>();

      expect(eventRow?.entity).toBe('application');
      expect(eventRow?.type).toBe('status_change');
      const payload = JSON.parse(eventRow?.payload || '{}');
      expect(payload.from).toBe('draft');
      expect(payload.to).toBe('approved');
      expect(payload.reason).toBe('Auto-approved based on score');
    });

    it('rejects illegal transition with IllegalTransitionError and does not write events', async () => {
      const appId = 'app_sm_test';

      // Currently 'approved'. Trying to go to 'sent' directly is illegal (must go through 'sending')
      await expect(
        transition(workerEnv.DB, 'application', appId, 'sent', 'premature sent'),
      ).rejects.toThrowError(IllegalTransitionError);

      // Verify events count did not increase
      const count = await workerEnv.DB.prepare(
        `SELECT COUNT(*) as count FROM events WHERE entity_id = ?`,
      )
        .bind(appId)
        .first<{ count: number }>();

      expect(count?.count).toBe(1); // Still 1 from previous test
    });
  });

  describe('Resume Upload API (POST /api/resumes)', () => {
    it('rejects non-PDF files', async () => {
      const formData = new FormData();
      const textBlob = new Blob(['Plain text resume content'], {
        type: 'text/plain',
      });
      formData.append('file', textBlob, 'resume.txt');
      formData.append('tags', JSON.stringify(['backend']));

      const res = await app.request(
        '/api/resumes',
        {
          method: 'POST',
          headers: { Origin: 'http://localhost:5173' },
          body: formData,
        },
        workerEnv,
      );

      expect(res.status).toBe(400);
      const json = await res.json<{ error: string }>();
      expect(json.error).toMatch(/only PDF/i);
    });

    it('rejects a renamed .exe file (magic bytes MZ)', async () => {
      const formData = new FormData();
      // 'MZ' magic bytes: 0x4D, 0x5A
      const exeBytes = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);
      const exeBlob = new Blob([exeBytes], { type: 'application/pdf' });
      formData.append('file', exeBlob, 'malicious.pdf');

      const res = await app.request(
        '/api/resumes',
        {
          method: 'POST',
          headers: { Origin: 'http://localhost:5173' },
          body: formData,
        },
        workerEnv,
      );

      expect(res.status).toBe(400);
      const json = await res.json<{ error: string }>();
      expect(json.error).toMatch(/only PDF/i);
    });

    it('rejects files over 5 MB', async () => {
      const formData = new FormData();
      // 5 MB + 1 byte
      const largeBytes = new Uint8Array(5 * 1024 * 1024 + 1);
      // Valid PDF magic header, but oversized
      largeBytes[0] = 0x25; // %
      largeBytes[1] = 0x50; // P
      largeBytes[2] = 0x44; // D
      largeBytes[3] = 0x46; // F
      const largeBlob = new Blob([largeBytes], { type: 'application/pdf' });
      formData.append('file', largeBlob, 'large.pdf');

      const res = await app.request(
        '/api/resumes',
        {
          method: 'POST',
          headers: { Origin: 'http://localhost:5173' },
          body: formData,
        },
        workerEnv,
      );

      expect(res.status).toBe(400);
      const json = await res.json<{ error: string }>();
      expect(json.error).toMatch(/5 MB limit/i);
    });

    it('accepts a valid PDF and stores it in R2 and D1', async () => {
      const formData = new FormData();
      // Valid PDF bytes: %PDF-1.4 ...
      const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25]);
      const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
      formData.append('file', pdfBlob, 'alex_mercer_resume.pdf');
      formData.append('tags', JSON.stringify(['backend', 'systems']));
      formData.append('label', 'Alex Mercer - Systems Resume');
      formData.append('is_default', 'true');

      const res = await app.request(
        '/api/resumes',
        {
          method: 'POST',
          headers: { Origin: 'http://localhost:5173' },
          body: formData,
        },
        workerEnv,
      );

      expect(res.status).toBe(201);
      const json = await res.json<{
        resume: {
          id: string;
          label: string;
          r2_key: string;
          tags: string[];
          is_default: boolean;
          created_at: string;
        };
      }>();

      expect(json.resume.id).toBeDefined();
      expect(json.resume.label).toBe('Alex Mercer - Systems Resume');
      expect(json.resume.tags).toEqual(['backend', 'systems']);
      expect(json.resume.is_default).toBe(true);

      // Verify file is stored in R2
      const r2Object = await workerEnv.RESUMES.get(json.resume.r2_key);
      expect(r2Object).not.toBeNull();
      const r2Content = await r2Object?.arrayBuffer();
      expect(r2Content?.byteLength).toBe(pdfBytes.byteLength);

      // Verify stored in D1 resumes table
      const dbResume = await workerEnv.DB.prepare(
        `SELECT id, label, tags, is_default FROM resumes WHERE id = ?`,
      )
        .bind(json.resume.id)
        .first<{ id: string; label: string; tags: string; is_default: number }>();

      expect(dbResume?.id).toBe(json.resume.id);
      expect(dbResume?.label).toBe('Alex Mercer - Systems Resume');
      expect(JSON.parse(dbResume?.tags || '[]')).toEqual(['backend', 'systems']);
      expect(dbResume?.is_default).toBe(1);

      // Verify event was logged
      const resumeEvent = await workerEnv.DB.prepare(
        `SELECT entity, type FROM events WHERE entity_id = ?`,
      )
        .bind(json.resume.id)
        .first<{ entity: string; type: string }>();

      expect(resumeEvent?.entity).toBe('resume');
      expect(resumeEvent?.type).toBe('resume_uploaded');
    });
  });

  describe('Profile API (GET and PUT /api/profile)', () => {
    it('returns 404 when profile is not set', async () => {
      const res = await app.request('/api/profile', { method: 'GET' }, workerEnv);
      expect(res.status).toBe(404);
    });

    it('rejects malformed profile input', async () => {
      const malformedBody = {
        name: 'Alex',
        email: 'invalid-email',
      };

      const res = await app.request(
        '/api/profile',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
          body: JSON.stringify(malformedBody),
        },
        workerEnv,
      );

      expect(res.status).toBe(400);
      const json = await res.json<{ error: string }>();
      expect(json.error).toMatch(/Validation failed/i);
    });

    it('accepts full example fixture, saves to D1, and serves it via GET', async () => {
      const putRes = await app.request(
        '/api/profile',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
          body: JSON.stringify(validProfileFixture),
        },
        workerEnv,
      );

      expect(putRes.status).toBe(200);
      const putJson = await putRes.json<{ profile: Profile }>();
      expect(putJson.profile.name).toBe('Alex Mercer');
      expect(putJson.profile.send_settings.daily_cap).toBe(10);

      // Verify via GET
      const getRes = await app.request('/api/profile', { method: 'GET' }, workerEnv);
      expect(getRes.status).toBe(200);
      const getJson = await getRes.json<{ profile: Profile; updated_at: string }>();
      expect(getJson.profile.name).toBe('Alex Mercer');
      expect(getJson.profile.email).toBe('alex.mercer@example.com');
      expect(getJson.profile.skills).toHaveLength(5);
      expect(getJson.profile.filters.min_salary).toBe(140000);
      expect(getJson.updated_at).toBeDefined();

      // Verify event was logged
      const profileEvent = await workerEnv.DB.prepare(
        `SELECT entity, type FROM events WHERE entity = 'profile'`,
      ).first<{ entity: string; type: string }>();

      expect(profileEvent?.entity).toBe('profile');
      expect(profileEvent?.type).toBe('profile_updated');
    });
  });

  describe('Events API (GET /api/events)', () => {
    it('filters events by entity and type', async () => {
      const resAll = await app.request('/api/events', { method: 'GET' }, workerEnv);
      expect(resAll.status).toBe(200);
      const jsonAll = await resAll.json<{ events: unknown[] }>();
      expect(jsonAll.events.length).toBeGreaterThan(0);

      // Filter by entity = 'resume'
      const resResume = await app.request('/api/events?entity=resume', { method: 'GET' }, env);
      expect(resResume.status).toBe(200);
      const jsonResume = await resResume.json<{
        events: Array<{ entity: string; type: string }>;
      }>();
      expect(jsonResume.events.length).toBeGreaterThan(0);
      expect(jsonResume.events.every((e) => e.entity === 'resume')).toBe(true);

      // Filter by type = 'status_change'
      const resStatus = await app.request('/api/events?type=status_change', { method: 'GET' }, env);
      expect(resStatus.status).toBe(200);
      const jsonStatus = await resStatus.json<{
        events: Array<{ entity: string; type: string }>;
      }>();
      expect(jsonStatus.events.length).toBeGreaterThan(0);
      expect(jsonStatus.events.every((e) => e.type === 'status_change')).toBe(true);
    });
  });
});
