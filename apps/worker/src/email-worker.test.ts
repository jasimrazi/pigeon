import { describe, it, expect, beforeAll, vi } from 'vitest';
import { applyD1Migrations, env } from 'cloudflare:test';
import worker from './index.js';
import type { Bindings } from './env.js';

interface TestEnv extends Bindings {
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
}

const workerEnv = env as unknown as TestEnv;

function createEmailMessage(params: {
  rawEml: string;
  from: string;
  to: string;
}): ForwardableEmailMessage {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(params.rawEml);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });

  return {
    from: params.from,
    to: params.to,
    headers: new Headers([
      ['from', params.from],
      ['to', params.to],
    ]),
    raw: stream,
    setReject: vi.fn(),
    forward: vi.fn(),
  } as unknown as ForwardableEmailMessage;
}

const LINKEDIN_EML_FIXTURE = `From: "LinkedIn Job Alerts" <jobalerts-noreply@linkedin.com>
To: "Alex Mercer" <alerts@pigeon.example.com>
Subject: 2 new jobs for 'Edge Platform Engineer'
Date: Tue, 04 Nov 2026 10:00:00 +0000
Message-ID: <worker-test-alert-001@linkedin.com>
MIME-Version: 1.0
Content-Type: text/html; charset=UTF-8

<!DOCTYPE html>
<html>
<body>
  <div>
    <h1>Jobs matching your alert</h1>
    <table class="job-card">
      <tr>
        <td>
          <a href="https://www.linkedin.com/comm/jobs/view/9988776655?trk=eml-job-alert-member-detail&amp;trackingId=worker123&amp;refId=refworker">Edge Platform Engineer &amp; Architect</a>
          <div class="company-name">EdgeWorks Inc</div>
          <div class="job-location">San Francisco, CA (Remote)</div>
          <div class="salary-info">$170,000 - $210,000 / yr</div>
        </td>
      </tr>
    </table>
    <table class="job-card">
      <tr>
        <td>
          <a href="https://www.linkedin.com/jobs/view/9988776656?trk=eml-job-alert-member-detail">Systems Reliability Lead</a>
          <div class="company-name">CoreScale Technologies</div>
          <div class="job-location">Remote</div>
        </td>
      </tr>
    </table>
  </div>
</body>
</html>
`;

const WRONG_FORWARDING_EML_FIXTURE = `From: "LinkedIn Job Alerts" <jobalerts-noreply@linkedin.com>
To: "Unknown User" <wrong-recipient@stranger.com>
Subject: 1 new job for 'Database Administrator'
Date: Tue, 04 Nov 2026 10:02:00 +0000
Message-ID: <wrong-dest-001@linkedin.com>
MIME-Version: 1.0
Content-Type: text/html; charset=UTF-8

<!DOCTYPE html>
<html><body><a href="https://www.linkedin.com/jobs/view/1234567">Database Administrator</a></body></html>
`;

const SPAM_EML_FIXTURE = `From: "Phishing Blast" <spammer@evil-spammer.net>
To: "Alex Mercer" <alerts@pigeon.example.com>
Subject: Urgent Money Making System
Date: Tue, 04 Nov 2026 10:05:00 +0000
Message-ID: <spam-999@evil-spammer.net>
MIME-Version: 1.0
Content-Type: text/html; charset=UTF-8

<!DOCTYPE html>
<html><body><p>Click here for riches: http://evil.com/phish</p></body></html>
`;

