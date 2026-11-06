import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { D1LikeDatabase } from '../state-machine.js';
import type { KVLike } from '../google/auth.js';
import { setGoogleAuthHealth } from '../google/auth.js';
import type {
  GmailSender,
  SendEmailParams,
  SendEmailResult,
  GmailThread,
} from '../google/types.js';
import type { Profile } from '../profile.js';
import {
  addBusinessDays,
  hasElapsedBusinessDays,
  generateFollowUpLetter,
  createPendingFollowUps,
} from './follow-up.js';
import { pollInboxAndTrackOutcomes } from './poller.js';

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

interface MockAppRow {
  id: string;
  job_id: string;
  channel: string;
  kind: string;
  status: string;
  sent_at: string | null;
  subject: string | null;
  cover_letter: string | null;
  resume_id: string | null;
  message_id_header: string | null;
  gmail_thread_id: string | null;
  follow_up_count: number;
  notes: string | null;
  updated_at: string;
}

interface MockJobRow {
  id: string;
  title: string;
  company: string;
  contact_email: string | null;
}

function createMockDb(initialApps: MockAppRow[] = [], initialJobs: MockJobRow[] = []) {
  const applications = new Map<string, MockAppRow>();
  const jobs = new Map<string, MockJobRow>();
  const doNotContact = new Set<string>();
  const dailyCounters = new Map<string, { sends: number; bounces: number }>();
  const events: Array<{ entity: string; entity_id: string; type: string; payload: string }> = [];

  for (const app of initialApps) {
    applications.set(app.id, { ...app });
  }
  for (const job of initialJobs) {
    jobs.set(job.id, { ...job });
  }

  const db: D1LikeDatabase = {
    prepare(query: string) {
      let boundParams: unknown[] = [];
      const stmt = {
        bind(...params: unknown[]) {
          boundParams = params;
          return stmt;
        },
        async first<T>(): Promise<T | null> {
          if (
            query.includes('FROM applications') &&
            query.includes('status FROM applications WHERE id = ?')
          ) {
            const id = String(boundParams[0]);
            const a = applications.get(id);
            return (a ? { status: a.status } : null) as unknown as T;
          }
          if (query.includes('FROM applications WHERE job_id = ? AND kind = ?')) {
            const jobId = String(boundParams[0]);
            const kind = String(boundParams[1]);
            for (const a of applications.values()) {
              if (a.job_id === jobId && a.kind === kind) {
                return a as unknown as T;
              }
            }
            return null;
          }
          if (query.includes('FROM applications WHERE id = ?')) {
            const id = String(boundParams[0]);
            return (applications.get(id) ?? null) as unknown as T;
          }
          return null;
        },
        async all<T>(): Promise<{ results: T[] }> {
          if (query.includes('FROM applications a') && query.includes('JOIN jobs j')) {
            const results: unknown[] = [];
            // Check if filtering for active polled threads (status IN ('sent', 'replied'))
            const filterByStatus = query.includes("status IN ('sent', 'replied')");
            const cutoffIso = boundParams[0] ? String(boundParams[0]) : '';

            for (const a of applications.values()) {
              if (a.channel !== 'email') continue;

              if (filterByStatus) {
                if (!['sent', 'replied'].includes(a.status)) continue;
                if (!a.gmail_thread_id) continue;
                if (a.sent_at && a.sent_at < cutoffIso) continue;
              } else {
                // Follow up candidate check
                if (a.kind !== 'initial') continue;
                if (a.status !== 'sent') continue;
                const maxFollowUps = Number(boundParams[0] ?? 1);
                if (a.follow_up_count >= maxFollowUps) continue;
                if (!a.sent_at) continue;
              }

              const j = jobs.get(a.job_id) || {
                id: a.job_id,
                title: 'Software Engineer',
                company: 'Tech Corp',
                contact_email: 'jobs@techcorp.com',
              };

              results.push({
                ...a,
                title: j.title,
                company: j.company,
                contact_email: j.contact_email,
              });
            }
            return { results: results as T[] };
          }
          return { results: [] };
        },
        async run() {
          if (query.includes('UPDATE applications SET status = ?, updated_at = ? WHERE id = ?')) {
            const status = String(boundParams[0]);
            const updated_at = String(boundParams[1]);
            const id = String(boundParams[2]);
            const a = applications.get(id);
            if (a) {
              a.status = status;
              a.updated_at = updated_at;
            }
            return { changes: 1 };
          }
          if (
            query.includes('UPDATE applications') &&
            query.includes('follow_up_count = follow_up_count + 1')
          ) {
            const updated_at = String(boundParams[0]);
            const id = String(boundParams[1]);
            const a = applications.get(id);
            if (a) {
              a.follow_up_count += 1;
              a.updated_at = updated_at;
            }
            return { changes: 1 };
          }
          if (query.includes('INSERT INTO applications')) {
            const id = String(boundParams[0]);
            const job_id = String(boundParams[1]);
            const resume_id = String(boundParams[2]);
            const cover_letter = String(boundParams[3]);
            const subject = String(boundParams[4]);
            const message_id_header = String(boundParams[5]);
            const gmail_thread_id = String(boundParams[6]);
            const notes = String(boundParams[7]);
            const updated_at = String(boundParams[8]);

            applications.set(id, {
              id,
              job_id,
              kind: 'follow_up',
              channel: 'email',
              status: 'draft',
              sent_at: null,
              subject,
              cover_letter,
              resume_id,
              message_id_header,
              gmail_thread_id,
              follow_up_count: 0,
              notes,
              updated_at,
            });
            return { changes: 1 };
          }
          if (query.includes('INSERT OR IGNORE INTO do_not_contact')) {
            const val = String(boundParams[0]);
            doNotContact.add(val.toLowerCase());
            return { changes: 1 };
          }
          if (query.includes('daily_counters')) {
            const date = String(boundParams[0]);
            const current = dailyCounters.get(date) || { sends: 0, bounces: 0 };
            current.bounces += 1;
            dailyCounters.set(date, current);
            return { changes: 1 };
          }
          if (query.includes('INSERT INTO events')) {
            const entity = String(boundParams[1]);
            const entity_id = String(boundParams[2]);
            const type = String(boundParams[3]);
            const payload = String(boundParams[4]);
            events.push({ entity, entity_id, type, payload });
            return { changes: 1 };
          }
          return { changes: 0 };
        },
      };
      return stmt;
    },
    async batch(statements: unknown[]) {
      for (const s of statements as Array<{ run: () => Promise<unknown> }>) {
        if (s && typeof s.run === 'function') {
          await s.run();
        }
      }
      return statements;
    },
  };

  return { db, applications, jobs, doNotContact, dailyCounters, events };
}

