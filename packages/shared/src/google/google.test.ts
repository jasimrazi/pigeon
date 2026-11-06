import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { D1LikeDatabase } from '../state-machine.js';
import type { Profile } from '../profile.js';
import { encryptRefreshToken, decryptRefreshToken } from './crypto.js';
import { assertSafeHeader, toBase64Url, buildMimeMessage } from './mime.js';
import {
  getGoogleAuthUrl,
  getGoogleAuthHealth,
  setGoogleAuthHealth,
  completeGoogleAuthCallback,
  getValidAccessToken,
  pingGoogleAuthHealth,
  getTokenKey,
  KV_KEYS,
  type KVLike,
} from './auth.js';
import {
  approveApplication,
  bulkApproveApplications,
  checkAutoApprove,
  canBulkApprove,
} from './approval.js';
import {
  calculateEffectiveCap,
  applyBounceBrake,
  isInsideSendWindow,
  acquireSendSlot,
  sendApplicationEmail,
  type R2LikeBucket,
  type ApplicationToSend,
} from './send-worker.js';
import { GoogleRateLimitError, GoogleRecipientError } from './sender.js';
import type { GmailSender, SendEmailParams, SendEmailResult } from './types.js';
import type { Notifier, NotificationPayload } from '../notifier.js';

const mockProfile: Profile = {
  name: 'Alex Mercer',
  email: 'alex.mercer@example.com',
  skills: ['TypeScript', 'Cloudflare Workers', 'Distributed Systems'],
  experience: [
    {
      title: 'Senior Systems Engineer',
      company: 'Tech Corp',
      location: 'Remote',
      start_date: '2019-01',
      end_date: '2026-01',
      current: false,
      description: 'Distributed systems.',
      highlights: [],
    },
  ],
  education: [],
  preferences: {
    locations: ['Remote'],
    remote: true,
  },
  filters: {
    titles: ['Systems Engineer'],
    locations: ['Remote'],
    company_blacklist: [],
    min_score: 70,
    require_salary: false,
    experience_range: { min: 7, max: 12 },
  },
  send_settings: {
    daily_cap: 20,
    window: { start: '09:00', end: '18:00' },
    timezone: 'Asia/Kolkata',
    ramp_base: 5,
    ramp_step: 2,
    auto_approve_above_score: 85,
  },
  answers: {
    notice_period: '2 weeks',
    current_ctc: '$160,000',
    expected_ctc: '$180,000',
    work_authorisation: 'Citizen',
    links: { portfolio: 'https://alexmercer.dev' },
    other: {},
  },
};

const validCoverLetter = `Dear Hiring Team at Stripe,

I am writing to enthusiastically submit my application for the Senior Systems Engineer position. With 7 years of hands-on experience designing and operating distributed systems and high-throughput backend services, I am excited about the opportunity to contribute to Stripe's world-class platform and infrastructure engineering efforts.

Throughout my career, I have specialized in building robust TypeScript and Cloudflare Workers services, optimizing database access patterns, and ensuring low-latency communication across distributed clusters. At my previous roles, I led initiatives to improve service resilience and decrease edge API response times under heavy traffic loads. You can review my architecture notes and projects at https://alexmercer.dev.

I deeply admire Stripe's engineering culture and dedication to reliability and developer experience. I welcome the opportunity to discuss how my technical background in distributed systems and systems architecture aligns with your team's goals. Thank you very much for your time and consideration.

Warm regards,
Alex Mercer`;

const targetApp: ApplicationToSend = {
  id: 'app-target',
  job_id: 'job-target',
  channel: 'email',
  status: 'approved',
  cover_letter: validCoverLetter,
  subject: 'Application for Senior Systems Engineer',
  resume_id: 'res-valid',
  message_id_header: null,
  gmail_message_id: null,
  gmail_thread_id: null,
  retry_count: 0,
  title: 'Senior Systems Engineer',
  company: 'Stripe',
  company_normalized: 'stripe',
  contact_email: 'jobs@stripe.com',
};

function createMockKV(): KVLike & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
}

function createMockNotifier(): Notifier & { notifications: NotificationPayload[] } {
  const notifications: NotificationPayload[] = [];
  return {
    notifications,
    async notify(payload: NotificationPayload) {
      notifications.push(payload);
    },
  };
}

function createMockDb() {
  const jobs = new Map<string, Record<string, unknown>>();
  const applications = new Map<string, Record<string, unknown>>();
  const resumes = new Map<string, Record<string, unknown>>();
  const companiesContacted = new Map<string, Record<string, unknown>>();
  const doNotContact = new Set<string>();
  const dailyCounters = new Map<string, { sends: number; bounces: number }>();
  const events: Array<{ entity_id: string; type: string; payload: string }> = [];

  const db: D1LikeDatabase = {
    prepare(query: string) {
      let boundParams: unknown[] = [];
      const stmt = {
        bind(...params: unknown[]) {
          boundParams = params;
          return stmt;
        },
        async first<T>(): Promise<T | null> {
          if (query.includes('FROM do_not_contact')) {
            const val1 = String(boundParams[0]).toLowerCase();
            const val2 = String(boundParams[1]).toLowerCase();
            if (doNotContact.has(val1)) {
              return { value: val1 } as unknown as T;
            }
            if (doNotContact.has(val2)) {
              return { value: val2 } as unknown as T;
            }
            return null;
          }
          if (
            query.includes('FROM companies_contacted') &&
            query.includes('company_normalized = ?')
          ) {
            const comp = String(boundParams[0]);
            return (companiesContacted.get(comp) ?? null) as unknown as T;
          }
          if (query.includes('FROM resumes WHERE id = ?')) {
            const id = String(boundParams[0]);
            return (resumes.get(id) ?? null) as unknown as T;
          }
          if (query.includes('FROM applications') && query.includes('WHERE id = ?')) {
            const id = String(boundParams[0]);
            return (applications.get(id) ?? null) as unknown as T;
          }
          if (query.includes('SELECT status FROM applications WHERE id = ?')) {
            const id = String(boundParams[0]);
            const a = applications.get(id);
            return (a ? { status: a['status'] } : null) as unknown as T;
          }
          if (query.includes('MIN(sent_at)')) {
            let minSent: string | null = null;
            for (const a of applications.values()) {
              if (
                ['sent', 'bounced', 'replied', 'interview', 'rejected', 'offer'].includes(
                  String(a['status']),
                ) &&
                a['sent_at']
              ) {
                const s = String(a['sent_at']);
                if (!minSent || s < minSent) {
                  minSent = s;
                }
              }
            }
            return { first_sent_at: minSent } as unknown as T;
          }
          if (
            query.includes('FROM applications a') &&
            query.includes('JOIN jobs j') &&
            query.includes('WHERE a.id = ?')
          ) {
            const id = String(boundParams[0]);
            const a = applications.get(id);
            if (!a) return null;
            const j = jobs.get(String(a['job_id']));
            if (!j) return null;
            return {
              id: a['id'],
              status: a['status'],
              channel: a['channel'],
              cover_letter: a['cover_letter'],
              subject: a['subject'],
              job_id: a['job_id'],
              resume_id: a['resume_id'],
              message_id_header: a['message_id_header'],
              gmail_message_id: a['gmail_message_id'],
              gmail_thread_id: a['gmail_thread_id'],
              retry_count: a['retry_count'] ?? 0,
              title: j['title'],
              company: j['company'],
              company_normalized: j['company_normalized'],
              apply_route: j['apply_route'],
              contact_email: j['contact_email'],
              contact_source: j['contact_source'],
              route_reason: j['route_reason'],
              match_score: j['match_score'],
              red_flags: j['red_flags'] ?? null,
              untrusted: j['untrusted'] ?? false,
            } as unknown as T;
          }
          return null;
        },
        async all<T>(): Promise<{ results: T[] }> {
          if (query.includes('FROM applications') && query.includes('sent_at IS NOT NULL')) {
            const sList = Array.from(applications.values())
              .filter((a) => a['sent_at'] !== null && a['sent_at'] !== undefined)
              .sort((x, y) => String(y['sent_at']).localeCompare(String(x['sent_at'])))
              .slice(0, 20)
              .map((a) => ({ status: a['status'] }));
            return { results: sList as unknown as T[] };
          }
          return { results: [] };
        },
        async run() {
          if (query.includes('INSERT INTO daily_counters')) {
            const dateStr = String(boundParams[0]);
            const effectiveCap = Number(boundParams[1]);
            const current = dailyCounters.get(dateStr) ?? { sends: 0, bounces: 0 };
            if (current.sends < effectiveCap) {
              dailyCounters.set(dateStr, { sends: current.sends + 1, bounces: current.bounces });
              return { meta: { changes: 1 }, changes: 1 };
            }
            return { meta: { changes: 0 }, changes: 0 };
          }
          if (query.includes('UPDATE applications') && query.includes('SET')) {
            const id = String(boundParams[boundParams.length - 1]);
            const app = applications.get(id);
            if (app) {
              if (query.includes('status = ?')) {
                app['status'] = boundParams[0];
              }
              if (query.includes("status = 'approved'")) {
                app['status'] = 'approved';
              }
              if (query.includes('error = ?')) {
                app['error'] = boundParams[0];
              }
              if (query.includes('message_id_header = ?')) {
                app['message_id_header'] = boundParams[0];
              }
              if (query.includes('gmail_message_id = ?')) {
                app['gmail_message_id'] = boundParams[0];
                app['gmail_thread_id'] = boundParams[1];
                app['sent_at'] = boundParams[2];
              }
            }
            return { meta: { changes: 1 }, changes: 1 };
          }
          if (query.includes('INSERT INTO companies_contacted')) {
            const comp = String(boundParams[0]);
            const lastContact = String(boundParams[1]);
            companiesContacted.set(comp, {
              company_normalized: comp,
              last_contacted_at: lastContact,
            });
            return { meta: { changes: 1 }, changes: 1 };
          }
          if (query.includes('INSERT INTO events')) {
            if (query.includes("'email_dry_run'")) {
              events.push({
                entity_id: String(boundParams[1]),
                type: 'email_dry_run',
                payload: String(boundParams[2]),
              });
            } else {
              events.push({
                entity_id: String(boundParams[2]),
                type: String(boundParams[3]),
                payload: String(boundParams[4]),
              });
            }
            return { meta: { changes: 1 }, changes: 1 };
          }
          return { meta: { changes: 1 }, changes: 1 };
        },
      };
      return stmt;
    },
    async batch(stmts: Array<{ run: () => Promise<unknown> }>) {
      for (const s of stmts) {
        await s.run();
      }
      return [];
    },
  };

  return {
    db,
    jobs,
    applications,
    resumes,
    companiesContacted,
    doNotContact,
    dailyCounters,
    events,
  };
}

