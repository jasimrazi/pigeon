import { describe, it, expect, vi } from 'vitest';
import {
  adzunaAdapter,
  remoteokAdapter,
  remotiveAdapter,
  weWorkRemotelyAdapter,
  hiringHnAdapter,
  greenhouseAdapter,
  leverAdapter,
  ashbyAdapter,
  parseRssXml,
} from './index.js';
import { ingestSource } from './ingest.js';
import type { D1LikeDatabase } from '../state-machine.js';
import type { KVNamespaceLike } from './types.js';

import adzunaFixture from '../../fixtures/sources/adzuna.json' with { type: 'json' };
import remoteokFixture from '../../fixtures/sources/remoteok.json' with { type: 'json' };
import remotiveFixture from '../../fixtures/sources/remotive.json' with { type: 'json' };
import hnFixture from '../../fixtures/sources/hiring-hn.json' with { type: 'json' };
import greenhouseFixture from '../../fixtures/sources/greenhouse.json' with { type: 'json' };
import leverFixture from '../../fixtures/sources/lever.json' with { type: 'json' };
import ashbyFixture from '../../fixtures/sources/ashby.json' with { type: 'json' };

const weworkremotelyXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>We Work Remotely - Remote Jobs</title>
    <link>https://weworkremotely.com</link>
    <description>The largest remote work community in the world.</description>
    <item>
      <title>Automattic: Senior Systems Developer</title>
      <link>https://weworkremotely.com/remote-jobs/automattic-senior-systems-developer</link>
      <description><![CDATA[<p>Automattic is looking for a Senior Systems Developer. We are 100% distributed.</p><p>For inquiries, email jobs-inbox@automattic.com</p>]]></description>
      <pubDate>Sun, 01 Nov 2026 08:00:00 +0000</pubDate>
      <guid>https://weworkremotely.com/remote-jobs/automattic-senior-systems-developer-404</guid>
    </item>
  </channel>