describe('Cloudflare Email Worker Integration (Workers Pool)', () => {
  beforeAll(async () => {
    await applyD1Migrations(workerEnv.DB, workerEnv.TEST_MIGRATIONS);

    // Seed profile in D1 with configured email
    await workerEnv.DB.prepare(
      `INSERT INTO profile (id, data, updated_at)
       VALUES ('default', ?, ?)
       ON CONFLICT(id) DO UPDATE SET data = ?, updated_at = ?`,
    )
      .bind(
        JSON.stringify({
          name: 'Alex Mercer',
          email: 'alerts@pigeon.example.com',
          skills: ['TypeScript'],
          experience: [],
          education: [],
          preferences: { locations: ['Remote'], roles: [] },
          filters: {},
          send_settings: { daily_cap: 10, timezone: 'UTC' },
          answers: {},
        }),
        new Date().toISOString(),
        JSON.stringify({
          name: 'Alex Mercer',
          email: 'alerts@pigeon.example.com',
          skills: ['TypeScript'],
          experience: [],
          education: [],
          preferences: { locations: ['Remote'], roles: [] },
          filters: {},
          send_settings: { daily_cap: 10, timezone: 'UTC' },
          answers: {},
        }),
        new Date().toISOString(),
      )
      .run();
  });

  it('rejects mail from an unauthorized sender domain and logs email_dropped with NO body', async () => {
    const msg = createEmailMessage({
      rawEml: SPAM_EML_FIXTURE,
      from: 'alerts@pigeon.example.com',
      to: 'alerts@pigeon.example.com',
    });

    await worker.email(msg, workerEnv as unknown as Bindings);

    // Verify event in D1
    const event = await workerEnv.DB.prepare(
      `SELECT * FROM events WHERE type = 'email_dropped' ORDER BY created_at DESC LIMIT 1`,
    ).first<{ payload: string }>();

    expect(event).toBeDefined();
    const payload = JSON.parse(event?.payload ?? '{}');
    expect(payload.reason).toBe('unauthorized_sender');
    expect(payload.from).toBe('spammer@evil-spammer.net');
    expect(payload.to).toBe('alerts@pigeon.example.com');
    // Verify strictly NO body or content in logs
    expect(payload.body).toBeUndefined();
    expect(payload.html).toBeUndefined();
    expect(payload.text).toBeUndefined();
  });

  it('rejects mail directed to a wrong forwarding address and logs email_dropped with NO body', async () => {
    const msg = createEmailMessage({
      rawEml: WRONG_FORWARDING_EML_FIXTURE,
      from: 'unauthorized-forwarder@stranger.com',
      to: 'alerts@pigeon.example.com',
    });

    await worker.email(msg, workerEnv as unknown as Bindings);

    const event = await workerEnv.DB.prepare(
      `SELECT * FROM events WHERE type = 'email_dropped' AND payload LIKE '%invalid_forwarding_address%' ORDER BY created_at DESC LIMIT 1`,
    ).first<{ payload: string }>();

    expect(event).toBeDefined();
    const payload = JSON.parse(event?.payload ?? '{}');
    expect(payload.reason).toBe('invalid_forwarding_address');
    expect(payload.body).toBeUndefined();
  });

  it('ingests valid LinkedIn alert email into D1 and verifies NO outbound fetch occurs', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const msg = createEmailMessage({
      rawEml: LINKEDIN_EML_FIXTURE,
      from: 'alerts@pigeon.example.com',
      to: 'alerts@pigeon.example.com',
    });

    await worker.email(msg, workerEnv as unknown as Bindings);

    // Outbound fetch guard: assert no fetch was made on any URL in the email
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();

    // Verify jobs stored in D1
    const job1 = await workerEnv.DB.prepare(
      `SELECT * FROM jobs WHERE company_normalized = 'edgeworks' LIMIT 1`,
    ).first<{
      title: string;
      source_kind: string;
      contact_source: string;
      contact_email: string | null;
      apply_route: string | null;
      route_reason: string | null;
      apply_url: string;
      salary_min: number;
      salary_max: number;
      untrusted: number;
    }>();

    expect(job1).toBeDefined();
    // HTML in title must be clean plain text
    expect(job1?.title).toBe('Edge Platform Engineer & Architect');
    expect(job1?.source_kind).toBe('alert_email');
    expect(job1?.contact_source).toBe('none');
    expect(job1?.contact_email).toBeNull();
    // Ingestion must not decide routing: apply_route and route_reason remain null
    expect(job1?.apply_route).toBeNull();
    expect(job1?.route_reason).toBeNull();
    expect(job1?.apply_url).toBe('https://www.linkedin.com/comm/jobs/view/9988776655');
    expect(job1?.salary_min).toBe(170000);
    expect(job1?.salary_max).toBe(210000);
    expect(job1?.untrusted).toBe(0);

    // Verify deduplication: sending the same email again does not create duplicate rows
    const countBefore = await workerEnv.DB.prepare(
      `SELECT COUNT(*) as count FROM jobs WHERE company_normalized = 'edgeworks'`,
    ).first<{ count: number }>();
    expect(countBefore?.count).toBe(1);

    const msg2 = createEmailMessage({
      rawEml: LINKEDIN_EML_FIXTURE,
      from: 'alerts@pigeon.example.com',
      to: 'alerts@pigeon.example.com',
    });
    await worker.email(msg2, workerEnv as unknown as Bindings);

    const countAfter = await workerEnv.DB.prepare(
      `SELECT COUNT(*) as count FROM jobs WHERE company_normalized = 'edgeworks'`,
    ).first<{ count: number }>();
    expect(countAfter?.count).toBe(1);
  });
});
