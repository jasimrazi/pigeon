import { describe, it, expect, beforeAll } from 'vitest';
import { applyD1Migrations, env } from 'cloudflare:test';
import {
  ingestSource,
  ALL_SOURCES,
  greenhouseAdapter,
  type JobSource,
  type NormalizedJob,
} from '@pigeon/shared';
import worker from './index.js';
import type { Bindings } from './env.js';

interface TestEnv extends Bindings {
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
}

const workerEnv = env as unknown as TestEnv;

describe('Ingestion Pipeline & Queue Consumer Tests', () => {
  beforeAll(async () => {
    await applyD1Migrations(workerEnv.DB, workerEnv.TEST_MIGRATIONS);
  });

  it('The same job arriving from two sources produces only one row in D1', async () => {
    // Source A (e.g. RemoteOK mock)
    const mockRemoteOk: JobSource = {
      name: 'remoteok',
      kind: 'api',
      async fetch() {
        return [
          {
            id: 'job-cross-1',
            source: 'remoteok',
            position: 'Senior TypeScript Architect',
            company: 'Nexus Core Inc',
            location: 'Worldwide',
            description: 'Building edge systems. Contact: jobs@nexuscore.io',
          },
        ];
      },
      normalize(raw): NormalizedJob {
        return {
          source: 'remoteok',
          source_kind: 'api',
          source_job_id: 'job-cross-1',
          title: String(raw['position']),
          company: String(raw['company']),
          company_normalized: 'nexus core',
          location: 'Worldwide',
          remote: true,
          salary_min: 150000,
          salary_max: 180000,
          currency: 'USD',
          salary_raw: '$150k - $180k',
          description: String(raw['description']),
          apply_url: 'https://remoteok.com/job-cross-1',
          contact_email: 'jobs@nexuscore.io',
          contact_source: 'posting',
          posted_at: new Date().toISOString(),
          untrusted: true,
        };
      },
    };

    // Source B (e.g. Remotive mock) returning the exact same job
    const mockRemotive: JobSource = {
      name: 'remotive',
      kind: 'api',
      async fetch() {
        return [
          {
            id: 'job-cross-2',
            source: 'remotive',
            title: 'Senior TypeScript Architect (Remote)',
            company_name: 'Nexus Core, Inc.',
            candidate_required_location: 'Remote',
            description: 'Building edge systems. Contact: jobs@nexuscore.io',
          },
        ];
      },
      normalize(raw): NormalizedJob {
        return {
          source: 'remotive',
          source_kind: 'api',
          source_job_id: 'job-cross-2',
          title: String(raw['title']),
          company: String(raw['company_name']),
          company_normalized: 'nexus core',
          location: 'Remote',
          remote: true,
          salary_min: 150000,
          salary_max: 180000,
          currency: 'USD',
          salary_raw: '$150k - $180k',
          description: String(raw['description']),
          apply_url: 'https://remotive.com/job-cross-2',
          contact_email: 'jobs@nexuscore.io',
          contact_source: 'posting',
          posted_at: new Date().toISOString(),
          untrusted: true,
        };
      },
    };

    const origRemoteOk = ALL_SOURCES['remoteok'];
    const origRemotive = ALL_SOURCES['remotive'];

    try {
      ALL_SOURCES['remoteok'] = mockRemoteOk;
      ALL_SOURCES['remotive'] = mockRemotive;

      // 1. Ingest from RemoteOK
      const resA = await ingestSource('remoteok', {
        db: workerEnv.DB,
        kv: workerEnv.CONFIG,
      });

      expect(resA.newJobs).toBe(1);
      expect(resA.duplicates).toBe(0);

      // 2. Ingest same job from Remotive
      const resB = await ingestSource('remotive', {
        db: workerEnv.DB,
        kv: workerEnv.CONFIG,
      });

      expect(resB.newJobs).toBe(0);
      expect(resB.duplicates).toBe(1);

      // Verify only 1 row exists in jobs table
      const rows = await workerEnv.DB.prepare(
        `SELECT COUNT(*) as count FROM jobs WHERE company_normalized = 'nexus core'`,
      ).first<{ count: number }>();

      expect(rows?.count).toBe(1);

      // Verify event was logged with duplicate count
      const eventRow = await workerEnv.DB.prepare(
        `SELECT payload FROM events WHERE entity_id = 'remotive' AND type = 'source_run' ORDER BY created_at DESC LIMIT 1`,
      ).first<{ payload: string }>();

      const payload = JSON.parse(eventRow?.payload || '{}');
      expect(payload.duplicate).toBe(1);
      expect(payload.new).toBe(0);
    } finally {
      if (origRemoteOk) ALL_SOURCES['remoteok'] = origRemoteOk;
      if (origRemotive) ALL_SOURCES['remotive'] = origRemotive;
    }
  });

  it('A malformed payload from one source is logged and the other sources still complete', async () => {
    const mockFailingSource: JobSource = {
      name: 'adzuna',
      kind: 'api',
      async fetch() {
        throw new Error('Malformed JSON payload: unexpected token < in JSON');
      },
      normalize(raw) {
        return raw as unknown as NormalizedJob;
      },
    };

    const mockHealthySource: JobSource = {
      name: 'weworkremotely',
      kind: 'api',
      async fetch() {
        return [
          {
            id: 'wwr-job-ok',
            source: 'weworkremotely',
            title: 'Reliability Engineer',
            company: 'Healthy Corp',
            description: 'All good. Contact: hr@healthycorp.com',
          },
        ];
      },
      normalize(raw): NormalizedJob {
        return {
          source: 'weworkremotely',
          source_kind: 'api',
          source_job_id: 'wwr-job-ok',
          title: 'Reliability Engineer',
          company: 'Healthy Corp',
          company_normalized: 'healthy corp',
          location: 'Remote',
          remote: true,
          salary_min: 120000,
          salary_max: 140000,
          currency: 'USD',
          salary_raw: null,
          description: String(raw['description']),
          apply_url: 'https://weworkremotely.com/wwr-job-ok',
          contact_email: 'hr@healthycorp.com',
          contact_source: 'posting',
          posted_at: new Date().toISOString(),
          untrusted: true,
        };
      },
    };

    const origAdzuna = ALL_SOURCES['adzuna'];
    const origWwr = ALL_SOURCES['weworkremotely'];

    try {
      ALL_SOURCES['adzuna'] = mockFailingSource;
      ALL_SOURCES['weworkremotely'] = mockHealthySource;

      // Simulate queue consumer handling a batch with both sources
      const mockBatch: MessageBatch<unknown> = {
        queue: 'pigeon-jobs',
        messages: [
          {
            id: 'msg-fail',
            timestamp: new Date(),
            body: { source: 'adzuna' },
            ack: () => {},
            retry: () => {},
            attempts: 1,
          },
          {
            id: 'msg-success',
            timestamp: new Date(),
            body: { source: 'weworkremotely' },
            ack: () => {},
            retry: () => {},
            attempts: 1,
          },
        ],
        ackAll: () => {},
        retryAll: () => {},
        metadata: {
          metrics: { backlogCount: 0, backlogBytes: 0 },
        },
      };

      // queue consumer should process without throwing unhandled exception
      await expect(worker.queue(mockBatch, workerEnv)).resolves.toBeUndefined();

      // Healthy source succeeded and inserted job
      const healthyJob = await workerEnv.DB.prepare(
        `SELECT id, company FROM jobs WHERE company_normalized = 'healthy corp'`,
      ).first<{ id: string; company: string }>();

      expect(healthyJob?.company).toBe('Healthy Corp');

      // Failing source logged failure event
      const failEvent = await workerEnv.DB.prepare(
        `SELECT type, payload FROM events WHERE entity_id = 'adzuna' ORDER BY created_at DESC LIMIT 1`,
      ).first<{ type: string; payload: string }>();

      expect(failEvent).not.toBeNull();
      const payload = JSON.parse(failEvent?.payload || '{}');
      expect(payload.error).toContain('Malformed JSON payload');
    } finally {
      if (origAdzuna) ALL_SOURCES['adzuna'] = origAdzuna;
      if (origWwr) ALL_SOURCES['weworkremotely'] = origWwr;
    }
  });

  it('Jobs ingested while a source was half_open are tagged with route_reason = half_open_trial', async () => {
    const source = 'hiring_hn';
    const nowIso = new Date().toISOString();

    // Set source to half_open state
    await workerEnv.DB.prepare(
      `INSERT INTO source_state (source, consecutive_failures, circuit_state, opened_at, last_run_at)
       VALUES (?, 5, 'half_open', ?, ?)
       ON CONFLICT(source) DO UPDATE SET circuit_state = 'half_open'`,
    )
      .bind(source, nowIso, nowIso)
      .run();

    const mockHnSource: JobSource = {
      name: 'hiring_hn',
      kind: 'api',
      async fetch() {
        return [
          {
            id: 'trial-job-1',
            comment_text: 'TrialCo | Rust Engineer | Remote | jobs@trialco.io',
          },
        ];
      },
      normalize(raw): NormalizedJob {
        return {
          source: 'hiring_hn',
          source_kind: 'api',
          source_job_id: 'trial-job-1',
          title: 'Rust Engineer',
          company: 'TrialCo',
          company_normalized: 'trialco',
          location: 'Remote',
          remote: true,
          salary_min: null,
          salary_max: null,
          currency: null,
          salary_raw: null,
          description: String(raw['comment_text']),
          apply_url: 'https://news.ycombinator.com/item?id=trial-job-1',
          contact_email: 'jobs@trialco.io',
          contact_source: 'posting',
          posted_at: nowIso,
          untrusted: true,
        };
      },
    };

    const origHn = ALL_SOURCES['hiring_hn'];
    try {
      ALL_SOURCES['hiring_hn'] = mockHnSource;

      const result = await ingestSource('hiring_hn', {
        db: workerEnv.DB,
        kv: workerEnv.CONFIG,
      });

      expect(result.isHalfOpenTrial).toBe(true);
      expect(result.newJobs).toBe(1);

      // Verify the inserted job has route_reason = 'half_open_trial'
      const jobRow = await workerEnv.DB.prepare(
        `SELECT route_reason FROM jobs WHERE company_normalized = 'trialco'`,
      ).first<{ route_reason: string }>();

      expect(jobRow?.route_reason).toBe('half_open_trial');

      // Verify circuit is now closed on trial success
      const stateRow = await workerEnv.DB.prepare(
        `SELECT circuit_state, consecutive_failures FROM source_state WHERE source = ?`,
      )
        .bind(source)
        .first<{ circuit_state: string; consecutive_failures: number }>();

      expect(stateRow?.circuit_state).toBe('closed');
      expect(stateRow?.consecutive_failures).toBe(0);
    } finally {
      if (origHn) ALL_SOURCES['hiring_hn'] = origHn;
    }
  });

  it('A 404 slug is disabled in KV and not requested again', async () => {
    // Set initial slugs in KV: ['valid-slug', 'broken-404-slug']
    await workerEnv.CONFIG.put(
      'sources:greenhouse:slugs',
      JSON.stringify(['valid-slug', 'broken-404-slug']),
    );

    const requestedUrls: string[] = [];

    const mockFetch: typeof fetch = async (input: RequestInfo | URL) => {
      const urlStr = input.toString();
      requestedUrls.push(urlStr);

      if (urlStr.includes('broken-404-slug')) {
        return new Response('Not Found', { status: 404 });
      }

      return new Response(
        JSON.stringify({
          jobs: [
            {
              id: 991,
              title: 'Systems Lead',
              updated_at: new Date().toISOString(),
              absolute_url: 'https://boards.greenhouse.io/valid-slug/jobs/991',
              location: { name: 'Remote' },
              content: 'Great role at valid slug',
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    };

    // Run Greenhouse adapter fetch
    const jobs = await greenhouseAdapter.fetch({
      kv: workerEnv.CONFIG,
      fetchFn: mockFetch,
    });

    expect(jobs).toHaveLength(1);
    expect(requestedUrls.some((u) => u.includes('broken-404-slug'))).toBe(true);

    // Verify KV now has 'broken-404-slug' removed
    const updatedSlugsRaw = await workerEnv.CONFIG.get('sources:greenhouse:slugs');
    expect(updatedSlugsRaw).not.toBeNull();
    const updatedSlugs = JSON.parse(updatedSlugsRaw || '[]');
    expect(updatedSlugs).toEqual(['valid-slug']);

    // Next run should only request 'valid-slug'
    requestedUrls.length = 0;
    await greenhouseAdapter.fetch({
      kv: workerEnv.CONFIG,
      fetchFn: mockFetch,
    });

    expect(requestedUrls).toHaveLength(1);
    expect(requestedUrls[0]).toContain('valid-slug');
    expect(requestedUrls.some((u) => u.includes('broken-404-slug'))).toBe(false);
  });

  it('Cron Trigger scheduled handler enqueues a message for each enabled source', async () => {
    // Put test enabled sources list in KV
    await workerEnv.CONFIG.put(
      'sources:enabled',
      JSON.stringify(['remoteok', 'remotive', 'weworkremotely']),
    );

    const enqueuedMessages: unknown[] = [];
    const mockQueue = {
      async send(message: unknown) {
        enqueuedMessages.push(message);
      },
    } as unknown as Queue;

    const scheduledEnv: Bindings = {
      ...workerEnv,
      JOBS_QUEUE: mockQueue,
    };

    const mockScheduledEvent = {
      cron: '0 */3 * * *',
      scheduledTime: Date.now(),
      noRetry() {},
    } as unknown as ScheduledEvent;

    await worker.scheduled(mockScheduledEvent, scheduledEnv);

    expect(enqueuedMessages).toHaveLength(3);
    expect(enqueuedMessages).toEqual([
      { source: 'remoteok' },
      { source: 'remotive' },
      { source: 'weworkremotely' },
    ]);
  });
});