describe('Google OAuth, Health & Gmail Sender Suite', () => {
  describe('WebCrypto AES-GCM Refresh Token Encryption', () => {
    it('encrypts and decrypts refresh token accurately using WebCrypto', async () => {
      const secretKey = 'my-super-secret-wrangler-passphrase';
      const originalToken = '1//04fake_refresh_token_xyz_123456789';

      const encrypted = await encryptRefreshToken(originalToken, secretKey);
      expect(typeof encrypted).toBe('string');
      expect(encrypted).not.toBe(originalToken);

      const decrypted = await decryptRefreshToken(encrypted, secretKey);
      expect(decrypted).toBe(originalToken);
    });

    it('fails to decrypt if secret key is incorrect', async () => {
      const secretKey = 'correct-key';
      const wrongKey = 'wrong-key';
      const encrypted = await encryptRefreshToken('secret-token', secretKey);

      await expect(decryptRefreshToken(encrypted, wrongKey)).rejects.toThrow();
    });
  });

  describe('MIME Message Builder & Header Injection Protection', () => {
    it('builds valid multipart MIME message with correct attachment headers and base64 payload', () => {
      const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // %PDF-1.4
      const mime = buildMimeMessage({
        fromEmail: 'alex@example.com',
        fromName: 'Alex Mercer',
        recipientEmail: 'jobs@stripe.com',
        subject: 'Application for Senior Systems Engineer',
        bodyText: 'Dear Stripe team,\n\nPlease find my resume attached.',
        messageIdHeader: '<12345@pigeon.local>',
        resumePdfBytes: pdfBytes,
        resumeFileName: 'Alex Mercer Resume.pdf',
      });

      expect(mime).toContain('From: "Alex Mercer" <alex@example.com>');
      expect(mime).toContain('To: jobs@stripe.com');
      expect(mime).toContain('Subject: Application for Senior Systems Engineer');
      expect(mime).toContain('Message-ID: <12345@pigeon.local>');
      expect(mime).toContain('Content-Type: multipart/mixed; boundary=');
      expect(mime).toContain('Content-Type: application/pdf; name="Alex_Mercer_Resume.pdf"');
      expect(mime).toContain('Content-Disposition: attachment; filename="Alex_Mercer_Resume.pdf"');
      expect(mime).toContain('JVBERi0xLjQ='); // Base64 of %PDF-1.4
    });

    it('rejects header injection containing CR or LF', () => {
      // 1. CRLF in Subject
      expect(() => {
        assertSafeHeader('Subject', 'Malicious Subject\r\nBcc: evil@attacker.com');
      }).toThrow('Header injection detected');

      // 2. LF in To
      expect(() => {
        assertSafeHeader('To', 'jobs@stripe.com\nCc: spam@attacker.com');
      }).toThrow('Header injection detected');

      // 3. buildMimeMessage rejects injection in subject
      expect(() => {
        buildMimeMessage({
          fromEmail: 'alex@example.com',
          recipientEmail: 'jobs@stripe.com',
          subject: 'Inject\r\nHeader: value',
          bodyText: 'Hello',
          messageIdHeader: '<id@pigeon.local>',
        });
      }).toThrow('Header injection detected');
    });

    it('encodes to base64url properly without padding', () => {
      const urlSafe = toBase64Url('Hello World?');
      expect(urlSafe).not.toContain('+');
      expect(urlSafe).not.toContain('/');
      expect(urlSafe).not.toContain('=');
    });
  });

  describe('Google OAuth & Health Monitoring', () => {
    it('generates correct Google Auth URL with required scopes', () => {
      const url = getGoogleAuthUrl({
        clientId: 'test-client-id',
        redirectUri: 'https://example.com/callback',
        state: 'random-state-123',
      });

      expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth?');
      expect(url).toContain('client_id=test-client-id');
      expect(url).toContain('redirect_uri=https%3A%2F%2Fexample.com%2Fcallback');
      expect(url).toContain('access_type=offline');
      expect(url).toContain('prompt=consent');
      expect(url).toContain('gmail.send');
      expect(url).toContain('gmail.readonly');
      expect(url).toContain('spreadsheets');
      expect(url).toContain('state=random-state-123');
    });

    it('completes auth callback: encrypts refresh token, caches access token, and sets health to ok', async () => {
      const config = createMockKV();
      const notifier = createMockNotifier();

      // Mock token exchange
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            access_token: 'new-access-token-123',
            refresh_token: 'new-refresh-token-456',
            expires_in: 3600,
            token_type: 'Bearer',
          }),
        }),
      );

      const result = await completeGoogleAuthCallback({
        code: 'auth-code-123',
        config,
        secrets: {
          clientId: 'client-id',
          clientSecret: 'client-secret',
          tokenEncryptionKey: 'secret-encryption-key-passphrase',
        },
        redirectUri: 'https://example.com/callback',
        notifier,
      });

      expect(result.success).toBe(true);
      expect(result.access_token).toBe('new-access-token-123');

      // Refresh token is stored encrypted
      const encryptedStored = await config.get(KV_KEYS.REFRESH_TOKEN_ENCRYPTED);
      expect(encryptedStored).not.toBeNull();
      if (!encryptedStored) throw new Error('Expected encrypted token to be stored');
      const decrypted = await decryptRefreshToken(
        encryptedStored,
        'secret-encryption-key-passphrase',
      );
      expect(decrypted).toBe('new-refresh-token-456');

      // Health is ok
      const health = await getGoogleAuthHealth(config);
      expect(health.status).toBe('ok');
    });

    it('invalid_grant sets health to invalid and notifies exactly once', async () => {
      const config = createMockKV();
      const notifier = createMockNotifier();

      // Store an encrypted refresh token
      const encrypted = await encryptRefreshToken('old-refresh-token', 'my-key');
      await config.put(KV_KEYS.REFRESH_TOKEN_ENCRYPTED, encrypted);

      // Mock fetch token returning invalid_grant
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 400,
          json: async () => ({
            error: 'invalid_grant',
            error_description: 'Token has been expired or revoked.',
          }),
        }),
      );

      // Attempt 1: fails and triggers notification
      await expect(
        getValidAccessToken({
          config,
          secrets: { clientId: 'cid', clientSecret: 'sec', tokenEncryptionKey: 'my-key' },
          notifier,
        }),
      ).rejects.toThrow();

      expect(notifier.notifications.length).toBe(1);
      expect(notifier.notifications[0]?.key).toBe('auth_invalid');

      const health = await getGoogleAuthHealth(config);
      expect(health.status).toBe('invalid');

      // Attempt 2: does NOT fire a second notification
      await expect(
        getValidAccessToken({
          config,
          secrets: { clientId: 'cid', clientSecret: 'sec', tokenEncryptionKey: 'my-key' },
          notifier,
        }),
      ).rejects.toThrow();

      expect(notifier.notifications.length).toBe(1); // Still exactly 1
    });

    it('pingGoogleAuthHealth refreshes on 401 and sets health to ok when valid', async () => {
      const config = createMockKV();
      const notifier = createMockNotifier();

      // Cache valid access token
      await config.put(KV_KEYS.ACCESS_TOKEN, 'access-token-abc');
      await config.put(KV_KEYS.ACCESS_TOKEN_EXPIRES_AT, String(Date.now() + 3600000));

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ emailAddress: 'alex@example.com' }),
        }),
      );

      const health = await pingGoogleAuthHealth({
        config,
        secrets: { clientId: 'cid', clientSecret: 'sec', tokenEncryptionKey: 'key' },
        notifier,
      });

      expect(health.status).toBe('ok');
    });
  });

  describe('Approval Workflows', () => {
    it('individual approve validates cover letter, enforces confirm_risk for needs_review, and transitions to approved', async () => {
      const { db, jobs, applications } = createMockDb();

      jobs.set('job-appr-1', {
        id: 'job-appr-1',
        title: 'Senior Systems Engineer',
        company: 'Stripe',
        company_normalized: 'stripe',
        apply_route: 'auto_email',
        contact_email: 'jobs@stripe.com',
        contact_source: 'posting',
      });

      applications.set('app-review', {
        id: 'app-review',
        job_id: 'job-appr-1',
        status: 'needs_review',
        channel: 'email',
        cover_letter: validCoverLetter,
        subject: 'Application for Senior Systems Engineer',
      });

      // 1. Without confirm_risk: throws error
      await expect(
        approveApplication({
          db,
          applicationId: 'app-review',
          profile: mockProfile,
          confirmRisk: false,
        }),
      ).rejects.toThrow('needs_review application requires confirm_risk=true');

      // 2. With confirm_risk: succeeds and transitions to approved
      const res = await approveApplication({
        db,
        applicationId: 'app-review',
        profile: mockProfile,
        confirmRisk: true,
      });

      expect(res.success).toBe(true);
      expect(applications.get('app-review')?.['status']).toBe('approved');
    });

    it('bulk approve rejects guessed email, freemail, manual_review routes, and needs_review status with explicit reasons', async () => {
      const { db, jobs, applications } = createMockDb();

      // Item 1: Valid auto_email + posting
      jobs.set('job-valid', {
        id: 'job-valid',
        title: 'Senior Systems Engineer',
        company: 'Stripe',
        apply_route: 'auto_email',
        contact_source: 'posting',
        contact_email: 'jobs@stripe.com',
        match_score: 85,
        red_flags: '[]',
        untrusted: false,
      });
      applications.set('app-valid', {
        id: 'app-valid',
        job_id: 'job-valid',
        status: 'draft',
        channel: 'email',
        cover_letter: validCoverLetter,
        subject: 'Application',
      });

      // Item 2: Guessed email
      jobs.set('job-guessed', {
        id: 'job-guessed',
        title: 'Senior Systems Engineer',
        company: 'Stripe',
        apply_route: 'auto_email',
        contact_source: 'guessed',
        contact_email: 'careers@stripe.com',
        route_reason: 'GUESSED_EMAIL',
      });
      applications.set('app-guessed', {
        id: 'app-guessed',
        job_id: 'job-guessed',
        status: 'draft',
        channel: 'email',
        cover_letter: validCoverLetter,
      });

      // Item 3: Freemail contact
      jobs.set('job-freemail', {
        id: 'job-freemail',
        title: 'Senior Systems Engineer',
        company: 'Stripe',
        apply_route: 'auto_email',
        contact_source: 'posting',
        contact_email: 'recruiter123@gmail.com',
        route_reason: 'FREEMAIL_CONTACT',
      });
      applications.set('app-freemail', {
        id: 'app-freemail',
        job_id: 'job-freemail',
        status: 'draft',
        channel: 'email',
        cover_letter: validCoverLetter,
      });

      // Item 4: Route manual_review
      jobs.set('job-manual-route', {
        id: 'job-manual-route',
        title: 'Senior Systems Engineer',
        company: 'Stripe',
        apply_route: 'manual_review',
        contact_source: 'posting',
        contact_email: 'jobs@stripe.com',
      });
      applications.set('app-manual-route', {
        id: 'app-manual-route',
        job_id: 'job-manual-route',
        status: 'draft',
        channel: 'email',
        cover_letter: validCoverLetter,
      });

      // Item 5: Status needs_review
      jobs.set('job-needs-review', {
        id: 'job-needs-review',
        title: 'Senior Systems Engineer',
        company: 'Stripe',
        apply_route: 'auto_email',
        contact_source: 'posting',
        contact_email: 'jobs@stripe.com',
      });
      applications.set('app-needs-review', {
        id: 'app-needs-review',
        job_id: 'job-needs-review',
        status: 'needs_review',
        channel: 'email',
        cover_letter: validCoverLetter,
      });

      const result = await bulkApproveApplications({
        db,
        ids: ['app-valid', 'app-guessed', 'app-freemail', 'app-manual-route', 'app-needs-review'],
        profile: mockProfile,
      });

      expect(result.approved).toEqual(['app-valid']);
      expect(result.rejected.find((r) => r.id === 'app-guessed')?.reason).toContain(
        'Guessed email contacts cannot be bulk-approved',
      );
      expect(result.rejected.find((r) => r.id === 'app-freemail')?.reason).toContain(
        'Freemail contacts cannot be bulk-approved',
      );
      expect(result.rejected.find((r) => r.id === 'app-manual-route')?.reason).toContain(
        'Route manual_review cannot be bulk-approved',
      );
      expect(result.rejected.find((r) => r.id === 'app-needs-review')?.reason).toContain(
        'needs_review items cannot be bulk-approved',
      );
    });

    it('auto-approve checks: blocked during the first 14 days after first send, ignores guessed/freemail/manual routes', async () => {
      const { db, applications } = createMockDb();
      const nowMs = Date.now();

      // Case 1: No real sends yet -> blocked
      const resNoSends = await checkAutoApprove({
        db,
        profile: mockProfile,
        matchScore: 92,
        applyRoute: 'auto_email',
        contactSource: 'posting',
        contactEmail: 'hr@corp.com',
        company: 'Corp',
        nowMs,
      });
      expect(resNoSends.can_auto_approve).toBe(false);
      expect(resNoSends.reason).toContain('first_14_days');

      // Case 2: First send was only 5 days ago (< 14 days) -> blocked
      applications.set('prior-send', {
        id: 'prior-send',
        status: 'sent',
        sent_at: new Date(nowMs - 5 * 24 * 60 * 60 * 1000).toISOString(),
      });

      const resRecent = await checkAutoApprove({
        db,
        profile: mockProfile,
        matchScore: 92,
        applyRoute: 'auto_email',
        contactSource: 'posting',
        contactEmail: 'hr@corp.com',
        company: 'Corp',
        nowMs,
      });
      expect(resRecent.can_auto_approve).toBe(false);
      expect(resRecent.reason).toContain('first_14_days');

      // Case 3: First send was 15 days ago (> 14 days) -> eligible!
      applications.set('prior-send', {
        id: 'prior-send',
        status: 'sent',
        sent_at: new Date(nowMs - 15 * 24 * 60 * 60 * 1000).toISOString(),
      });

      const resEligible = await checkAutoApprove({
        db,
        profile: mockProfile,
        matchScore: 92,
        applyRoute: 'auto_email',
        contactSource: 'posting',
        contactEmail: 'hr@corp.com',
        company: 'Corp',
        nowMs,
      });
      expect(resEligible.can_auto_approve).toBe(true);

      // Case 4: Eligible 14-day history but guessed contact -> rejected
      const resGuessed = await checkAutoApprove({
        db,
        profile: mockProfile,
        matchScore: 92,
        applyRoute: 'auto_email',
        contactSource: 'guessed',
        contactEmail: 'careers@corp.com',
        company: 'Corp',
        nowMs,
      });
      expect(resGuessed.can_auto_approve).toBe(false);
    });
  });

  describe('Rate Limiting, Cap Formula & Bounce Brake', () => {
    it('cap formula: day 0 gives 5, day 3 gives 11, day 8 gives 20', async () => {
      const { db, applications } = createMockDb();
      const nowMs = 1700000000000;
      const oneDayMs = 24 * 60 * 60 * 1000;

      // Day 0 (no prior sends or send was today): base 5 + 2 * 0 = 5
      const cap0 = await calculateEffectiveCap({ db, profile: mockProfile, nowMs });
      expect(cap0).toBe(5);

      // Day 3 (first send 3 days ago): min(20, 5 + 2 * 3) = 11
      applications.set('app-send-1', {
        id: 'app-send-1',
        status: 'sent',
        sent_at: new Date(nowMs - 3 * oneDayMs).toISOString(),
      });
      const cap3 = await calculateEffectiveCap({ db, profile: mockProfile, nowMs });
      expect(cap3).toBe(11);

      // Day 8 (first send 8 days ago): min(20, 5 + 2 * 8 = 21) = 20
      applications.set('app-send-1', {
        id: 'app-send-1',
        status: 'sent',
        sent_at: new Date(nowMs - 8 * oneDayMs).toISOString(),
      });
      const cap8 = await calculateEffectiveCap({ db, profile: mockProfile, nowMs });
      expect(cap8).toBe(20);
    });

    it('bounce brake halves the cap after 3 bounces in the last 20 sends (never below 3) and notifies once', async () => {
      const { db, applications } = createMockDb();
      const config = createMockKV();
      const notifier = createMockNotifier();

      // Add 20 recent sends, with 3 bounced (15% > 10%)
      for (let i = 0; i < 20; i++) {
        applications.set(`app-s-${i}`, {
          id: `app-s-${i}`,
          status: i < 3 ? 'bounced' : 'sent',
          sent_at: new Date(Date.now() - i * 100000).toISOString(),
        });
      }

      // Base cap is 20 -> should halve to 10
      const res = await applyBounceBrake({
        db,
        config,
        baseCap: 20,
        notifier,
      });

      expect(res.brakeActive).toBe(true);
      expect(res.effectiveCap).toBe(10);
      expect(notifier.notifications.length).toBe(1);
      expect(notifier.notifications[0]?.key).toBe('bounce_brake_active');

      // Second check: does not re-notify
      await applyBounceBrake({
        db,
        config,
        baseCap: 20,
        notifier,
      });
      expect(notifier.notifications.length).toBe(1);

      // Low cap (e.g. 5) never drops below 3
      const resLow = await applyBounceBrake({
        db,
        config,
        baseCap: 5,
        notifier,
      });
      expect(resLow.effectiveCap).toBe(3);
    });

    it('atomic conditional update on daily_counters prevents exceeding cap across concurrent workers', async () => {
      const { db } = createMockDb();
      const dateStr = '2026-11-05';
      const effectiveCap = 3;

      // 3 calls succeed
      const slot1 = await acquireSendSlot(db, dateStr, effectiveCap);
      const slot2 = await acquireSendSlot(db, dateStr, effectiveCap);
      const slot3 = await acquireSendSlot(db, dateStr, effectiveCap);

      expect(slot1).toBe(true);
      expect(slot2).toBe(true);
      expect(slot3).toBe(true);

      // 4th call is rejected atomically
      const slot4 = await acquireSendSlot(db, dateStr, effectiveCap);
      expect(slot4).toBe(false);
    });

    it('outside send window and on weekends nothing is sent and item is rescheduled', () => {
      // 1. Weekend test (Sunday)
      // 2026-11-08 is a Sunday
      const sundayMs = new Date('2026-11-08T10:00:00Z').getTime();
      const sundayCheck = isInsideSendWindow({ profile: mockProfile, nowMs: sundayMs });
      expect(sundayCheck.inside).toBe(false);
      expect(sundayCheck.reason).toBe('weekend');

      // 2. Outside hours (03:00 UTC = 08:30 IST < 09:00 IST)
      const earlyMorningMs = new Date('2026-11-04T03:00:00Z').getTime(); // Wednesday 08:30 IST
      const earlyCheck = isInsideSendWindow({ profile: mockProfile, nowMs: earlyMorningMs });
      expect(earlyCheck.inside).toBe(false);
      expect(earlyCheck.reason).toBe('outside_hours');

      // 3. Inside window (06:00 UTC = 11:30 IST, Wednesday)
      const workingHourMs = new Date('2026-11-04T06:00:00Z').getTime();
      const okCheck = isInsideSendWindow({ profile: mockProfile, nowMs: workingHourMs });
      expect(okCheck.inside).toBe(true);
    });
  });

  describe('Table-driven sendApplicationEmail gate verification (11 Gates)', () => {
    interface GateTestCase {
      name: string;
      setup: (ctx: {
        app: ApplicationToSend;
        options: {
          dryRun: boolean;
          killSwitch: boolean;
          nowMs: number;
        };
        db: D1LikeDatabase;
        config: KVLike;
        applications: Map<string, Record<string, unknown>>;
        resumes: Map<string, Record<string, unknown>>;
        companiesContacted: Map<string, Record<string, unknown>>;
        doNotContact: Set<string>;
        dailyCounters: Map<string, { sends: number; bounces: number }>;
        resumesBucket: { get: (key: string) => Promise<{ arrayBuffer: () => Promise<ArrayBuffer> } | null> };
      }) => void | Promise<void>;
      expected: {
        success: boolean;
        rescheduled?: boolean;
        dryRun?: boolean;
        errorContains?: string;
        finalStatus: 'approved' | 'failed' | 'draft';
        expectedTransitions?: Array<{ from: string; to: string; reasonMatch?: RegExp | string }>;
      };
      extraAssertions?: (ctx: {
        events: Array<{ entity_id: string; type: string; payload: string }>;
        dailyCounters: Map<string, { sends: number; bounces: number }>;
      }) => void;
    }

    const gateCases: GateTestCase[] = [
      {
        name: 'Gate 1: status not approved (draft) -> rejected, no transition, remains draft',
        setup: ({ app, applications }) => {
          app.status = 'draft';
          applications.set(app.id, { id: app.id, status: 'draft' });
        },
        expected: {
          success: false,
          errorContains: "Application status is 'draft', not approved",
          finalStatus: 'draft',
          expectedTransitions: [],
        },
      },
      {
        name: 'Gate 2a: effective DRY_RUN (via parameter) -> sends nothing, claims no cap, writes email_dry_run event',
        setup: ({ options }) => {
          options.dryRun = true;
        },
        expected: {
          success: true,
          dryRun: true,
          finalStatus: 'approved',
          expectedTransitions: [],
        },
        extraAssertions: ({ events, dailyCounters }) => {
          const dryEvents = events.filter((e) => e.type === 'email_dry_run');
          expect(dryEvents.length).toBe(1);
          expect(dailyCounters.size).toBe(0); // claims no cap slot
        },
      },
      {
        name: 'Gate 2b: effective DRY_RUN (via KV override) -> sends nothing, claims no cap, status unchanged',
        setup: async ({ options, config }) => {
          options.dryRun = false;
          await config.put('dry_run', 'true');
        },
        expected: {
          success: true,
          dryRun: true,
          finalStatus: 'approved',
          expectedTransitions: [],
        },
        extraAssertions: ({ events, dailyCounters }) => {
          const dryEvents = events.filter((e) => e.type === 'email_dry_run');
          expect(dryEvents.length).toBe(1);
          expect(dailyCounters.size).toBe(0);
        },
      },
      {
        name: 'Gate 3a: kill switch (via parameter) -> paused, remains approved',
        setup: ({ options }) => {
          options.killSwitch = true;
        },
        expected: {
          success: false,
          errorContains: 'Kill switch is active',
          finalStatus: 'approved',
          expectedTransitions: [],
        },
      },
      {
        name: 'Gate 3b: kill switch (via KV override) -> paused, remains approved',
        setup: async ({ options, config }) => {
          options.killSwitch = false;
          await config.put('kill_switch', 'true');
        },
        expected: {
          success: false,
          errorContains: 'Kill switch is active',
          finalStatus: 'approved',
          expectedTransitions: [],
        },
      },
      {
        name: 'Gate 4a: auth health not ok (invalid status) -> paused, remains approved',
        setup: async ({ config }) => {
          await setGoogleAuthHealth({ config, status: 'invalid', reason: 'Token revoked by user' });
        },
        expected: {
          success: false,
          errorContains: 'Google auth health is invalid',
          finalStatus: 'approved',
          expectedTransitions: [],
        },
      },
      {
        name: 'Gate 4b: auth health not ok (missing in KV) -> fail closed, remains approved',
        setup: async ({ config }) => {
          await config.delete(KV_KEYS.AUTH_HEALTH);
        },
        expected: {
          success: false,
          errorContains: 'Google auth health is invalid',
          finalStatus: 'approved',
          expectedTransitions: [],
        },
      },
      {
        name: 'Gate 5a: do_not_contact (address match) -> legally transitions approved -> sending -> failed',
        setup: ({ doNotContact, app }) => {
          if (app.contact_email) {
            doNotContact.add(app.contact_email.toLowerCase());
          }
        },
        expected: {
          success: false,
          errorContains: 'on do_not_contact list',
          finalStatus: 'failed',
          expectedTransitions: [
            { from: 'approved', to: 'sending' },
            { from: 'sending', to: 'failed', reasonMatch: /on do_not_contact list/ },
          ],
        },
      },
      {
        name: 'Gate 5b: do_not_contact (domain match) -> legally transitions approved -> sending -> failed',
        setup: ({ doNotContact }) => {
          doNotContact.add('stripe.com');
        },
        expected: {
          success: false,
          errorContains: 'on do_not_contact list',
          finalStatus: 'failed',
          expectedTransitions: [
            { from: 'approved', to: 'sending' },
            { from: 'sending', to: 'failed', reasonMatch: /on do_not_contact list/ },
          ],
        },
      },
      {
        name: 'Gate 6: company contacted within 90 days -> legally transitions approved -> sending -> failed',
        setup: ({ companiesContacted, options }) => {
          const fifteenDaysAgo = new Date(options.nowMs - 15 * 24 * 60 * 60 * 1000).toISOString();
          companiesContacted.set('stripe', {
            company_normalized: 'stripe',
            last_contacted_at: fifteenDaysAgo,
          });
        },
        expected: {
          success: false,
          errorContains: 'recently contacted',
          finalStatus: 'failed',
          expectedTransitions: [
            { from: 'approved', to: 'sending' },
            { from: 'sending', to: 'failed', reasonMatch: /recently contacted/ },
          ],
        },
      },
      {
        name: 'Gate 7: daily cap reached on daily_counters table -> rescheduled, claims no slot, remains approved',
        setup: ({ dailyCounters }) => {
          // With no previous sends, ramp formula gives effective cap 5
          dailyCounters.set('2026-11-04', { sends: 5, bounces: 0 });
        },
        expected: {
          success: false,
          rescheduled: true,
          errorContains: 'Daily send cap of 5 reached',
          finalStatus: 'approved',
          expectedTransitions: [],
        },
        extraAssertions: ({ dailyCounters }) => {
          expect(dailyCounters.get('2026-11-04')?.sends).toBe(5); // no extra slot claimed
        },
      },
      {
        name: 'Gate 8a: outside send window (after hours) -> rescheduled, remains approved',
        setup: ({ options }) => {
          // Wednesday 16:00 UTC = 21:30 IST (> 18:00 IST)
          options.nowMs = new Date('2026-11-04T16:00:00Z').getTime();
        },
        expected: {
          success: false,
          rescheduled: true,
          errorContains: 'outside allowed send window',
          finalStatus: 'approved',
          expectedTransitions: [],
        },
      },
      {
        name: 'Gate 8b: outside send window (weekend Sunday) -> rescheduled, remains approved',
        setup: ({ options }) => {
          // Sunday 2026-11-08 06:00 UTC = 11:30 IST
          options.nowMs = new Date('2026-11-08T06:00:00Z').getTime();
        },
        expected: {
          success: false,
          rescheduled: true,
          errorContains: 'outside allowed send window (weekend)',
          finalStatus: 'approved',
          expectedTransitions: [],
        },
      },
      {
        name: 'Gate 9: letter no longer validates (placeholder detected) -> legally transitions approved -> sending -> failed',
        setup: ({ app }) => {
          app.cover_letter =
            'Dear Hiring Team, I am writing to express my deep interest in the [Company] role. Alex Mercer';
        },
        expected: {
          success: false,
          errorContains: 'Cover letter validation failed',
          finalStatus: 'failed',
          expectedTransitions: [
            { from: 'approved', to: 'sending' },
            { from: 'sending', to: 'failed', reasonMatch: /Cover letter validation failed/ },
          ],
        },
      },
      {
        name: 'Gate 10: resume missing in R2 -> legally transitions approved -> sending -> failed',
        setup: ({ resumesBucket }) => {
          resumesBucket.get = async () => null;
        },
        expected: {
          success: false,
          errorContains: 'not found in R2 storage',
          finalStatus: 'failed',
          expectedTransitions: [
            { from: 'approved', to: 'sending' },
            { from: 'sending', to: 'failed', reasonMatch: /not found in R2 storage/ },
          ],
        },
      },
      {
        name: 'Gate 11a: CR in subject (header injection) -> legally transitions approved -> sending -> failed',
        setup: ({ app }) => {
          app.subject = 'Application for Senior Systems Engineer\rBcc: evil@attacker.com';
        },
        expected: {
          success: false,
          errorContains: 'carriage return',
          finalStatus: 'failed',
          expectedTransitions: [
            { from: 'approved', to: 'sending' },
            { from: 'sending', to: 'failed', reasonMatch: /carriage return/i },
          ],
        },
      },
      {
        name: 'Gate 11b: LF in contact_email (header injection) -> legally transitions approved -> sending -> failed',
        setup: ({ app }) => {
          app.contact_email = 'jobs@stripe.com\nCc: evil@attacker.com';
        },
        expected: {
          success: false,
          errorContains: 'Invalid contact email',
          finalStatus: 'failed',
          expectedTransitions: [
            { from: 'approved', to: 'sending' },
            { from: 'sending', to: 'failed', reasonMatch: /Invalid contact email/ },
          ],
        },
      },
    ];

    for (const testCase of gateCases) {
      it(testCase.name, async () => {
        const {
          db,
          applications,
          resumes,
          companiesContacted,
          doNotContact,
          dailyCounters,
          events,
        } = createMockDb();

        const config = createMockKV();
        await setGoogleAuthHealth({ config, status: 'ok' });

        resumes.set('res-valid', {
          id: 'res-valid',
          r2_key: 'resumes/valid.pdf',
          label: 'Valid Resume',
        });

        const app: ApplicationToSend = {
          ...targetApp,
          id: 'app-gate-test',
          status: 'approved',
        };
        applications.set(app.id, {
          id: app.id,
          status: 'approved',
          cover_letter: app.cover_letter,
          subject: app.subject,
        });

        const resumesBucket = {
          async get(_key: string) {
            return {
              async arrayBuffer() {
                return new Uint8Array([1, 2, 3]).buffer;
              },
            };
          },
        };

        const sentParams: SendEmailParams[] = [];
        const sender: GmailSender = {
          async send(p: SendEmailParams) {
            sentParams.push(p);
            return { gmailMessageId: 'g-msg-ok', gmailThreadId: 'g-th-ok' };
          },
          async searchSentByMessageId() {
            return null;
          },
        };

        const options = {
          dryRun: false,
          killSwitch: false,
          nowMs: new Date('2026-11-04T06:00:00Z').getTime(), // Wednesday 11:30 IST
        };

        // Run case-specific setup to break only that single gate
        await testCase.setup({
          app,
          options,
          db,
          config,
          applications,
          resumes,
          companiesContacted,
          doNotContact,
          dailyCounters,
          resumesBucket,
        });

        // Execute sendApplicationEmail
        const res = await sendApplicationEmail({
          db,
          config,
          resumesBucket,
          gmailSender: sender,
          profile: mockProfile,
          dryRun: options.dryRun,
          killSwitch: options.killSwitch,
          nowMs: options.nowMs,
          application: app,
        });

        // 1. Assert NO Gmail call was made
        expect(sentParams.length).toBe(0);

        // 2. Assert nothing is marked sent in DB
        const appRow = applications.get(app.id);
        expect(appRow?.['sent_at']).toBeUndefined();

        // 3. Assert return result matches expectation
        expect(res.success).toBe(testCase.expected.success);
        if (testCase.expected.rescheduled !== undefined) {
          expect(res.rescheduled).toBe(testCase.expected.rescheduled);
        }
        if (testCase.expected.dryRun !== undefined) {
          expect(res.dryRun).toBe(testCase.expected.dryRun);
        }
        if (testCase.expected.errorContains) {
          expect(res.error).toBeDefined();
          expect(res.error).toContain(testCase.expected.errorContains);
        }

        // 4. Assert final status in DB
        expect(appRow?.['status']).toBe(testCase.expected.finalStatus);

        // 5. Assert transitions
        if (testCase.expected.expectedTransitions) {
          const statusEvents = events.filter(
            (e) => e.entity_id === app.id && e.type === 'status_change',
          );
          expect(statusEvents.length).toBe(testCase.expected.expectedTransitions.length);

          testCase.expected.expectedTransitions.forEach((expectedTr, idx) => {
            const ev = statusEvents[idx];
            expect(ev).toBeDefined();
            const payload = JSON.parse(ev?.payload ?? '{}');
            expect(payload.from).toBe(expectedTr.from);
            expect(payload.to).toBe(expectedTr.to);
            if (expectedTr.reasonMatch) {
              if (typeof expectedTr.reasonMatch === 'string') {
                expect(payload.reason).toContain(expectedTr.reasonMatch);
              } else {
                expect(payload.reason).toMatch(expectedTr.reasonMatch);
              }
            }
          });
        }

        // 6. Extra assertions if provided
        if (testCase.extraAssertions) {
          testCase.extraAssertions({ events, dailyCounters });
        }
      });
    }

    it('baseline test: fully valid approved application passes all gates, calls Gmail, transitions to sent', async () => {
      const { db, applications, resumes, events, dailyCounters } = createMockDb();
      const config = createMockKV();
      await setGoogleAuthHealth({ config, status: 'ok' });

      resumes.set('res-valid', {
        id: 'res-valid',
        r2_key: 'resumes/valid.pdf',
        label: 'Valid Resume',
      });

      const app: ApplicationToSend = {
        ...targetApp,
        id: 'app-baseline-ok',
        status: 'approved',
      };
      applications.set(app.id, {
        id: app.id,
        status: 'approved',
        cover_letter: app.cover_letter,
        subject: app.subject,
      });

      const resumesBucket = {
        async get(_key: string) {
          return {
            async arrayBuffer() {
              return new Uint8Array([1, 2, 3]).buffer;
            },
          };
        },
      };

      const sentParams: SendEmailParams[] = [];
      const sender: GmailSender = {
        async send(p: SendEmailParams) {
          sentParams.push(p);
          return { gmailMessageId: 'g-msg-ok-123', gmailThreadId: 'g-th-ok-123' };
        },
        async searchSentByMessageId() {
          return null;
        },
      };

      const res = await sendApplicationEmail({
        db,
        config,
        resumesBucket,
        gmailSender: sender,
        profile: mockProfile,
        dryRun: false,
        killSwitch: false,
        nowMs: new Date('2026-11-04T06:00:00Z').getTime(), // Wednesday 11:30 IST
        application: app,
      });

      expect(res.success).toBe(true);
      expect(sentParams.length).toBe(1);
      expect(sentParams[0]?.recipientEmail).toBe('jobs@stripe.com');

      const appRow = applications.get(app.id);
      expect(appRow?.['status']).toBe('sent');
      expect(appRow?.['sent_at']).toBeDefined();
      expect(appRow?.['gmail_message_id']).toBe('g-msg-ok-123');

      // Check transitions: approved -> sending -> sent
      const statusEvents = events.filter(
        (e) => e.entity_id === app.id && e.type === 'status_change',
      );
      expect(statusEvents.length).toBe(2);
      const ev0 = statusEvents[0];
      const ev1 = statusEvents[1];
      expect(ev0).toBeDefined();
      expect(ev1).toBeDefined();
      expect(JSON.parse(ev0?.payload ?? '{}').to).toBe('sending');
      expect(JSON.parse(ev1?.payload ?? '{}').to).toBe('sent');

      // Cap slot was acquired
      expect(dailyCounters.get('2026-11-04')?.sends).toBe(1);
    });
  });

  describe('Send Worker Pipeline, Safety Gates, Idempotency & Error Handling', () => {
    let mockSender: GmailSender;
    let sentEmails: SendEmailParams[];

    beforeEach(() => {
      sentEmails = [];
      mockSender = {
        async send(params: SendEmailParams): Promise<SendEmailResult> {
          sentEmails.push(params);
          return { gmailMessageId: 'g-msg-1', gmailThreadId: 'g-th-1' };
        },
        async searchSentByMessageId() {
          return null;
        },
      };
    });

    const dummyR2: R2LikeBucket = {
      async get(key: string) {
        if (key.includes('missing')) return null;
        return {
          async arrayBuffer() {
            return new Uint8Array([1, 2, 3]).buffer;
          },
        };
      },
    };

    it('unapproved application is never sent; DRY_RUN=true, kill switch, and auth health invalid independently block sending', async () => {
      const { db, resumes, applications } = createMockDb();
      applications.set('app-target', { id: 'app-target', status: 'approved' });
      const config = createMockKV();
      resumes.set('res-valid', {
        id: 'res-valid',
        r2_key: 'resumes/valid.pdf',
        label: 'Valid Resume',
      });

      // Working Wednesday 11:30 IST
      const sendTimeMs = new Date('2026-11-04T06:00:00Z').getTime();

      // 1. Auth health invalid blocks sending
      await setGoogleAuthHealth({ config, status: 'invalid', reason: 'revoked' });
      const authBlock = await sendApplicationEmail({
        db,
        config,
        resumesBucket: dummyR2,
        gmailSender: mockSender,
        profile: mockProfile,
        dryRun: false,
        killSwitch: false,
        nowMs: sendTimeMs,
        application: targetApp,
      });
      expect(authBlock.success).toBe(false);
      expect(authBlock.error).toContain('Google auth health is invalid');
      expect(sentEmails.length).toBe(0);

      // Restore health
      await setGoogleAuthHealth({ config, status: 'ok' });

      // 2. Kill switch active blocks sending
      const killBlock = await sendApplicationEmail({
        db,
        config,
        resumesBucket: dummyR2,
        gmailSender: mockSender,
        profile: mockProfile,
        dryRun: false,
        killSwitch: true,
        nowMs: sendTimeMs,
        application: targetApp,
      });
      expect(killBlock.success).toBe(false);
      expect(killBlock.error).toContain('Kill switch is active');
      expect(sentEmails.length).toBe(0);

      // 3. DRY_RUN=true: writes would-be email to events, sends nothing via Gmail, and marks nothing as sent
      const dryRes = await sendApplicationEmail({
        db,
        config,
        resumesBucket: dummyR2,
        gmailSender: mockSender,
        profile: mockProfile,
        dryRun: true,
        killSwitch: false,
        nowMs: sendTimeMs,
        application: targetApp,
      });
      expect(dryRes.success).toBe(true);
      expect(dryRes.dryRun).toBe(true);
      expect(sentEmails.length).toBe(0); // Nothing sent to Gmail API

      // 4. Unapproved application (status draft) is rejected by pre-send validation
      applications.set('app-draft', { id: 'app-draft', status: 'draft' });
      const draftApp: ApplicationToSend = { ...targetApp, id: 'app-draft', status: 'draft' };
      const draftRes = await sendApplicationEmail({
        db,
        config,
        resumesBucket: dummyR2,
        gmailSender: mockSender,
        profile: mockProfile,
        dryRun: false,
        killSwitch: false,
        nowMs: sendTimeMs,
        application: draftApp,
      });
      expect(draftRes.success).toBe(false);
      expect(draftRes.error).toContain("Application status is 'draft', not approved");
      expect(sentEmails.length).toBe(0);
    });

    it('crash after Gmail call before DB write: retry finds message by Message-ID and does not resend', async () => {
      const { db, resumes, applications } = createMockDb();
      const config = createMockKV();
      await setGoogleAuthHealth({ config, status: 'ok' });
      resumes.set('res-valid', {
        id: 'res-valid',
        r2_key: 'resumes/valid.pdf',
        label: 'Valid Resume',
      });

      const sendTimeMs = new Date('2026-11-04T06:00:00Z').getTime();

      // App crashed while in status 'sending' with a message_id_header stored
      const msgId = '<crash-test-id@pigeon.local>';
      applications.set('app-crashed', {
        id: 'app-crashed',
        status: 'sending',
        message_id_header: msgId,
        gmail_message_id: null,
      });

      const crashedApp: ApplicationToSend = {
        ...targetApp,
        id: 'app-crashed',
        status: 'sending',
        message_id_header: msgId,
      };

      // Gmail Sent search mock returns the message sent before the crash
      const senderWithSearch: GmailSender = {
        async send(params: SendEmailParams) {
          sentEmails.push(params);
          return { gmailMessageId: 'g-msg-new', gmailThreadId: 'g-th-new' };
        },
        async searchSentByMessageId(header: string) {
          if (header.includes('crash-test-id')) {
            return { gmailMessageId: 'g-msg-recovered', gmailThreadId: 'g-th-recovered' };
          }
          return null;
        },
      };

      const retryRes = await sendApplicationEmail({
        db,
        config,
        resumesBucket: dummyR2,
        gmailSender: senderWithSearch,
        profile: mockProfile,
        dryRun: false,
        killSwitch: false,
        nowMs: sendTimeMs,
        application: crashedApp,
      });

      expect(retryRes.success).toBe(true);
      expect(sentEmails.length).toBe(0); // Did NOT resend!
      expect(applications.get('app-crashed')?.['status']).toBe('sent');
      expect(applications.get('app-crashed')?.['gmail_message_id']).toBe('g-msg-recovered');
    });

    it('handles 429/5xx backoff and retries up to 3 times before failing; permanent 4xx fails without retry', async () => {
      const { db, resumes, applications } = createMockDb();
      const config = createMockKV();
      await setGoogleAuthHealth({ config, status: 'ok' });
      resumes.set('res-valid', {
        id: 'res-valid',
        r2_key: 'resumes/valid.pdf',
        label: 'Valid Resume',
      });
      applications.set('app-target', { id: 'app-target', status: 'approved' });

      const sendTimeMs = new Date('2026-11-04T06:00:00Z').getTime();

      // 1. Rate limit error (429) backoff: reverts to approved with incremented retry_count
      const rateLimitSender: GmailSender = {
        async send() {
          throw new GoogleRateLimitError('Rate limit hit');
        },
        async searchSentByMessageId() {
          return null;
        },
      };

      const res429 = await sendApplicationEmail({
        db,
        config,
        resumesBucket: dummyR2,
        gmailSender: rateLimitSender,
        profile: mockProfile,
        dryRun: false,
        nowMs: sendTimeMs,
        application: { ...targetApp, retry_count: 0 },
      });

      expect(res429.success).toBe(false);
      expect(applications.get('app-target')?.['status']).toBe('approved'); // Retryable

      // Max retries (3) reached: fails
      const resMaxRetry = await sendApplicationEmail({
        db,
        config,
        resumesBucket: dummyR2,
        gmailSender: rateLimitSender,
        profile: mockProfile,
        dryRun: false,
        nowMs: sendTimeMs,
        application: { ...targetApp, retry_count: 2 },
      });
      expect(resMaxRetry.success).toBe(false);
      expect(applications.get('app-target')?.['status']).toBe('failed');

      // 2. Permanent 4xx recipient error fails immediately without retry
      const recipientErrorSender: GmailSender = {
        async send() {
          throw new GoogleRecipientError(400, 'Invalid To recipient address');
        },
        async searchSentByMessageId() {
          return null;
        },
      };

      applications.set('app-perm-fail', { id: 'app-perm-fail', status: 'approved' });
      const res4xx = await sendApplicationEmail({
        db,
        config,
        resumesBucket: dummyR2,
        gmailSender: recipientErrorSender,
        profile: mockProfile,
        dryRun: false,
        nowMs: sendTimeMs,
        application: { ...targetApp, id: 'app-perm-fail', retry_count: 0 },
      });

      expect(res4xx.success).toBe(false);
      expect(applications.get('app-perm-fail')?.['status']).toBe('failed');
    });

    it('DRY_RUN claims no cap slot, changes no status, and writes exactly one email_dry_run event row', async () => {
      const { db, resumes, applications, events, dailyCounters } = createMockDb();
      const config = createMockKV();
      await setGoogleAuthHealth({ config, status: 'ok' });
      resumes.set('res-valid', {
        id: 'res-valid',
        r2_key: 'resumes/valid.pdf',
        label: 'Valid Resume',
      });
      applications.set('app-dry', { id: 'app-dry', status: 'approved' });

      const sendTimeMs = new Date('2026-11-04T06:00:00Z').getTime();
      let emailSent = false;
      const dummySender: GmailSender = {
        async send() {
          emailSent = true;
          return { gmailMessageId: 'g-msg-1', gmailThreadId: 'g-th-1' };
        },
        async searchSentByMessageId() {
          return null;
        },
      };

      const res = await sendApplicationEmail({
        db,
        config,
        resumesBucket: dummyR2,
        gmailSender: dummySender,
        profile: mockProfile,
        dryRun: true,
        killSwitch: false,
        nowMs: sendTimeMs,
        application: { ...targetApp, id: 'app-dry' },
      });

      expect(res.success).toBe(true);
      expect(res.dryRun).toBe(true);
      expect(emailSent).toBe(false);

      // Status remains approved (no status transition)
      expect(applications.get('app-dry')?.['status']).toBe('approved');

      // daily_counters is untouched
      expect(dailyCounters.size).toBe(0);

      // Writes exactly one email_dry_run event
      const appEvents = events.filter((e) => e.entity_id === 'app-dry');
      expect(appEvents.length).toBe(1);
      expect(appEvents[0]?.type).toBe('email_dry_run');
    });

    it('retrying after 429/5xx transitions sending -> approved with reason retry and writes exactly one event row', async () => {
      const { db, resumes, applications, events } = createMockDb();
      const config = createMockKV();
      await setGoogleAuthHealth({ config, status: 'ok' });
      resumes.set('res-valid', {
        id: 'res-valid',
        r2_key: 'resumes/valid.pdf',
        label: 'Valid Resume',
      });
      applications.set('app-retry', { id: 'app-retry', status: 'approved' });

      const sendTimeMs = new Date('2026-11-04T06:00:00Z').getTime();
      const rateLimitSender: GmailSender = {
        async send() {
          throw new GoogleRateLimitError('Rate limit hit');
        },
        async searchSentByMessageId() {
          return null;
        },
      };

      const res = await sendApplicationEmail({
        db,
        config,
        resumesBucket: dummyR2,
        gmailSender: rateLimitSender,
        profile: mockProfile,
        dryRun: false,
        nowMs: sendTimeMs,
        application: { ...targetApp, id: 'app-retry', retry_count: 0 },
      });

      expect(res.success).toBe(false);
      expect(applications.get('app-retry')?.['status']).toBe('approved');

      // Transitions: approved -> sending, then sending -> approved
      const retryEvents = events.filter(
        (e) => e.entity_id === 'app-retry' && e.type === 'status_change',
      );
      expect(retryEvents.length).toBe(2);
      const secondEvent = retryEvents[1];
      expect(secondEvent).toBeDefined();
      const lastEventPayload = JSON.parse(secondEvent?.payload ?? '{}');
      expect(lastEventPayload.from).toBe('sending');
      expect(lastEventPayload.to).toBe('approved');
      expect(lastEventPayload.reason).toBe('retry');
    });
  });

  describe('Security Audits: getTokenKey Helper', () => {
    it('throws if GOOGLE_TOKEN_ENCRYPTION_KEY is missing or shorter than 32 characters', () => {
      expect(() => getTokenKey({})).toThrow('GOOGLE_TOKEN_ENCRYPTION_KEY is missing');
      expect(() => getTokenKey({ GOOGLE_TOKEN_ENCRYPTION_KEY: '' })).toThrow(
        'GOOGLE_TOKEN_ENCRYPTION_KEY is missing',
      );
      expect(() => getTokenKey({ GOOGLE_TOKEN_ENCRYPTION_KEY: 'too-short-key' })).toThrow(
        'shorter than 32 characters',
      );
      expect(
        getTokenKey({
          GOOGLE_TOKEN_ENCRYPTION_KEY: 'valid-encryption-key-with-32-chars-ok',
        }),
      ).toBe('valid-encryption-key-with-32-chars-ok');
    });

    it('with encryption key missing, getTokenKey throws and prevents storing or decrypting tokens', () => {
      const emptyEnv = {};
      expect(() => getTokenKey(emptyEnv)).toThrow('GOOGLE_TOKEN_ENCRYPTION_KEY is missing');
      const shortEnv = { GOOGLE_TOKEN_ENCRYPTION_KEY: 'short' };
      expect(() => getTokenKey(shortEnv)).toThrow('shorter than 32 characters');
    });
  });

  describe('Security Audits: getGoogleAuthHealth KV Safety', () => {
    it('returns unknown when KV has no record and blocks sending', async () => {
      const config = createMockKV();
      const health = await getGoogleAuthHealth(config);
      expect(health.status).toBe('unknown');
      expect(health.reason).toContain('No auth health record found');

      // Sending is blocked when health is unknown
      const { db, resumes, applications } = createMockDb();
      resumes.set('res-valid', { id: 'res-valid', r2_key: 'r2-key', label: 'Resume' });
      applications.set('app-block', { id: 'app-block', status: 'approved' });
      const dummySender: GmailSender = {
        async send() {
          return { gmailMessageId: 'id', gmailThreadId: 'th' };
        },
        async searchSentByMessageId() {
          return null;
        },
      };

      const localR2: R2LikeBucket = {
        async get() {
          return null;
        },
      };

      const sendRes = await sendApplicationEmail({
        db,
        config,
        resumesBucket: localR2,
        gmailSender: dummySender,
        profile: mockProfile,
        dryRun: false,
        application: { ...targetApp, id: 'app-block' },
      });
      expect(sendRes.success).toBe(false);
      expect(sendRes.error).toContain('Google auth health is invalid: No auth health record found');
      expect(applications.get('app-block')?.['status']).toBe('approved');
    });

    it('returns invalid when KV contains corrupt JSON', async () => {
      const config = createMockKV();
      await config.put(KV_KEYS.AUTH_HEALTH, 'not-valid-json{');
      const health = await getGoogleAuthHealth(config);
      expect(health.status).toBe('invalid');
      expect(health.reason).toContain('Corrupted auth health JSON');
    });

    it('returns invalid when KV get throws an error', async () => {
      const throwingConfig: KVLike = {
        async get() {
          throw new Error('KV connection timed out');
        },
        async put() {},
        async delete() {},
      };
      const health = await getGoogleAuthHealth(throwingConfig);
      expect(health.status).toBe('invalid');
      expect(health.reason).toContain('KV error reading auth health');
    });
  });

  describe('Security Audits: canBulkApprove Invariants', () => {
    const cleanDraft = {
      id: 'app-clean-1',
      job_id: 'job-clean-1',
      status: 'draft',
      apply_route: 'auto_email',
      contact_source: 'posting',
      contact_email: 'jobs@stripe.com',
      company: 'Stripe',
      title: 'Senior Systems Engineer',
      cover_letter: validCoverLetter,
      subject: 'Application for Senior Systems Engineer',
      red_flags: [] as string[],
      untrusted: false,
      match_score: 85,
      is_on_dnc: false,
    };

    it('blocks application if status is approved, needs_review, sent, or rejected', () => {
      for (const st of ['approved', 'needs_review', 'sent', 'rejected', 'failed', 'manual_pending']) {
        const res = canBulkApprove({ ...cleanDraft, status: st }, { profile: mockProfile });
        expect(res.allowed).toBe(false);
        expect(res.reason).toBeTruthy();
      }
    });

    it('blocks application if red flags are present', () => {
      const resArray = canBulkApprove(
        { ...cleanDraft, red_flags: ['suspicious_recruiter'] },
        { profile: mockProfile },
      );
      expect(resArray.allowed).toBe(false);
      expect(resArray.reason).toContain('Job has red flags');

      const resJson = canBulkApprove(
        { ...cleanDraft, red_flags: JSON.stringify(['red_flag']) },
        { profile: mockProfile },
      );
      expect(resJson.allowed).toBe(false);
      expect(resJson.reason).toContain('Job has red flags');
    });

    it('blocks application if job is untrusted', () => {
      const resBool = canBulkApprove({ ...cleanDraft, untrusted: true }, { profile: mockProfile });
      expect(resBool.allowed).toBe(false);
      expect(resBool.reason).toContain('Untrusted');

      const resNum = canBulkApprove({ ...cleanDraft, untrusted: 1 }, { profile: mockProfile });
      expect(resNum.allowed).toBe(false);
      expect(resNum.reason).toContain('Untrusted');
    });

    it('blocks application if match score is below minimum threshold', () => {
      // mockProfile min_score is 70
      const resBelow = canBulkApprove(
        { ...cleanDraft, match_score: 69 },
        { profile: mockProfile },
      );
      expect(resBelow.allowed).toBe(false);
      expect(resBelow.reason).toContain('below minimum score');

      const resNull = canBulkApprove(
        { ...cleanDraft, match_score: null },
        { profile: mockProfile },
      );
      expect(resNull.allowed).toBe(false);
      expect(resNull.reason).toContain('below minimum score');
    });

    it('blocks application if contact source is guessed or none', () => {
      const resGuessed = canBulkApprove(
        { ...cleanDraft, contact_source: 'guessed' },
        { profile: mockProfile },
      );
      expect(resGuessed.allowed).toBe(false);
      expect(resGuessed.reason).toContain('Guessed email contacts cannot be bulk-approved');

      const resNone = canBulkApprove(
        { ...cleanDraft, contact_source: 'none' },
        { profile: mockProfile },
      );
      expect(resNone.allowed).toBe(false);
      expect(resNone.reason).toContain('cannot be bulk-approved');
    });

    it('blocks application if apply route is not auto_email', () => {
      const resPortal = canBulkApprove(
        { ...cleanDraft, apply_route: 'manual_portal' },
        { profile: mockProfile },
      );
      expect(resPortal.allowed).toBe(false);
      expect(resPortal.reason).toContain('manual_portal cannot be bulk-approved');

      const resReview = canBulkApprove(
        { ...cleanDraft, apply_route: 'manual_review' },
        { profile: mockProfile },
      );
      expect(resReview.allowed).toBe(false);
      expect(resReview.reason).toContain('manual_review cannot be bulk-approved');
    });

    it('blocks application if contact email or domain is on do_not_contact list', () => {
      const resDncFlag = canBulkApprove(
        { ...cleanDraft, is_on_dnc: true },
        { profile: mockProfile },
      );
      expect(resDncFlag.allowed).toBe(false);
      expect(resDncFlag.reason).toContain('do_not_contact');

      const resDncList = canBulkApprove(cleanDraft, {
        profile: mockProfile,
        doNotContact: new Set(['jobs@stripe.com']),
      });
      expect(resDncList.allowed).toBe(false);
      expect(resDncList.reason).toContain('do_not_contact');

      const resDncDomain = canBulkApprove(cleanDraft, {
        profile: mockProfile,
        doNotContact: new Set(['stripe.com']),
      });
      expect(resDncDomain.allowed).toBe(false);
      expect(resDncDomain.reason).toContain('do_not_contact');
    });

    it('blocks application if cover letter is invalid or missing', () => {
      const resEmpty = canBulkApprove(
        { ...cleanDraft, cover_letter: '' },
        { profile: mockProfile },
      );
      expect(resEmpty.allowed).toBe(false);
      expect(resEmpty.reason).toContain('Cover letter validation failed');

      const resPlaceholder = canBulkApprove(
        { ...cleanDraft, cover_letter: 'Dear [Company], I want job.' },
        { profile: mockProfile },
      );
      expect(resPlaceholder.allowed).toBe(false);
      expect(resPlaceholder.reason).toContain('Cover letter validation failed');
    });

    it('allows a clean draft application meeting all conditions', () => {
      const resPosting = canBulkApprove(cleanDraft, { profile: mockProfile });
      expect(resPosting.allowed).toBe(true);
      expect(resPosting.reason).toBeUndefined();

      const resFinder = canBulkApprove(
        { ...cleanDraft, contact_source: 'finder' },
        { profile: mockProfile },
      );
      expect(resFinder.allowed).toBe(true);
      expect(resFinder.reason).toBeUndefined();
    });

    it('exhaustive property test: generated combination over all fields is allowed ONLY for clean combinations', () => {
      const statuses = ['draft', 'needs_review', 'approved', 'rejected', 'sent'];
      const routes = ['auto_email', 'manual_portal', 'manual_review'];
      const contactSources = ['posting', 'finder', 'guessed', 'none'];
      const redFlagsOptions: string[][] = [[], ['flag_1']];
      const untrustedOptions = [false, true];
      const scores = [85, 50]; // threshold is 70
      const dncOptions = [false, true];
      const letterOptions = [validCoverLetter, ''];

      for (const status of statuses) {
        for (const apply_route of routes) {
          for (const contact_source of contactSources) {
            for (const red_flags of redFlagsOptions) {
              for (const untrusted of untrustedOptions) {
                for (const match_score of scores) {
                  for (const is_on_dnc of dncOptions) {
                    for (const cover_letter of letterOptions) {
                      const item = {
                        status,
                        apply_route,
                        contact_source,
                        red_flags,
                        untrusted,
                        match_score,
                        is_on_dnc,
                        cover_letter,
                        subject: 'Application for Senior Systems Engineer',
                        title: 'Senior Systems Engineer',
                        company: 'Stripe',
                        contact_email: 'jobs@stripe.com',
                      };

                      const result = canBulkApprove(item, { profile: mockProfile });
                      const expectedAllowed =
                        status === 'draft' &&
                        apply_route === 'auto_email' &&
                        (contact_source === 'posting' || contact_source === 'finder') &&
                        red_flags.length === 0 &&
                        !untrusted &&
                        match_score >= mockProfile.filters.min_score &&
                        !is_on_dnc &&
                        cover_letter === validCoverLetter;

                      expect(
                        result.allowed,
                        `Invariant failed for status=${status}, route=${apply_route}, contact=${contact_source}, red_flags=${red_flags.length}, untrusted=${untrusted}, score=${match_score}, dnc=${is_on_dnc}, letterValid=${cover_letter === validCoverLetter}`,
                      ).toBe(expectedAllowed);

                      if (!expectedAllowed) {
                        expect(result.reason).toBeDefined();
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    });
  });
});
