import { describe, it, expect, vi } from 'vitest';
import type { D1LikeDatabase } from '../state-machine.js';
import type { Profile } from '../profile.js';
import { getManualQueue, getManualKit } from './queue.js';
import {
  markApplied,
  skipManualApplication,
  snoozeManualApplication,
  sendByEmail,
  bulkManualAction,
  recordOutcome,
} from './actions.js';
import { expireStaleManualPending, sendManualDailyDigest } from './housekeeping.js';
import { EventsNotifier } from '../notifier.js';

const mockProfile: Profile = {
  name: 'Alex Mercer',
  email: 'alex.mercer@example.com',
  skills: ['TypeScript', 'Cloudflare Workers', 'Distributed Systems'],
  experience: [],
  education: [],
  preferences: {
    locations: ['Remote'],
    remote: true,
    manual_daily_target: 2, // Daily target of 2 for testing
  },
  filters: {
    titles: ['Systems Engineer'],
    locations: ['Remote'],
    company_blacklist: [],
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

function createMockDb() {
  const jobs = new Map<string, Record<string, unknown>>();
  const applications = new Map<string, Record<string, unknown>>();
  const resumes = new Map<string, Record<string, unknown>>();
  const companiesContacted = new Map<string, Record<string, unknown>>();
  const doNotContact = new Set<string>();
  const events: Array<{
    id: string;
    entity: string;
    entity_id: string;
    type: string;
    payload: string;
    created_at: string;
  }> = [];

  const db: D1LikeDatabase = {
    prepare(query: string) {
      let boundParams: unknown[] = [];
      const statement = {
        bind(...params: unknown[]) {
          boundParams = params;
          return statement;
        },
        async first<T>(): Promise<T | null> {
          if (query.includes('FROM do_not_contact')) {
            const val1 = String(boundParams[0]).toLowerCase();
            const val2 = String(boundParams[1]).toLowerCase();
            if (doNotContact.has(val1) || doNotContact.has(val2)) {
              return { value: val1 } as unknown as T;
            }
            return null;
          }
          if (
            query.includes('FROM applications a') &&
            query.includes('JOIN jobs j') &&
            (query.includes('WHERE a.id = ?') || query.includes('a.id = ?'))
          ) {
            const id = String(boundParams[0]);
            const a = applications.get(id);
            if (!a) return null;
            const j = jobs.get(String(a['job_id']));
            if (!j) return null;
            return {
              application_id: a['id'],
              job_id: a['job_id'],
              channel: a['channel'],
              status: a['status'],
              resume_id: a['resume_id'],
              cover_letter: a['cover_letter'],
              subject: a['subject'],
              notes: a['notes'],
              validator_errors: a['validator_errors'],
              snoozed_until: a['snoozed_until'],
              title: j['title'],
              company: j['company'],
              company_normalized: j['company_normalized'],
              source: j['source'],
              location: j['location'],
              remote: j['remote'],
              salary_raw: j['salary_raw'],
              salary_min: j['salary_min'],
              salary_max: j['salary_max'],
              currency: j['currency'],
              match_score: j['match_score'],
              match_reasons: j['match_reasons'],
              red_flags: j['red_flags'],
              apply_route: j['apply_route'],
              route_reason: j['route_reason'],
              untrusted: j['untrusted'],
              posted_at: j['posted_at'],
              fetched_at: j['fetched_at'],
              apply_url: j['apply_url'],
              contact_email: j['contact_email'],
              contact_source: j['contact_source'],
              description: j['description'],
            } as unknown as T;
          }
          if (query.includes('FROM applications WHERE id = ?')) {
            const id = String(boundParams[0]);
            return (applications.get(id) ?? null) as unknown as T;
          }
          if (query.includes('FROM jobs WHERE id = ?')) {
            const id = String(boundParams[0]);
            return (jobs.get(id) ?? null) as unknown as T;
          }
          if (query.includes('FROM resumes WHERE id = ?')) {
            const id = String(boundParams[0]);
            return (resumes.get(id) ?? null) as unknown as T;
          }
          if (query.includes('FROM profile WHERE id = ?')) {
            return {
              id: 'default',
              data: JSON.stringify(mockProfile),
            } as unknown as T;
          }
          return null;
        },
        async all<T>(): Promise<{ results: T[] }> {
          if (query.includes('FROM applications a') && query.includes('JOIN jobs j')) {
            const results: unknown[] = [];
            for (const a of applications.values()) {
              const status = String(a['status']);
              const channel = String(a['channel']);
              if (
                (channel === 'manual' || status === 'needs_review') &&
                (status === 'manual_pending' || status === 'needs_review')
              ) {
                const j = jobs.get(String(a['job_id']));
                if (!j) continue;

                // Subquery count for applied_count
                let appliedCount = 0;
                for (const a2 of applications.values()) {
                  if (a2['id'] === a['id']) continue;
                  const j2 = jobs.get(String(a2['job_id']));
                  if (
                    j2 &&
                    j2['company_normalized'] === j['company_normalized'] &&
                    String(j2['title']).toLowerCase() === String(j['title']).toLowerCase() &&
                    ['manual_applied', 'sent', 'replied', 'interview', 'offer'].includes(
                      String(a2['status']),
                    )
                  ) {
                    appliedCount++;
                  }
                }

                results.push({
                  application_id: a['id'],
                  job_id: a['job_id'],
                  channel: a['channel'],
                  status: a['status'],
                  notes: a['notes'],
                  validator_errors: a['validator_errors'],
                  snoozed_until: a['snoozed_until'],
                  title: j['title'],
                  company: j['company'],
                  company_normalized: j['company_normalized'],
                  source: j['source'],
                  location: j['location'],
                  remote: j['remote'],
                  salary_raw: j['salary_raw'],
                  salary_min: j['salary_min'],
                  salary_max: j['salary_max'],
                  currency: j['currency'],
                  match_score: j['match_score'],
                  apply_route: j['apply_route'],
                  route_reason: j['route_reason'],
                  untrusted: j['untrusted'],
                  posted_at: j['posted_at'],
                  fetched_at: j['fetched_at'],
                  applied_count: appliedCount,
                });
              }
            }
            results.sort(
              (x, y) =>
                ((y as Record<string, number>)['match_score'] ?? 0) -
                ((x as Record<string, number>)['match_score'] ?? 0),
            );
            return { results: results as T[] };
          }
          if (query.includes('FROM applications') && query.includes("status = 'manual_pending'")) {
            const cutoffIso = String(boundParams[0]);
            const results = Array.from(applications.values()).filter(
              (a) =>
                a['status'] === 'manual_pending' &&
                String(a['updated_at'] || a['created_at']) < cutoffIso,
            );
            return { results: results as unknown as T[] };
          }
          return { results: [] };
        },
        async run() {
          if (query.startsWith('UPDATE applications SET')) {
            if (query.includes('status = ?, updated_at = ? WHERE id = ?')) {
              const [newStatus, nowIso, id] = boundParams as [string, string, string];
              const a = applications.get(id);
              if (a) {
                a['status'] = newStatus;
                a['updated_at'] = nowIso;
              }
            } else if (query.includes('applied_at = ?')) {
              const [appliedAt, notes, nowIso, id] = boundParams as [
                string,
                string,
                string,
                string,
              ];
              const a = applications.get(id);
              if (a) {
                a['applied_at'] = appliedAt;
                a['notes'] = notes;
                a['synced_at'] = null; // Marked for sheet sync
                a['updated_at'] = nowIso;
              }
            } else if (query.includes('notes = ?, updated_at = ? WHERE id = ?')) {
              const [notes, nowIso, id] = boundParams as [string, string, string];
              const a = applications.get(id);
              if (a) {
                a['notes'] = notes;
                a['updated_at'] = nowIso;
              }
            } else if (query.includes('snoozed_until = ?, updated_at = ? WHERE id = ?')) {
              const [snoozedUntil, nowIso, id] = boundParams as [string, string, string];
              const a = applications.get(id);
              if (a) {
                a['snoozed_until'] = snoozedUntil;
                a['updated_at'] = nowIso;
              }
            } else if (query.includes("channel = 'email'")) {
              const [nowIso, id] = boundParams as [string, string];
              const a = applications.get(id);
              if (a) {
                a['channel'] = 'email';
                a['updated_at'] = nowIso;
              }
            }
          } else if (query.startsWith('INSERT INTO companies_contacted')) {
            const [comp, lastContact] = boundParams as [string, string];
            companiesContacted.set(comp, {
              company_normalized: comp,
              last_contacted_at: lastContact,
              last_channel: 'manual',
            });
          } else if (query.startsWith('INSERT INTO events')) {
            const [id, entity, entity_id, type, payload, created_at] = boundParams as string[];
            events.push({
              id: id ?? '',
              entity: entity ?? '',
              entity_id: entity_id ?? '',
              type: type ?? '',
              payload: payload ?? '',
              created_at: created_at ?? '',
            });
          }
          return { success: true };
        },
      };
      return statement;
    },
    async batch(stmts: Array<{ run: () => Promise<unknown> }>) {
      for (const s of stmts) {
        await s.run();
      }
      return [];
    },
  };

  return { db, jobs, applications, resumes, companiesContacted, doNotContact, events };
}

describe('Phase 6: Manual Apply Workflow (Queue, Kit, Actions & Housekeeping)', () => {
  it('every manual_portal and manual_review job gets an application and kit', async () => {
    const { db, jobs, applications, resumes } = createMockDb();

    jobs.set('job-1', {
      id: 'job-1',
      title: 'Senior Frontend Engineer',
      company: 'Acme Corp',
      company_normalized: 'acme corp',
      source: 'remoteok',
      location: 'Remote',
      salary_raw: '$140k - $160k',
      apply_url: 'https://acme.com/apply/1',
      description: 'Build user interfaces with TypeScript.',
      match_score: 92,
      match_reasons: JSON.stringify({
        matched_skills: ['TypeScript', 'UI'],
        missing_skills: [],
      }),
      red_flags: JSON.stringify([]),
      apply_route: 'manual_portal',
      route_reason: 'NO_EMAIL_FORM',
      untrusted: 0,
      posted_at: new Date().toISOString(),
      fetched_at: new Date().toISOString(),
    });

    resumes.set('res-1', {
      id: 'res-1',
      label: 'Standard Resume',
    });

    applications.set('app-1', {
      id: 'app-1',
      job_id: 'job-1',
      channel: 'manual',
      status: 'manual_pending',
      resume_id: 'res-1',
      cover_letter: 'Grounded cover letter text',
      subject: 'Application for Senior Frontend Engineer',
      notes: null,
      validator_errors: null,
      snoozed_until: null,
      updated_at: new Date().toISOString(),
    });

    // 1. Fetch Queue
    const queue = await getManualQueue(db, { profile: mockProfile });
    expect(queue.counts.total).toBe(1);
    expect(queue.items[0]?.title).toBe('Senior Frontend Engineer');
    expect(queue.items[0]?.status).toBe('manual_pending');

    // 2. Fetch Kit
    const kit = await getManualKit(db, 'app-1', mockProfile);
    expect(kit).not.toBeNull();
    expect(kit?.title).toBe('Senior Frontend Engineer');
    expect(kit?.company).toBe('Acme Corp');
    expect(kit?.apply_url).toBe('https://acme.com/apply/1');
    expect(kit?.apply_domain).toBe('acme.com');
    expect(kit?.cover_letter).toBe('Grounded cover letter text');
    expect(kit?.resume?.download_url).toBe('/api/resumes/res-1/download');
    expect(kit?.answers.notice_period).toBe('2 weeks');
    expect(kit?.matched_skills).toContain('TypeScript');
    expect(kit?.route_reason_explained).toBe('No contact email in posting; apply via portal form');
  });

  it('rejects javascript: apply URL and returns null domain', async () => {
    const { db, jobs, applications } = createMockDb();

    jobs.set('job-xss', {
      id: 'job-xss',
      title: 'Engineer',
      company: 'Evil Corp',
      apply_url: 'javascript:alert(1)',
      description: 'Testing malicious URL.',
      posted_at: new Date().toISOString(),
      fetched_at: new Date().toISOString(),
    });

    applications.set('app-xss', {
      id: 'app-xss',
      job_id: 'job-xss',
      channel: 'manual',
      status: 'manual_pending',
      updated_at: new Date().toISOString(),
    });

    const kit = await getManualKit(db, 'app-xss', mockProfile);
    expect(kit?.apply_url).toBeNull();
    expect(kit?.apply_domain).toBeNull();
  });

  it('marks applied: sets manual_applied, sets applied_at, updates companies_contacted, writes event, flags sheet sync; idempotent on second call', async () => {
    const { db, jobs, applications, companiesContacted, events } = createMockDb();
    const nowMs = Date.now();

    jobs.set('job-apply', {
      id: 'job-apply',
      title: 'Backend Engineer',
      company: 'Stripe Inc',
      company_normalized: 'stripe inc',
      posted_at: new Date(nowMs).toISOString(),
      fetched_at: new Date(nowMs).toISOString(),
    });

    applications.set('app-apply', {
      id: 'app-apply',
      job_id: 'job-apply',
      channel: 'manual',
      status: 'manual_pending',
      notes: null,
      updated_at: new Date(nowMs).toISOString(),
    });

    // First call: marks applied
    const res1 = await markApplied({
      db,
      applicationId: 'app-apply',
      note: 'Submitted via greenhouse',
      nowMs,
    });
    expect(res1.success).toBe(true);
    expect(res1.already_applied).toBeUndefined();

    // Check application in DB
    const a1 = applications.get('app-apply');
    expect(a1?.['status']).toBe('manual_applied');
    expect(a1?.['applied_at']).toBeDefined();
    expect(a1?.['synced_at']).toBeNull(); // flagged for sheet sync
    expect(a1?.['notes']).toBe('Submitted via greenhouse');

    // Check companies_contacted
    const contact = companiesContacted.get('stripe inc');
    expect(contact?.['last_channel']).toBe('manual');
    expect(contact?.['last_contacted_at']).toBe(a1?.['applied_at']);

    // Check events
    const statusEvents = events.filter((e) => e.type === 'status_change');
    expect(statusEvents.length).toBe(1);

    // Calling it again: idempotent, does not write a second event
    const res2 = await markApplied({
      db,
      applicationId: 'app-apply',
      nowMs,
    });
    expect(res2.success).toBe(true);
    expect(res2.already_applied).toBe(true);
    expect(events.filter((e) => e.type === 'status_change').length).toBe(1);
  });

  it('skip stores the reason and removes item from queue', async () => {
    const { db, applications } = createMockDb();

    applications.set('app-skip', {
      id: 'app-skip',
      job_id: 'job-1',
      channel: 'manual',
      status: 'manual_pending',
      notes: null,
      updated_at: new Date().toISOString(),
    });

    const res = await skipManualApplication({
      db,
      applicationId: 'app-skip',
      reason: 'SALARY_TOO_LOW',
    });
    expect(res.success).toBe(true);

    const a = applications.get('app-skip');
    expect(a?.['status']).toBe('manual_skipped');
    expect(a?.['notes']).toBe('SALARY_TOO_LOW');
  });

  it('snooze hides the item from the queue and reappears after N days', async () => {
    const { db, jobs, applications } = createMockDb();
    const nowMs = 1700000000000;

    jobs.set('job-snooze', {
      id: 'job-snooze',
      title: 'DevOps Engineer',
      company: 'Cloud Corp',
      company_normalized: 'cloud corp',
      posted_at: new Date(nowMs).toISOString(),
      fetched_at: new Date(nowMs).toISOString(),
    });

    applications.set('app-snooze', {
      id: 'app-snooze',
      job_id: 'job-snooze',
      channel: 'manual',
      status: 'manual_pending',
      snoozed_until: null,
      updated_at: new Date(nowMs).toISOString(),
    });

    // Snooze for 3 days
    await snoozeManualApplication({
      db,
      applicationId: 'app-snooze',
      days: 3,
      nowMs,
    });

    // 1. Immediately after snooze (Day 0): item is hidden from active queue
    const queueDay0 = await getManualQueue(db, { nowMs });
    expect(queueDay0.items.length).toBe(0);
    expect(queueDay0.counts.snoozed).toBe(1);

    // 2. Day 2: Still hidden
    const queueDay2 = await getManualQueue(db, { nowMs: nowMs + 2 * 24 * 60 * 60 * 1000 });
    expect(queueDay2.items.length).toBe(0);

    // 3. Day 4: Reappears in the queue!
    const queueDay4 = await getManualQueue(db, { nowMs: nowMs + 4 * 24 * 60 * 60 * 1000 });
    expect(queueDay4.items.length).toBe(1);
    expect(queueDay4.items[0]?.application_id).toBe('app-snooze');
  });

  it('send-by-email: rejects without contact email, rejects on DNC, rejects guessed/freemail without confirm_risk, and approves when valid', async () => {
    const { db, jobs, applications, doNotContact } = createMockDb();
    const nowMs = Date.now();

    // 1. Job with no contact email -> Rejected
    jobs.set('job-no-email', {
      id: 'job-no-email',
      company: 'Acme',
      contact_email: null,
    });
    applications.set('app-no-email', {
      id: 'app-no-email',
      job_id: 'job-no-email',
      channel: 'manual',
      status: 'needs_review',
    });
    await expect(sendByEmail({ db, applicationId: 'app-no-email', nowMs })).rejects.toThrow(
      'no contact email',
    );

    // 2. Job with DNC email -> Rejected
    doNotContact.add('bad-recruiter@spam.com');
    jobs.set('job-dnc', {
      id: 'job-dnc',
      company: 'Spam Corp',
      contact_email: 'bad-recruiter@spam.com',
    });
    applications.set('app-dnc', {
      id: 'app-dnc',
      job_id: 'job-dnc',
      channel: 'manual',
      status: 'needs_review',
    });
    await expect(sendByEmail({ db, applicationId: 'app-dnc', nowMs })).rejects.toThrow(
      'do_not_contact',
    );

    // 3. Guessed email without confirm_risk -> Rejected
    jobs.set('job-guessed', {
      id: 'job-guessed',
      company: 'Acme',
      contact_email: 'careers@acme.com',
      contact_source: 'guessed',
    });
    applications.set('app-guessed', {
      id: 'app-guessed',
      job_id: 'job-guessed',
      channel: 'manual',
      status: 'needs_review',
    });
    await expect(
      sendByEmail({ db, applicationId: 'app-guessed', confirmRisk: false, nowMs }),
    ).rejects.toThrow('requires confirm_risk=true');

    // 4. Guessed email with confirm_risk=true -> Allowed!
    const resGuessed = await sendByEmail({
      db,
      applicationId: 'app-guessed',
      confirmRisk: true,
      nowMs,
    });
    expect(resGuessed.success).toBe(true);
    const aGuessed = applications.get('app-guessed');
    expect(aGuessed?.['channel']).toBe('email');
    expect(aGuessed?.['status']).toBe('approved');

    // 5. Normal verified corporate email from posting -> Allowed without confirm_risk!
    jobs.set('job-ok', {
      id: 'job-ok',
      company: 'Cloud Corp',
      contact_email: 'hiring@cloudcorp.com',
      contact_source: 'posting',
      route_reason: 'OK',
    });
    applications.set('app-ok', {
      id: 'app-ok',
      job_id: 'job-ok',
      channel: 'manual',
      status: 'needs_review',
    });
    const resOk = await sendByEmail({
      db,
      applicationId: 'app-ok',
      nowMs,
    });
    expect(resOk.success).toBe(true);
    const aOk = applications.get('app-ok');
    expect(aOk?.['channel']).toBe('email');
    expect(aOk?.['status']).toBe('approved');
  });

  it('bulk actions only touch manual_pending items and ignore others', async () => {
    const { db, jobs, applications } = createMockDb();

    jobs.set('job-1', { id: 'job-1', company_normalized: 'c1' });
    jobs.set('job-2', { id: 'job-2', company_normalized: 'c2' });
    jobs.set('job-3', { id: 'job-3', company_normalized: 'c3' });

    applications.set('app-pending-1', {
      id: 'app-pending-1',
      job_id: 'job-1',
      channel: 'manual',
      status: 'manual_pending',
    });
    applications.set('app-needs-review', {
      id: 'app-needs-review',
      job_id: 'job-2',
      channel: 'manual',
      status: 'needs_review', // Should be skipped in bulk
    });
    applications.set('app-pending-2', {
      id: 'app-pending-2',
      job_id: 'job-3',
      channel: 'manual',
      status: 'manual_pending',
    });

    const result = await bulkManualAction({
      db,
      ids: ['app-pending-1', 'app-needs-review', 'app-pending-2'],
      action: 'applied',
    });

    expect(result.processed).toEqual(['app-pending-1', 'app-pending-2']);
    expect(result.skipped).toEqual(['app-needs-review']);

    expect(applications.get('app-pending-1')?.['status']).toBe('manual_applied');
    expect(applications.get('app-pending-2')?.['status']).toBe('manual_applied');
    expect(applications.get('app-needs-review')?.['status']).toBe('needs_review'); // Untouched
  });

  it('records outcomes for manually applied items', async () => {
    const { db, applications } = createMockDb();

    applications.set('app-applied-1', {
      id: 'app-applied-1',
      status: 'manual_applied',
    });

    await recordOutcome({
      db,
      applicationId: 'app-applied-1',
      status: 'interview',
    });

    expect(applications.get('app-applied-1')?.['status']).toBe('interview');
  });

  it('expiry housekeeping job moves 30-day-old manual_pending to manual_skipped(EXPIRED) and leaves newer ones alone', async () => {
    const { db, applications } = createMockDb();
    const nowMs = 1700000000000;
    const fortyDaysAgo = new Date(nowMs - 40 * 24 * 60 * 60 * 1000).toISOString();
    const tenDaysAgo = new Date(nowMs - 10 * 24 * 60 * 60 * 1000).toISOString();

    // Stale item (40 days old)
    applications.set('app-stale', {
      id: 'app-stale',
      status: 'manual_pending',
      updated_at: fortyDaysAgo,
    });

    // Fresh item (10 days old)
    applications.set('app-fresh', {
      id: 'app-fresh',
      status: 'manual_pending',
      updated_at: tenDaysAgo,
    });

    const result = await expireStaleManualPending(db, nowMs);

    expect(result.expired_count).toBe(1);
    expect(result.expired_ids).toEqual(['app-stale']);

    expect(applications.get('app-stale')?.['status']).toBe('manual_skipped');
    expect(applications.get('app-stale')?.['notes']).toBe('EXPIRED');

    expect(applications.get('app-fresh')?.['status']).toBe('manual_pending'); // untouched
  });

  it('todays focus respects the daily target and match score sort order', async () => {
    const { db, jobs, applications } = createMockDb();
    const nowMs = Date.now();

    // Create 4 jobs with different scores
    const scores = [65, 95, 80, 88];
    scores.forEach((score, idx) => {
      const jobId = `job-${idx}`;
      const appId = `app-${idx}`;
      jobs.set(jobId, {
        id: jobId,
        title: `Engineer ${idx}`,
        company: `Company ${idx}`,
        company_normalized: `company ${idx}`,
        match_score: score,
        posted_at: new Date(nowMs).toISOString(),
        fetched_at: new Date(nowMs).toISOString(),
      });
      applications.set(appId, {
        id: appId,
        job_id: jobId,
        channel: 'manual',
        status: 'manual_pending',
        updated_at: new Date(nowMs).toISOString(),
      });
    });

    // mockProfile has manual_daily_target = 2
    const queue = await getManualQueue(db, { profile: mockProfile, nowMs });

    expect(queue.counts.total).toBe(4);
    expect(queue.todays_focus.length).toBe(2); // Capped at manual_daily_target = 2
    // Top 2 by score should be 95 and 88
    expect(queue.todays_focus[0]?.match_score).toBe(95);
    expect(queue.todays_focus[1]?.match_score).toBe(88);
  });

  it('flags jobs older than 14 days as may_be_closed and warns about duplicate applications', async () => {
    const { db, jobs, applications } = createMockDb();
    const nowMs = 1700000000000;
    const twentyDaysAgo = new Date(nowMs - 20 * 24 * 60 * 60 * 1000).toISOString();

    // Previous application to Acme Corp for 'Systems Engineer' was applied
    jobs.set('job-prev', {
      id: 'job-prev',
      title: 'Systems Engineer',
      company: 'Acme Corp',
      company_normalized: 'acme corp',
      posted_at: twentyDaysAgo,
      fetched_at: twentyDaysAgo,
    });
    applications.set('app-prev', {
      id: 'app-prev',
      job_id: 'job-prev',
      channel: 'manual',
      status: 'manual_applied',
      updated_at: twentyDaysAgo,
    });

    // New job: also Acme Corp for 'Systems Engineer', posted 20 days ago
    jobs.set('job-new', {
      id: 'job-new',
      title: 'Systems Engineer',
      company: 'Acme Corp',
      company_normalized: 'acme corp',
      posted_at: twentyDaysAgo,
      fetched_at: twentyDaysAgo,
    });
    applications.set('app-new', {
      id: 'app-new',
      job_id: 'job-new',
      channel: 'manual',
      status: 'manual_pending',
      updated_at: twentyDaysAgo,
    });

    const queue = await getManualQueue(db, { nowMs });
    const item = queue.items.find((i) => i.application_id === 'app-new');

    expect(item?.may_be_closed).toBe(true); // > 14 days old
    expect(item?.applied_before_warning).toBe(true); // Same company and title already applied
  });

  it('sends daily digest notification with count and top 5 items', async () => {
    const { db, jobs, applications } = createMockDb();
    const notifier = new EventsNotifier(db);
    const notifySpy = vi.spyOn(notifier, 'notify');

    jobs.set('job-d1', {
      id: 'job-d1',
      title: 'Systems Architect',
      company: 'Cloud Corp',
      company_normalized: 'cloud corp',
      match_score: 94,
      posted_at: new Date().toISOString(),
      fetched_at: new Date().toISOString(),
    });
    applications.set('app-d1', {
      id: 'app-d1',
      job_id: 'job-d1',
      channel: 'manual',
      status: 'manual_pending',
      updated_at: new Date().toISOString(),
    });

    const result = await sendManualDailyDigest({ db, notifier });

    expect(result.waiting_count).toBe(1);
    expect(result.top_5.length).toBe(1);
    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect(notifySpy.mock.calls[0]?.[0]).toMatchObject({
      key: expect.stringContaining('manual_queue_digest'),
      message: expect.stringContaining('Total active applications waiting: 1'),
    });
  });
});
