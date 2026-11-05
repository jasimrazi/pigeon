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
    const fetched = await adzunaAdapter.fetch({ fetchFn: mockFetch });
    expect(fetched).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalled();
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
});