function createMockGmailClient(threads: Record<string, GmailThread> = {}) {
  let getThreadCalls = 0;
  const threadMap = new Map<string, GmailThread>(Object.entries(threads));

  const client: GmailSender & {
    getThreadCalls: () => number;
    setThread: (id: string, t: GmailThread) => void;
  } = {
    async send(_params: SendEmailParams): Promise<SendEmailResult> {
      return { gmailMessageId: 'sent-msg-1', gmailThreadId: 'sent-thread-1' };
    },
    async searchSentByMessageId() {
      return null;
    },
    async getThread(threadId: string): Promise<GmailThread | null> {
      getThreadCalls++;
      return threadMap.get(threadId) ?? null;
    },
    getThreadCalls: () => getThreadCalls,
    setThread: (id: string, t: GmailThread) => threadMap.set(id, t),
  };

  return client;
}

const mockProfile: Profile = {
  name: 'Alex Mercer',
  email: 'alex.mercer@example.com',
  skills: ['TypeScript', 'Cloudflare Workers', 'Distributed Systems'],
  experience: [
    {
      title: 'Senior Systems Engineer',
      company: 'Tech Corp',
      location: 'Remote',
      start_date: '2020-01',
      end_date: '2026-01',
      current: false,
      description: 'Distributed systems.',
      highlights: [],
    },
  ],
  education: [],
  preferences: { locations: ['Remote'], remote: true },
  filters: {
    titles: ['Systems Engineer'],
    locations: ['Remote'],
    company_blacklist: [],
    min_score: 70,
    require_salary: false,
    experience_range: { min: 6, max: 12 },
  },
  send_settings: {
    daily_cap: 20,
    window: { start: '09:00', end: '18:00' },
    timezone: 'UTC',
    ramp_base: 5,
    ramp_step: 2,
    auto_approve_above_score: 85,
    max_follow_ups: 1,
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

describe('Phase 9: Outcome Tracking & Polite Follow-ups', () => {
  let config: KVLike & { store: Map<string, string> };

  beforeEach(async () => {
    config = createMockKV();
    await setGoogleAuthHealth({ config, status: 'ok', reason: null });
  });

  describe('Business Days & Follow-Up Generation', () => {
    it('accurately skips weekends when adding business days', () => {
      // Monday 2026-11-02 10:00:00 UTC
      const monday = new Date('2026-11-02T10:00:00Z');
      // +1 business day = Tuesday
      expect(addBusinessDays(monday, 1).toISOString()).toBe('2026-11-03T10:00:00.000Z');
      // +4 business days = Friday
      expect(addBusinessDays(monday, 4).toISOString()).toBe('2026-11-06T10:00:00.000Z');
      // +5 business days = Monday (skips Sat Nov 7 and Sun Nov 8)
      expect(addBusinessDays(monday, 5).toISOString()).toBe('2026-11-09T10:00:00.000Z');
      // +6 business days = Tuesday Nov 10
      expect(addBusinessDays(monday, 6).toISOString()).toBe('2026-11-10T10:00:00.000Z');
    });

    it('hasElapsedBusinessDays correctly checks threshold', () => {
      const monday = new Date('2026-11-02T10:00:00Z');
      const mondayNextWeek = new Date('2026-11-09T10:00:00Z'); // 5 business days
      const tuesdayNextWeek = new Date('2026-11-10T10:00:00Z'); // 6 business days

      expect(hasElapsedBusinessDays(monday, 6, mondayNextWeek)).toBe(false);
      expect(hasElapsedBusinessDays(monday, 6, tuesdayNextWeek)).toBe(true);
    });

    it('generateFollowUpLetter creates a guardrail-compliant letter signed with profile.name', () => {
      const letter = generateFollowUpLetter(mockProfile, 'Senior Systems Engineer', 'Stripe');
      expect(letter).toContain('Stripe');
      expect(letter).toContain('Senior Systems Engineer');
      expect(letter).toContain('Alex Mercer');

      // Word count is between 150 and 250 words
      const words = letter.split(/\s+/).filter(Boolean).length;
      expect(words).toBeGreaterThanOrEqual(150);
      expect(words).toBeLessThanOrEqual(250);
    });
  });

  describe('Task Tests from Prompt Specification', () => {
    it('A delivery-failure DSN fixture -> bounced, address added to do_not_contact, bounce counter incremented', async () => {
      const app: MockAppRow = {
        id: 'app-dsn-1',
        job_id: 'job-1',
        channel: 'email',
        kind: 'initial',
        status: 'sent',
        sent_at: '2026-11-01T10:00:00Z',
        subject: 'Application for Systems Lead',
        cover_letter: 'letter',
        resume_id: 'res-1',
        message_id_header: '<msg-1@pigeon.local>',
        gmail_thread_id: 'thread-dsn',
        follow_up_count: 0,
        notes: null,
        updated_at: '2026-11-01T10:00:00Z',
      };
      const job: MockJobRow = {
        id: 'job-1',
        title: 'Systems Lead',
        company: 'FailingCorp',
        contact_email: 'invalid-address@failingcorp.com',
      };

      const { db, applications, doNotContact, dailyCounters } = createMockDb([app], [job]);

      // Delivery Status Notification Thread (message 1: original, message 2: DSN bounce)
      const dsnThread: GmailThread = {
        id: 'thread-dsn',
        messages: [
          {
            id: 'orig-msg',
            threadId: 'thread-dsn',
            snippet: 'Original application',
            payload: {
              headers: [
                { name: 'From', value: 'alex.mercer@example.com' },
                { name: 'To', value: 'invalid-address@failingcorp.com' },
              ],
            },
          },
          {
            id: 'bounce-msg',
            threadId: 'thread-dsn',
            snippet: 'Delivery Status Notification (Failure): Action: failed Status: 5.1.1',
            payload: {
              headers: [
                { name: 'From', value: 'mailer-daemon@googlemail.com' },
                { name: 'Subject', value: 'Delivery Status Notification (Failure)' },
                { name: 'Content-Type', value: 'multipart/report; report-type=delivery-status' },
              ],
            },
          },
        ],
      };

      const gmailClient = createMockGmailClient({ 'thread-dsn': dsnThread });
      const notifierMock = { notify: vi.fn() };

      const result = await pollInboxAndTrackOutcomes({
        db,
        config,
        gmailClient,
        notifier: notifierMock as unknown as Parameters<
          typeof pollInboxAndTrackOutcomes
        >[0]['notifier'],
        profile: mockProfile,
        nowMs: new Date('2026-11-02T10:00:00Z').getTime(),
      });

      expect(result.success).toBe(true);
      expect(result.bouncesDetected).toBe(1);

      // Prompt requirement 1: status bounced
      expect(applications.get('app-dsn-1')?.status).toBe('bounced');

      // Prompt requirement 2: address added to do_not_contact
      expect(doNotContact.has('invalid-address@failingcorp.com')).toBe(true);

      // Prompt requirement 3: bounce counter incremented
      const counter = dailyCounters.get('2026-11-02');
      expect(counter?.bounces).toBe(1);

      // Notifier called once
      expect(notifierMock.notify).toHaveBeenCalledTimes(1);
      expect(notifierMock.notify).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'bounce:app-dsn-1' }),
      );
    });

    it('An out-of-office auto-reply is not counted as a reply', async () => {
      const app: MockAppRow = {
        id: 'app-ooo-1',
        job_id: 'job-2',
        channel: 'email',
        kind: 'initial',
        status: 'sent',
        sent_at: '2026-11-01T10:00:00Z',
        subject: 'Application for DevOps Engineer',
        cover_letter: 'letter',
        resume_id: 'res-1',
        message_id_header: '<msg-ooo@pigeon.local>',
        gmail_thread_id: 'thread-ooo',
        follow_up_count: 0,
        notes: null,
        updated_at: '2026-11-01T10:00:00Z',
      };
      const job: MockJobRow = {
        id: 'job-2',
        title: 'DevOps Engineer',
        company: 'Stripe',
        contact_email: 'recruiter@stripe.com',
      };

      const { db, applications } = createMockDb([app], [job]);

      const oooThread: GmailThread = {
        id: 'thread-ooo',
        messages: [
          {
            id: 'orig-msg',
            threadId: 'thread-ooo',
            snippet: 'Original email',
            payload: {
              headers: [
                { name: 'From', value: 'alex.mercer@example.com' },
                { name: 'To', value: 'recruiter@stripe.com' },
              ],
            },
          },
          {
            id: 'ooo-msg',
            threadId: 'thread-ooo',
            snippet:
              'I am currently out of the office on annual leave with limited access to email.',
            payload: {
              headers: [
                { name: 'From', value: 'recruiter@stripe.com' },
                { name: 'Subject', value: 'Automatic reply: Out of office until next week' },
                { name: 'Auto-Submitted', value: 'auto-replied' },
              ],
            },
          },
        ],
      };

      const gmailClient = createMockGmailClient({ 'thread-ooo': oooThread });
      const notifierMock = { notify: vi.fn() };

      const result = await pollInboxAndTrackOutcomes({
        db,
        config,
        gmailClient,
        notifier: notifierMock as unknown as Parameters<
          typeof pollInboxAndTrackOutcomes
        >[0]['notifier'],
        profile: mockProfile,
        nowMs: new Date('2026-11-02T10:00:00Z').getTime(),
      });

      expect(result.success).toBe(true);
      expect(result.autoRepliesIgnored).toBe(1);
      expect(result.repliesDetected).toBe(0);

      // Prompt requirement: An out-of-office auto-reply is not counted as a reply (remains 'sent')
      expect(applications.get('app-ooo-1')?.status).toBe('sent');
      expect(notifierMock.notify).not.toHaveBeenCalled();
    });

    it('Interview and rejection fixtures classify correctly; an ambiguous reply stays replied', async () => {
      const apps: MockAppRow[] = [
        {
          id: 'app-interview',
          job_id: 'job-interview',
          channel: 'email',
          kind: 'initial',
          status: 'sent',
          sent_at: '2026-11-01T10:00:00Z',
          subject: 'Role 1',
          cover_letter: 'c1',
          resume_id: 'r1',
          message_id_header: '<m1@pigeon.local>',
          gmail_thread_id: 'thread-interview',
          follow_up_count: 0,
          notes: null,
          updated_at: '2026-11-01T10:00:00Z',
        },
        {
          id: 'app-rejected',
          job_id: 'job-rejected',
          channel: 'email',
          kind: 'initial',
          status: 'sent',
          sent_at: '2026-11-01T10:00:00Z',
          subject: 'Role 2',
          cover_letter: 'c2',
          resume_id: 'r2',
          message_id_header: '<m2@pigeon.local>',
          gmail_thread_id: 'thread-rejected',
          follow_up_count: 0,
          notes: null,
          updated_at: '2026-11-01T10:00:00Z',
        },
        {
          id: 'app-ambiguous',
          job_id: 'job-ambiguous',
          channel: 'email',
          kind: 'initial',
          status: 'sent',
          sent_at: '2026-11-01T10:00:00Z',
          subject: 'Role 3',
          cover_letter: 'c3',
          resume_id: 'r3',
          message_id_header: '<m3@pigeon.local>',
          gmail_thread_id: 'thread-ambiguous',
          follow_up_count: 0,
          notes: null,
          updated_at: '2026-11-01T10:00:00Z',
        },
      ];

      const jobs: MockJobRow[] = [
        {
          id: 'job-interview',
          title: 'Lead Engineer',
          company: 'Linear',
          contact_email: 'lin@linear.app',
        },
        {
          id: 'job-rejected',
          title: 'Staff Engineer',
          company: 'Meta',
          contact_email: 'rec@meta.com',
        },
        {
          id: 'job-ambiguous',
          title: 'Principal Engineer',
          company: 'HashiCorp',
          contact_email: 'hr@hashi.com',
        },
      ];

      const { db, applications } = createMockDb(apps, jobs);

      const threads: Record<string, GmailThread> = {
        'thread-interview': {
          id: 'thread-interview',
          messages: [
            { id: 'm0', threadId: 'thread-interview', snippet: 'Initial app' },
            {
              id: 'm1',
              threadId: 'thread-interview',
              snippet:
                'We loved your profile and would love to schedule a 30-minute interview chat next week!',
              payload: {
                headers: [
                  { name: 'From', value: 'recruiter@linear.app' },
                  { name: 'Subject', value: 'Re: Role 1' },
                ],
              },
            },
          ],
        },
        'thread-rejected': {
          id: 'thread-rejected',
          messages: [
            { id: 'm0', threadId: 'thread-rejected', snippet: 'Initial app' },
            {
              id: 'm1',
              threadId: 'thread-rejected',
              snippet:
                'Thank you for your time. Unfortunately, we have decided not to move forward with your candidacy.',
              payload: {
                headers: [
                  { name: 'From', value: 'recruiting@meta.com' },
                  { name: 'Subject', value: 'Re: Role 2' },
                ],
              },
            },
          ],
        },
        'thread-ambiguous': {
          id: 'thread-ambiguous',
          messages: [
            { id: 'm0', threadId: 'thread-ambiguous', snippet: 'Initial app' },
            {
              id: 'm1',
              threadId: 'thread-ambiguous',
              snippet: 'Got your email. I have forwarded this over to our engineering department.',
              payload: {
                headers: [
                  { name: 'From', value: 'hr@hashi.com' },
                  { name: 'Subject', value: 'Re: Role 3' },
                ],
              },
            },
          ],
        },
      };

      const gmailClient = createMockGmailClient(threads);
      const notifierMock = { notify: vi.fn() };

      const result = await pollInboxAndTrackOutcomes({
        db,
        config,
        gmailClient,
        notifier: notifierMock as unknown as Parameters<
          typeof pollInboxAndTrackOutcomes
        >[0]['notifier'],
        profile: mockProfile,
        nowMs: new Date('2026-11-02T10:00:00Z').getTime(),
      });

      expect(result.success).toBe(true);
      expect(result.interviewsDetected).toBe(1);
      expect(result.rejectionsDetected).toBe(1);
      expect(result.repliesDetected).toBe(3);

      // Prompt requirement 1: Interview classified correctly
      expect(applications.get('app-interview')?.status).toBe('interview');

      // Prompt requirement 2: Rejection classified correctly
      expect(applications.get('app-rejected')?.status).toBe('rejected');

      // Prompt requirement 3: Ambiguous reply stays replied
      expect(applications.get('app-ambiguous')?.status).toBe('replied');
    });

    it('A follow-up is created exactly once after 6 business days (fake timers), never after a reply, never twice, and lands in draft rather than being sent', async () => {
      // Sent Monday 2026-11-02 10:00:00 UTC
      const sentAt = '2026-11-02T10:00:00Z';

      const initialApp: MockAppRow = {
        id: 'app-initial-1',
        job_id: 'job-stripe',
        channel: 'email',
        kind: 'initial',
        status: 'sent',
        sent_at: sentAt,
        subject: 'Application for Senior Infrastructure Engineer',
        cover_letter: 'Initial cover letter',
        resume_id: 'res-1',
        message_id_header: '<orig-msg-123@pigeon.local>',
        gmail_thread_id: 'thread-stripe-1',
        follow_up_count: 0,
        notes: null,
        updated_at: sentAt,
      };

      const job: MockJobRow = {
        id: 'job-stripe',
        title: 'Senior Infrastructure Engineer',
        company: 'Stripe',
        contact_email: 'recruiter@stripe.com',
      };

      const { db, applications } = createMockDb([initialApp], [job]);

      // Day 4 (Friday Nov 6): 4 business days -> NO follow-up
      const friday = new Date('2026-11-06T10:00:00Z').getTime();
      const resFriday = await createPendingFollowUps({
        db,
        profile: mockProfile,
        nowMs: friday,
        businessDaysThreshold: 6,
      });
      expect(resFriday.createdCount).toBe(0);
      expect(applications.size).toBe(1);

      // Day 5 (Monday Nov 9): 5 business days -> NO follow-up
      const mondayNextWeek = new Date('2026-11-09T10:00:00Z').getTime();
      const resMonday = await createPendingFollowUps({
        db,
        profile: mockProfile,
        nowMs: mondayNextWeek,
        businessDaysThreshold: 6,
      });
      expect(resMonday.createdCount).toBe(0);
      expect(applications.size).toBe(1);

      // Day 6 (Tuesday Nov 10 10:00:01Z): 6 business days have elapsed!
      const tuesdayNextWeek = new Date('2026-11-10T10:00:01Z').getTime();
      const resTuesday = await createPendingFollowUps({
        db,
        profile: mockProfile,
        nowMs: tuesdayNextWeek,
        businessDaysThreshold: 6,
      });

      // Created exactly once
      expect(resTuesday.createdCount).toBe(1);
      expect(applications.size).toBe(2);

      const followUpApp = Array.from(applications.values()).find((a) => a.kind === 'follow_up');
      expect(followUpApp).toBeDefined();

      // Prompt requirement: lands in draft rather than being sent
      expect(followUpApp?.status).toBe('draft');
      expect(followUpApp?.kind).toBe('follow_up');
      expect(followUpApp?.channel).toBe('email');

      // Initial application's follow_up_count incremented to 1
      expect(applications.get('app-initial-1')?.follow_up_count).toBe(1);

      // Running a second time on Wednesday Nov 11 -> never twice!
      const wednesday = new Date('2026-11-11T10:00:00Z').getTime();
      const resWednesday = await createPendingFollowUps({
        db,
        profile: mockProfile,
        nowMs: wednesday,
        businessDaysThreshold: 6,
      });
      expect(resWednesday.createdCount).toBe(0);
      expect(applications.size).toBe(2); // Still exactly 2 (initial + 1 follow-up)

      // Never after a reply: create a new app that received a reply
      const repliedApp: MockAppRow = {
        id: 'app-replied-1',
        job_id: 'job-replied',
        channel: 'email',
        kind: 'initial',
        status: 'replied', // already replied!
        sent_at: sentAt,
        subject: 'Role',
        cover_letter: 'c',
        resume_id: 'r',
        message_id_header: '<m@pigeon.local>',
        gmail_thread_id: 't-replied',
        follow_up_count: 0,
        notes: null,
        updated_at: sentAt,
      };
      const repliedJob: MockJobRow = {
        id: 'job-replied',
        title: 'Role',
        company: 'Co',
        contact_email: 'e@co.com',
      };
      const { db: dbReplied, applications: appsReplied } = createMockDb([repliedApp], [repliedJob]);

      const resAfterReply = await createPendingFollowUps({
        db: dbReplied,
        profile: mockProfile,
        nowMs: tuesdayNextWeek,
        businessDaysThreshold: 6,
      });
      expect(resAfterReply.createdCount).toBe(0);
      expect(appsReplied.size).toBe(1); // Never created after a reply
    });

    it('Follow-up uses the original thread headers', async () => {
      const initialApp: MockAppRow = {
        id: 'app-thread-test',
        job_id: 'job-thread',
        channel: 'email',
        kind: 'initial',
        status: 'sent',
        sent_at: '2026-11-01T10:00:00Z',
        subject: 'Application for Distributed Systems Role',
        cover_letter: 'Original letter',
        resume_id: 'res-pdf-1',
        message_id_header: '<original-unique-id-999@pigeon.local>',
        gmail_thread_id: 'thread-abc-xyz',
        follow_up_count: 0,
        notes: null,
        updated_at: '2026-11-01T10:00:00Z',
      };

      const job: MockJobRow = {
        id: 'job-thread',
        title: 'Distributed Systems Role',
        company: 'CloudCorp',
        contact_email: 'hiring@cloudcorp.com',
      };

      const { db, applications } = createMockDb([initialApp], [job]);

      // Generate follow up after 8 business days
      const laterMs = new Date('2026-11-12T10:00:00Z').getTime();
      await createPendingFollowUps({
        db,
        profile: mockProfile,
        nowMs: laterMs,
      });

      const followUp = Array.from(applications.values()).find((a) => a.kind === 'follow_up');
      expect(followUp).toBeDefined();

      // Subject prefixed Re:
      expect(followUp?.subject).toBe('Re: Application for Distributed Systems Role');

      // Reuses the same thread ID
      expect(followUp?.gmail_thread_id).toBe('thread-abc-xyz');

      // Notes contain in_reply_to and references matching initial message_id_header
      const notes = JSON.parse(followUp?.notes || '{}') as {
        in_reply_to?: string;
        references?: string;
      };
      expect(notes.in_reply_to).toBe('<original-unique-id-999@pigeon.local>');
      expect(notes.references).toBe('<original-unique-id-999@pigeon.local>');
    });

    it('Running the poller repeatedly is idempotent and ignores unchanged threads', async () => {
      const app: MockAppRow = {
        id: 'app-idem-1',
        job_id: 'job-idem',
        channel: 'email',
        kind: 'initial',
        status: 'sent',
        sent_at: '2026-11-01T10:00:00Z',
        subject: 'DevOps Lead Application',
        cover_letter: 'c',
        resume_id: 'r',
        message_id_header: '<m@pigeon.local>',
        gmail_thread_id: 'thread-idem',
        follow_up_count: 0,
        notes: null,
        updated_at: '2026-11-01T10:00:00Z',
      };

      const job: MockJobRow = {
        id: 'job-idem',
        title: 'DevOps Lead',
        company: 'Datadog',
        contact_email: 'jobs@datadog.com',
      };

      const { db, applications } = createMockDb([app], [job]);

      const thread: GmailThread = {
        id: 'thread-idem',
        messages: [
          { id: 'm1', threadId: 'thread-idem', snippet: 'Initial app' },
          {
            id: 'm2',
            threadId: 'thread-idem',
            snippet: 'Thanks for writing. We received your note.',
            payload: { headers: [{ name: 'From', value: 'jobs@datadog.com' }] },
          },
        ],
      };

      const gmailClient = createMockGmailClient({ 'thread-idem': thread });

      // Run 1: Thread changed from 1 to 2 messages -> processes reply
      const res1 = await pollInboxAndTrackOutcomes({
        db,
        config,
        gmailClient,
        nowMs: new Date('2026-11-02T10:00:00Z').getTime(),
      });
      expect(res1.threadsPolled).toBe(1);
      expect(res1.threadsChanged).toBe(1);
      expect(res1.repliesDetected).toBe(1);
      expect(applications.get('app-idem-1')?.status).toBe('replied');

      // Stored count in KV is now 2
      expect(await config.get('gmail_thread_count:thread-idem')).toBe('2');

      // Run 2: Thread still has 2 messages -> unchanged thread ignored!
      const res2 = await pollInboxAndTrackOutcomes({
        db,
        config,
        gmailClient,
        nowMs: new Date('2026-11-02T10:15:00Z').getTime(),
      });

      // Prompt requirement: ignores unchanged threads
      expect(res2.threadsPolled).toBe(1);
      expect(res2.threadsChanged).toBe(0);
      expect(res2.repliesDetected).toBe(0);
      expect(applications.get('app-idem-1')?.status).toBe('replied');
    });

    it('The poller makes no calls while auth health is invalid', async () => {
      // Set auth health to invalid
      await setGoogleAuthHealth({
        config,
        status: 'invalid',
        reason: 'invalid_grant: Refresh token revoked',
      });

      const app: MockAppRow = {
        id: 'app-auth-invalid',
        job_id: 'job-1',
        channel: 'email',
        kind: 'initial',
        status: 'sent',
        sent_at: '2026-11-01T10:00:00Z',
        subject: 'Role',
        cover_letter: 'c',
        resume_id: 'r',
        message_id_header: '<m@pigeon.local>',
        gmail_thread_id: 'thread-no-call',
        follow_up_count: 0,
        notes: null,
        updated_at: '2026-11-01T10:00:00Z',
      };
      const job: MockJobRow = {
        id: 'job-1',
        title: 'Role',
        company: 'Co',
        contact_email: 'e@co.com',
      };

      const { db } = createMockDb([app], [job]);
      const gmailClient = createMockGmailClient();

      const res = await pollInboxAndTrackOutcomes({
        db,
        config,
        gmailClient,
      });

      // Prompt requirement: The poller makes no calls while auth health is invalid
      expect(res.success).toBe(false);
      expect(res.paused).toBe(true);
      expect(res.reason).toContain('auth_invalid');
      expect(gmailClient.getThreadCalls()).toBe(0);
    });

    it('Each event notifies once', async () => {
      const app: MockAppRow = {
        id: 'app-notify-1',
        job_id: 'job-notify',
        channel: 'email',
        kind: 'initial',
        status: 'sent',
        sent_at: '2026-11-01T10:00:00Z',
        subject: 'Senior Developer Role',
        cover_letter: 'c',
        resume_id: 'r',
        message_id_header: '<m@pigeon.local>',
        gmail_thread_id: 'thread-notify-test',
        follow_up_count: 0,
        notes: null,
        updated_at: '2026-11-01T10:00:00Z',
      };
      const job: MockJobRow = {
        id: 'job-notify',
        title: 'Senior Developer',
        company: 'Vercel',
        contact_email: 'hr@vercel.com',
      };

      const { db } = createMockDb([app], [job]);

      const thread: GmailThread = {
        id: 'thread-notify-test',
        messages: [
          { id: 'm1', threadId: 'thread-notify-test', snippet: 'Original' },
          {
            id: 'm2',
            threadId: 'thread-notify-test',
            snippet: 'We would love to invite you to an interview!',
            payload: {
              headers: [
                { name: 'From', value: 'hr@vercel.com' },
                { name: 'Subject', value: 'Re: Role' },
              ],
            },
          },
        ],
      };

      const gmailClient = createMockGmailClient({ 'thread-notify-test': thread });
      const notifierMock = { notify: vi.fn() };

      // Poll 1: Discovers interview -> notifies
      await pollInboxAndTrackOutcomes({
        db,
        config,
        gmailClient,
        notifier: notifierMock as unknown as Parameters<
          typeof pollInboxAndTrackOutcomes
        >[0]['notifier'],
        profile: mockProfile,
      });

      expect(notifierMock.notify).toHaveBeenCalledTimes(1);
      expect(notifierMock.notify).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'interview:app-notify-1' }),
      );

      // Simulate thread having a 3rd message also about interview
      thread.messages.push({
        id: 'm3',
        threadId: 'thread-notify-test',
        snippet: 'Here is the interview calendar link again.',
        payload: { headers: [{ name: 'From', value: 'hr@vercel.com' }] },
      });
      gmailClient.setThread('thread-notify-test', thread);

      // Poll 2: Another interview message on same application -> does NOT notify again
      await pollInboxAndTrackOutcomes({
        db,
        config,
        gmailClient,
        notifier: notifierMock as unknown as Parameters<
          typeof pollInboxAndTrackOutcomes
        >[0]['notifier'],
        profile: mockProfile,
      });

      // Prompt requirement: Each event notifies once
      expect(notifierMock.notify).toHaveBeenCalledTimes(1);
    });
  });
});