</rss>`;

describe('Job Source Adapters - Fixture Normalization', () => {
  it('Adzuna (India) normalizes fixture correctly', async () => {
    const rawJob = adzunaFixture.results[0];
    expect(rawJob).toBeDefined();
    if (!rawJob) return;
    const normalized = adzunaAdapter.normalize(rawJob);

    expect(normalized.source).toBe('adzuna');
    expect(normalized.source_kind).toBe('api');
    expect(normalized.source_job_id).toBe('adzuna-job-101');
    expect(normalized.title).toBe('Senior Cloud Infrastructure Engineer');
    expect(normalized.company).toBe('TechCorp India Private Limited');
    expect(normalized.company_normalized).toBe('techcorp india');
    expect(normalized.location).toBe('Bengaluru, Karnataka, India');
    expect(normalized.salary_min).toBe(1800000);
    expect(normalized.salary_max).toBe(2800000);
    expect(normalized.currency).toBe('INR');
    expect(normalized.contact_email).toBe('recruiter@techcorp.in');
    expect(normalized.contact_source).toBe('posting');
    expect(normalized.apply_url).toBe('https://www.adzuna.in/land/ad/101');
    expect(normalized.untrusted).toBe(true);

    // Verify fetch uses mock
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(adzunaFixture), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const fetched = await adzunaAdapter.fetch({
      secrets: { ADZUNA_APP_ID: 'mock-adzuna-id', ADZUNA_APP_KEY: 'mock-adzuna-key' },
      fetchFn: mockFetch,
    });
    expect(fetched).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalled();

    // Verify it throws ConfigError if secrets are missing
    await expect(adzunaAdapter.fetch({ fetchFn: mockFetch })).rejects.toThrow(
      'Missing required Adzuna credentials',
    );
  });

  it('RemoteOK normalizes fixture correctly and skips legal disclaimer', async () => {
    const rawJob = remoteokFixture[1];
    expect(rawJob).toBeDefined();
    if (!rawJob) return;
    const normalized = remoteokAdapter.normalize(rawJob);

    expect(normalized.source).toBe('remoteok');
    expect(normalized.source_kind).toBe('api');
    expect(normalized.source_job_id).toBe('remoteok-202');
    expect(normalized.title).toBe('Full Stack Engineer (TypeScript / Node)');
    expect(normalized.company).toBe('Nomad Devs LLC');
    expect(normalized.company_normalized).toBe('nomad devs');
    expect(normalized.remote).toBe(true);
    expect(normalized.salary_min).toBe(110000);
    expect(normalized.salary_max).toBe(140000);
    expect(normalized.currency).toBe('USD');
    expect(normalized.contact_email).toBe('hiring.team@nomaddevs.com');
    expect(normalized.contact_source).toBe('posting');

    // Test fetch filtering out legal disclaimer
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(remoteokFixture), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const fetched = await remoteokAdapter.fetch({ fetchFn: mockFetch });
    expect(fetched).toHaveLength(1);
    expect(fetched[0]?.['id']).toBe('remoteok-202');
  });

  it('Remotive normalizes fixture correctly', async () => {
    const rawJob = remotiveFixture.jobs[0];
    expect(rawJob).toBeDefined();
    if (!rawJob) return;
    const normalized = remotiveAdapter.normalize(rawJob);

    expect(normalized.source).toBe('remotive');
    expect(normalized.source_kind).toBe('api');
    expect(normalized.source_job_id).toBe('303');
    expect(normalized.title).toBe('Senior Backend Engineer');
    expect(normalized.company).toBe('Distributed Systems Co');
    expect(normalized.company_normalized).toBe('distributed systems');
    expect(normalized.location).toBe('Remote - Worldwide');
    expect(normalized.remote).toBe(true);
    expect(normalized.salary_min).toBe(130000);
    expect(normalized.salary_max).toBe(160000);
    expect(normalized.currency).toBe('USD');
    expect(normalized.contact_email).toBe('talent@distributedsystems.co');
    expect(normalized.contact_source).toBe('posting');
  });

  it('WeWorkRemotely RSS parses XML and normalizes fixture correctly', async () => {
    const rawJobs = parseRssXml(weworkremotelyXml);
    expect(rawJobs).toHaveLength(1);

    const rawJob = rawJobs[0];
    expect(rawJob).toBeDefined();
    if (!rawJob) return;
    const normalized = weWorkRemotelyAdapter.normalize(rawJob);

    expect(normalized.source).toBe('weworkremotely');
    expect(normalized.source_kind).toBe('api');
    expect(normalized.title).toBe('Senior Systems Developer');
    expect(normalized.company).toBe('Automattic');
    expect(normalized.company_normalized).toBe('automattic');
    expect(normalized.remote).toBe(true);
    expect(normalized.contact_email).toBe('jobs-inbox@automattic.com');
    expect(normalized.contact_source).toBe('posting');
    expect(normalized.apply_url).toBe(
      'https://weworkremotely.com/remote-jobs/automattic-senior-systems-developer',
    );
  });

  it('HN "Who is hiring" normalizes comment fixture correctly', async () => {
    const rawComment = hnFixture.commentSearch.hits[0];
    expect(rawComment).toBeDefined();
    if (!rawComment) return;
    const normalized = hiringHnAdapter.normalize(rawComment);

    expect(normalized.source).toBe('hiring_hn');
    expect(normalized.source_kind).toBe('api');
    expect(normalized.source_job_id).toBe('comm-501');
    expect(normalized.company).toBe('Stripe');
    expect(normalized.title).toBe('Infrastructure Engineer');
    expect(normalized.location).toBe('San Francisco, CA');
    expect(normalized.remote).toBe(true);
    expect(normalized.salary_min).toBe(160000);
    expect(normalized.salary_max).toBe(220000);
    expect(normalized.contact_email).toBe('jobs-infra@stripe.com');
    expect(normalized.contact_source).toBe('posting');
  });

  it('Greenhouse normalizes ATS fixture correctly', async () => {
    const firstJob = greenhouseFixture.jobs[0];
    expect(firstJob).toBeDefined();
    if (!firstJob) return;
    const rawJob = {
      ...firstJob,
      company_slug: 'github',
    };
    const normalized = greenhouseAdapter.normalize(rawJob);

    expect(normalized.source).toBe('greenhouse');
    expect(normalized.source_kind).toBe('ats');
    expect(normalized.source_job_id).toBe('601');
    expect(normalized.title).toBe('Staff Platform Engineer');
    expect(normalized.company).toBe('Github');
    expect(normalized.location).toBe('Remote, US');
    expect(normalized.remote).toBe(true);
    expect(normalized.contact_email).toBe('recruiting@github.com');
    expect(normalized.contact_source).toBe('posting');
    expect(normalized.apply_url).toBe('https://boards.greenhouse.io/github/jobs/601');
  });

  it('Lever normalizes ATS fixture correctly', async () => {
    const firstJob = leverFixture[0];
    expect(firstJob).toBeDefined();
    if (!firstJob) return;
    const rawJob = {
      ...firstJob,
      company_slug: 'cloudflare',
    };
    const normalized = leverAdapter.normalize(rawJob);

    expect(normalized.source).toBe('lever');
    expect(normalized.source_kind).toBe('ats');
    expect(normalized.source_job_id).toBe('lever-701');
    expect(normalized.title).toBe('Senior Edge Computing Architect');
    expect(normalized.company).toBe('Cloudflare');
    expect(normalized.location).toBe('San Francisco / Remote');
    expect(normalized.remote).toBe(true);
    expect(normalized.contact_email).toBe('edge-hiring@cloudflare.com');
    expect(normalized.contact_source).toBe('posting');
    expect(normalized.apply_url).toBe('https://jobs.lever.co/cloudflare/lever-701');
  });

  it('Ashby normalizes ATS fixture correctly', async () => {
    const firstJob = ashbyFixture.jobs[0];
    expect(firstJob).toBeDefined();
    if (!firstJob) return;
    const rawJob = {
      ...firstJob,
      company_slug: 'linear',
    };
    const normalized = ashbyAdapter.normalize(rawJob);

    expect(normalized.source).toBe('ashby');
    expect(normalized.source_kind).toBe('ats');
    expect(normalized.source_job_id).toBe('ashby-801');
    expect(normalized.title).toBe('Principal Distributed Systems Engineer');
    expect(normalized.company).toBe('Linear');
    expect(normalized.remote).toBe(true);
    expect(normalized.salary_min).toBe(180000);
    expect(normalized.salary_max).toBe(220000);
    expect(normalized.currency).toBe('USD');
    expect(normalized.contact_email).toBe('engineering-careers@linear.app');
    expect(normalized.contact_source).toBe('posting');
    expect(normalized.apply_url).toBe('https://jobs.ashbyhq.com/linear/ashby-801');
  });

  it('1 oversized board out of 5 -> the run succeeds with the other 4 boards jobs', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Create an oversized payload with 1001 jobs (exceeding .max(1000))
    const oversizedJobs = Array.from({ length: 1001 }, (_, i) => ({
      id: i + 1,
      title: `Job ${i + 1}`,
      absolute_url: `https://boards.greenhouse.io/huge/jobs/${i + 1}`,
    }));

    const mockFetch = vi.fn().mockImplementation((url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.includes('huge-company')) {
        return Promise.resolve(
          new Response(JSON.stringify({ jobs: oversizedJobs }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      const match = urlStr.match(/v1\/boards\/([^/]+)\/jobs/);
      const slug = match ? match[1] : 'normal';
      return Promise.resolve(
        new Response(
          JSON.stringify({
            jobs: [
              {
                id: 999,
                title: `Valid Job for ${slug}`,
                absolute_url: `https://boards.greenhouse.io/${slug}/jobs/999`,
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );
    });

    const results = await greenhouseAdapter.fetch({
      slugs: ['huge-company', 'co-2', 'co-3', 'co-4', 'co-5'],
      fetchFn: mockFetch,
    });

    // 1 oversized board out of 5 was skipped and logged
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[greenhouse] Validation failed for company slug 'huge-company':"),
      expect.anything(),
    );

    // The other 4 boards succeeded and their jobs were returned
    expect(results).toHaveLength(4);
    const slugsReturned = results.map((r) => r['company_slug']);
    expect(slugsReturned).toEqual(['co-2', 'co-3', 'co-4', 'co-5']);

    // Slug failure statistics are recorded on the array
    const stats = (
      results as { slugStats?: { total: number; failed: number; failedSlugs: string[] } }
    ).slugStats;
    expect(stats).toEqual({
      total: 5,
      failed: 1,
      failedSlugs: ['huge-company'],
    });

    warnSpy.mockRestore();
  });

  it('1 of 5 boards returns 500 after retries -> the run succeeds with the other 4 boards jobs and failedSlugs names that board', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const mockFetch = vi.fn().mockImplementation((url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.includes('slug-500')) {
        return Promise.resolve(
          new Response('Internal Server Error', {
            status: 500,
            headers: { 'Content-Type': 'text/plain' },
          }),
        );
      }
      const match = urlStr.match(/v1\/boards\/([^/]+)\/jobs/);
      const slug = match ? match[1] : 'normal';
      return Promise.resolve(
        new Response(
          JSON.stringify({
            jobs: [
              {
                id: 101,
                title: `Valid Job for ${slug}`,
                absolute_url: `https://boards.greenhouse.io/${slug}/jobs/101`,
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );
    });

    const results = await greenhouseAdapter.fetch({
      slugs: ['slug-500', 'co-2', 'co-3', 'co-4', 'co-5'],
      fetchFn: mockFetch,
      delayFn: vi.fn(),
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "[greenhouse] Failed to fetch or parse jobs for company slug 'slug-500':",
      ),
      expect.anything(),
    );

    expect(results).toHaveLength(4);
    const slugsReturned = results.map((r) => r['company_slug']);
    expect(slugsReturned).toEqual(['co-2', 'co-3', 'co-4', 'co-5']);

    const stats = (
      results as { slugStats?: { total: number; failed: number; failedSlugs: string[] } }
    ).slugStats;
    expect(stats).toEqual({
      total: 5,
      failed: 1,
      failedSlugs: ['slug-500'],
    });

    warnSpy.mockRestore();
  });

  it('1 of 5 returns 403 -> the run succeeds with the other 4 boards jobs and failedSlugs names that board', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const mockFetch = vi.fn().mockImplementation((url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.includes('slug-403')) {
        return Promise.resolve(
          new Response('Forbidden', {
            status: 403,
            headers: { 'Content-Type': 'text/plain' },
          }),
        );
      }
      const match = urlStr.match(/v1\/boards\/([^/]+)\/jobs/);
      const slug = match ? match[1] : 'normal';
      return Promise.resolve(
        new Response(
          JSON.stringify({
            jobs: [
              {
                id: 102,
                title: `Valid Job for ${slug}`,
                absolute_url: `https://boards.greenhouse.io/${slug}/jobs/102`,
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );
    });

    const results = await greenhouseAdapter.fetch({
      slugs: ['slug-403', 'co-2', 'co-3', 'co-4', 'co-5'],
      fetchFn: mockFetch,
      delayFn: vi.fn(),
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "[greenhouse] Failed to fetch or parse jobs for company slug 'slug-403':",
      ),
      expect.anything(),
    );

    expect(results).toHaveLength(4);
    const slugsReturned = results.map((r) => r['company_slug']);
    expect(slugsReturned).toEqual(['co-2', 'co-3', 'co-4', 'co-5']);

    const stats = (
      results as { slugStats?: { total: number; failed: number; failedSlugs: string[] } }
    ).slugStats;
    expect(stats).toEqual({
      total: 5,
      failed: 1,
      failedSlugs: ['slug-403'],
    });

    warnSpy.mockRestore();
  });

  it('a board is still 429 after retries -> the run throws and later boards are not requested', async () => {
    const mockDelay = vi.fn().mockResolvedValue(undefined);
    const mockFetch = vi.fn().mockImplementation((url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.includes('slug-429')) {
        return Promise.resolve(
          new Response('Too Many Requests', {
            status: 429,
            headers: {
              'Content-Type': 'text/plain',
              'Retry-After': '2',
            },
          }),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            jobs: [
              {
                id: 103,
                title: 'Should Not Be Fetched',
                absolute_url: 'https://boards.greenhouse.io/later/103',
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );
    });

    await expect(
      greenhouseAdapter.fetch({
        slugs: ['slug-429', 'slug-later-1', 'slug-later-2'],
        fetchFn: mockFetch,
        delayFn: mockDelay,
      }),
    ).rejects.toThrow(/429|Too Many Requests/i);

    // Later boards were never requested
    const calledUrls = mockFetch.mock.calls.map((call) => String(call[0]));
    expect(calledUrls.some((u) => u.includes('slug-later-1'))).toBe(false);
    expect(calledUrls.some((u) => u.includes('slug-later-2'))).toBe(false);
  });

  it('Lever: 1 of 5 boards returns 500 after retries -> the run succeeds with the other 4 boards jobs and failedSlugs names that board', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const mockFetch = vi.fn().mockImplementation((url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.includes('lever-500')) {
        return Promise.resolve(
          new Response('Internal Server Error', {
            status: 500,
            headers: { 'Content-Type': 'text/plain' },
          }),
        );
      }
      const match = urlStr.match(/v0\/postings\/([^?]+)/);
      const slug = match ? match[1] : 'normal';
      return Promise.resolve(
        new Response(
          JSON.stringify([
            {
              id: `lev-${slug}`,
              text: `Lever Job for ${slug}`,
              hostedUrl: `https://jobs.lever.co/${slug}/1`,
            },
          ]),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );
    });

    const results = await leverAdapter.fetch({
      slugs: ['lever-500', 'l-2', 'l-3', 'l-4', 'l-5'],
      fetchFn: mockFetch,
      delayFn: vi.fn(),
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "[lever] Failed to fetch or parse jobs for company slug 'lever-500':",
      ),
      expect.anything(),
    );

    expect(results).toHaveLength(4);
    const slugsReturned = results.map((r) => r['company_slug']);
    expect(slugsReturned).toEqual(['l-2', 'l-3', 'l-4', 'l-5']);

    const stats = (
      results as { slugStats?: { total: number; failed: number; failedSlugs: string[] } }
    ).slugStats;
    expect(stats).toEqual({
      total: 5,
      failed: 1,
      failedSlugs: ['lever-500'],
    });

    warnSpy.mockRestore();
  });

  it('Ashby: 1 of 5 boards returns 500 after retries -> the run succeeds with the other 4 boards jobs and failedSlugs names that board', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const mockFetch = vi.fn().mockImplementation((url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.includes('ashby-500')) {
        return Promise.resolve(
          new Response('Internal Server Error', {
            status: 500,
            headers: { 'Content-Type': 'text/plain' },
          }),
        );
      }
      const match = urlStr.match(/job-board\/([^?]+)/);
      const slug = match ? match[1] : 'normal';
      return Promise.resolve(
        new Response(
          JSON.stringify({
            jobs: [
              {
                id: `ash-${slug}`,
                title: `Ashby Job for ${slug}`,
                jobUrl: `https://jobs.ashbyhq.com/${slug}/1`,
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );
    });

    const results = await ashbyAdapter.fetch({
      slugs: ['ashby-500', 'a-2', 'a-3', 'a-4', 'a-5'],
      fetchFn: mockFetch,
      delayFn: vi.fn(),
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "[ashby] Failed to fetch or parse jobs for company slug 'ashby-500':",
      ),
      expect.anything(),
    );

    expect(results).toHaveLength(4);
    const slugsReturned = results.map((r) => r['company_slug']);
    expect(slugsReturned).toEqual(['a-2', 'a-3', 'a-4', 'a-5']);

    const stats = (
      results as { slugStats?: { total: number; failed: number; failedSlugs: string[] } }
    ).slugStats;
    expect(stats).toEqual({
      total: 5,
      failed: 1,
      failedSlugs: ['ashby-500'],
    });

    warnSpy.mockRestore();
  });

  it('all boards return 500 -> the run fails and increments consecutive_failures', async () => {
    const sourceStateMap = new Map<
      string,
      { circuit_state: 'closed' | 'open' | 'half_open'; consecutive_failures: number }
    >();
    const events: Array<{ entity_id: string; type: string; payload: string }> = [];

    const mockDb: D1LikeDatabase = {
      prepare(query: string) {
        let boundParams: unknown[] = [];
        const stmt = {
          bind(...params: unknown[]) {
            boundParams = params;
            return stmt;
          },
          async first<T>(): Promise<T | null> {
            if (query.includes('FROM source_state WHERE source = ?')) {
              const source = String(boundParams[0]);
              const state = sourceStateMap.get(source);
              if (!state) return null;
              return { ...state } as unknown as T;
            }
            return null;
          },
          async all<T>(): Promise<{ results: T[] }> {
            return { results: [] };
          },
          async run() {
            if (query.includes('INSERT INTO source_state')) {
              const source = String(boundParams[0]);
              sourceStateMap.set(source, {
                circuit_state: 'closed',
                consecutive_failures: 0,
              });
            } else if (query.includes('UPDATE source_state SET consecutive_failures = ?')) {
              const failures = Number(boundParams[0]);
              const source = String(boundParams[3]);
              const curr = sourceStateMap.get(source) || {
                circuit_state: 'closed',
                consecutive_failures: 0,
              };
              sourceStateMap.set(source, {
                circuit_state: curr.circuit_state,
                consecutive_failures: failures,
              });
            } else if (query.includes('INSERT INTO events')) {
              events.push({
                entity_id: String(boundParams[1]),
                type: query.includes("'source_failure'") ? 'source_failure' : 'source_run',
                payload: String(boundParams[2]),
              });
            }
            return { success: true };
          },
        };
        return stmt;
      },
      async batch(stmts: unknown[]) {
        for (const s of stmts as Array<{ run?: () => Promise<unknown> }>) {
          if (s && typeof s.run === 'function') await s.run();
        }
        return [];
      },
    };

    const mockFetch500 = vi.fn().mockResolvedValue(
      new Response('Internal Server Error', {
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
      }),
    );

    // ingestSource executes greenhouse with slugs returning 500
    await expect(
      ingestSource('greenhouse', {
        db: mockDb,
        slugs: ['slug-1', 'slug-2'],
        fetchFn: mockFetch500,
        delayFn: vi.fn(), // instant retry without waiting in tests
      }),
    ).rejects.toThrow();

    // Verify consecutive_failures is incremented toward circuit breaker
    const state = sourceStateMap.get('greenhouse');
    expect(state).toBeDefined();
    expect(state?.consecutive_failures).toBe(1);
  });

  it('429 on a board honours Retry-After', async () => {
    const mockDelay = vi.fn().mockResolvedValue(undefined);
    let attempts = 0;

    const mockFetch429 = vi.fn().mockImplementation(() => {
      attempts++;
      if (attempts === 1) {
        return Promise.resolve(
          new Response('Too Many Requests', {
            status: 429,
            headers: {
              'Content-Type': 'text/plain',
              'Retry-After': '5',
            },
          }),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            jobs: [
              {
                id: 101,
                title: 'Retry Job',
                absolute_url: 'https://boards.greenhouse.io/retry/101',
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );
    });

    const results = await greenhouseAdapter.fetch({
      slugs: ['retry-co'],
      fetchFn: mockFetch429,
      delayFn: mockDelay,
    });

    // 429 Retry-After of 5s was respected
    expect(mockDelay).toHaveBeenCalledWith(5000);
    expect(results).toHaveLength(1);
    expect(results[0]?.['title']).toBe('Retry Job');
  });

  it('a 404 slug is still disabled and skipped on the next run', async () => {
    const store = new Map<string, string>();
    store.set('sources:greenhouse:slugs', JSON.stringify(['dead-co', 'active-co']));

    const mockKv: KVNamespaceLike = {
      async get(key: string) {
        return store.get(key) ?? null;
      },
      async put(key: string, value: string) {
        store.set(key, value);
      },
    };

    const mockFetch = vi.fn().mockImplementation((url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.includes('dead-co')) {
        return Promise.resolve(new Response('Not Found', { status: 404 }));
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            jobs: [
              {
                id: 202,
                title: 'Active Job',
                absolute_url: 'https://boards.greenhouse.io/active/202',
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );
    });

    // Run 1: dead-co returns 404, active-co succeeds
    const run1 = await greenhouseAdapter.fetch({
      kv: mockKv,
      fetchFn: mockFetch,
    });

    expect(run1).toHaveLength(1);
    expect(run1[0]?.['company_slug']).toBe('active-co');

    // Verify dead-co was disabled in KV
    expect(store.get('sources:greenhouse:slugs')).toBe(JSON.stringify(['active-co']));

    // Run 2: dead-co is now skipped and not fetched
    mockFetch.mockClear();
    const run2 = await greenhouseAdapter.fetch({
      kv: mockKv,
      fetchFn: mockFetch,
    });

    expect(run2).toHaveLength(1);
    expect(mockFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('dead-co'),
      expect.anything(),
    );
  });

  it('throws as a source failure if half or more fail when there are 4 or more slugs', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const mockFetch = vi.fn().mockImplementation((url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.includes('bad-1') || urlStr.includes('bad-2')) {
        // Return oversized payload (>1000 jobs)
        return Promise.resolve(
          new Response(
            JSON.stringify({
              jobs: Array.from({ length: 1001 }, (_, i) => ({ id: i, title: `J${i}` })),
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            jobs: [{ id: 1, title: 'Good Job' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    });

    // 4 slugs, 2 fail -> 2 >= ceil(4/2) = 2 -> throws
    await expect(
      greenhouseAdapter.fetch({
        slugs: ['bad-1', 'bad-2', 'good-1', 'good-2'],
        fetchFn: mockFetch,
      }),
    ).rejects.toThrow('ATS source greenhouse failed: 2 of 4 boards failed');
  });

  it('run stats event records per-slug failure counts for Sources page', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const events: Array<{ type: string; payload: string }> = [];

    const mockDb: D1LikeDatabase = {
      prepare(query: string) {
        let boundParams: unknown[] = [];
        const stmt = {
          bind(...params: unknown[]) {
            boundParams = params;
            return stmt;
          },
          async first<T>(): Promise<T | null> {
            if (query.includes('FROM source_state WHERE source = ?')) {
              return { circuit_state: 'closed', consecutive_failures: 0 } as unknown as T;
            }
            if (query.includes('FROM jobs WHERE dedupe_key = ?')) {
              return null;
            }
            return null;
          },
          async all<T>(): Promise<{ results: T[] }> {
            return { results: [] };
          },
          async run() {
            if (query.includes('INSERT INTO events')) {
              events.push({
                type: query.includes("'source_run'") ? 'source_run' : 'other',
                payload: String(boundParams[2]),
              });
            }
            return { success: true };
          },
        };
        return stmt;
      },
      async batch(stmts: Array<{ run: () => Promise<unknown> }>) {
        for (const s of stmts) {
          if (s && typeof s.run === 'function') await s.run();
        }
        return [];
      },
    };

    const mockFetch = vi.fn().mockImplementation((url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.includes('bad-co')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              jobs: Array.from({ length: 1001 }, (_, i) => ({ id: i, title: `J${i}` })),
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            jobs: [{ id: 1, title: 'Job', content: 'TypeScript role' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    });

    const res = await ingestSource('greenhouse', {
      db: mockDb,
      slugs: ['bad-co', 'good-1', 'good-2', 'good-3', 'good-4'],
      fetchFn: mockFetch,
    });

    expect(res.boards_total).toBe(5);
    expect(res.boards_failed).toBe(1);

    // Verify source_run event payload contains boards_total and boards_failed
    const sourceRunEvent = events.find((e) => e.type === 'source_run');
    expect(sourceRunEvent).toBeDefined();
    if (!sourceRunEvent) throw new Error('source_run event not found');
    const payload = JSON.parse(sourceRunEvent.payload);
    expect(payload.boards_total).toBe(5);
    expect(payload.boards_failed).toBe(1);
    expect(payload.failed_boards).toEqual(['bad-co']);
  });

  it('Lever isolates oversized board (>1000 jobs) on its own without failing the source', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const oversizedJobs = Array.from({ length: 1001 }, (_, i) => ({
      id: `lever-${i + 1}`,
      text: `Lever Job ${i + 1}`,
      hostedUrl: `https://jobs.lever.co/huge/lever-${i + 1}`,
    }));

    const mockFetch = vi.fn().mockImplementation((url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.includes('huge-company')) {
        return Promise.resolve(
          new Response(JSON.stringify(oversizedJobs), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify([
            {
              id: 'lever-ok',
              text: 'Valid Job',
              hostedUrl: 'https://jobs.lever.co/normal/lever-ok',
            },
          ]),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );
    });

    const results = await leverAdapter.fetch({
      slugs: ['huge-company', 'normal-company', 'co-3'],
      fetchFn: mockFetch,
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[lever] Validation failed for company slug 'huge-company':"),
      expect.anything(),
    );

    expect(results).toHaveLength(2);
    warnSpy.mockRestore();
  });

  it('Ashby isolates oversized board (>1000 jobs) on its own without failing the source', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const oversizedJobs = Array.from({ length: 1001 }, (_, i) => ({
      id: `ashby-${i + 1}`,
      title: `Ashby Job ${i + 1}`,
      jobUrl: `https://jobs.ashbyhq.com/huge/ashby-${i + 1}`,
    }));

    const mockFetch = vi.fn().mockImplementation((url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.includes('huge-company')) {
        return Promise.resolve(
          new Response(JSON.stringify({ jobs: oversizedJobs }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            jobs: [
              {
                id: 'ashby-ok',
                title: 'Valid Job',
                jobUrl: 'https://jobs.ashbyhq.com/normal/ashby-ok',
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );
    });

    const results = await ashbyAdapter.fetch({
      slugs: ['huge-company', 'normal-company', 'co-3'],
      fetchFn: mockFetch,
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[ashby] Validation failed for company slug 'huge-company':"),
      expect.anything(),
    );

    expect(results).toHaveLength(2);
    warnSpy.mockRestore();
  });
});
