import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { D1LikeDatabase } from '../state-machine.js';
import type { KVLike } from '../google/auth.js';
import { setGoogleAuthHealth } from '../google/auth.js';
import {
  SHEET_COLUMNS,
  sanitizeSheetCell,
  formatSalaryForSheet,
  formatDateForSheet,
  formatApplicationRow,
} from './sanitizer.js';
import { RestSheetsClient } from './client.js';
import { syncApplicationsToSheet } from './sync.js';
import type { SheetsClient, ApplicationToSync } from './types.js';

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

interface MockApplicationRecord {
  id: string;
  job_id: string;
  kind: string;
  channel: 'email' | 'manual';
  resume_id?: string | null;
  status: string;
  applied_at?: string | null;
  sent_at?: string | null;
  scheduled_at?: string | null;
  updated_at: string;
  synced_at?: string | null;
  notes?: string | null;
}

interface MockJobRecord {
  id: string;
  title: string;
  company: string;
  source: string;
  apply_url?: string | null;
  location?: string | null;
  salary_raw?: string | null;
  salary_min?: number | null;
  salary_max?: number | null;
  currency?: string | null;
  contact_email?: string | null;
  match_score?: number | null;
  route_reason?: string | null;
}

interface MockResumeRecord {
  id: string;
  label: string;
}

function createMockDb(initialApps?: MockApplicationRecord[], initialJobs?: MockJobRecord[]) {
  const applications = new Map<string, MockApplicationRecord>();
  const jobs = new Map<string, MockJobRecord>();
  const resumes = new Map<string, MockResumeRecord>();
  const events: Array<{ type: string; payload: string }> = [];

  for (const app of initialApps || []) {
    applications.set(app.id, { ...app });
  }
  for (const job of initialJobs || []) {
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
          if (query.includes('FROM applications') && query.includes('WHERE id = ?')) {
            const id = String(boundParams[0]);
            return (applications.get(id) ?? null) as unknown as T;
          }
          return null;
        },
        async all<T>(): Promise<{ results: T[] }> {
          if (query.includes('FROM applications a') && query.includes('JOIN jobs j')) {
            const results: unknown[] = [];
            for (const app of applications.values()) {
              const needsSync = !app.synced_at || app.updated_at > app.synced_at;
              if (needsSync) {
                const job = jobs.get(app.job_id) || {
                  id: app.job_id,
                  title: 'Unknown Role',
                  company: 'Unknown Co',
                  source: 'adzuna',
                };
                const resume = app.resume_id ? resumes.get(app.resume_id) : undefined;
                results.push({
                  id: app.id,
                  job_id: app.job_id,
                  kind: app.kind,
                  channel: app.channel,
                  resume_id: app.resume_id,
                  resume_label: resume?.label ?? null,
                  status: app.status,
                  applied_at: app.applied_at ?? null,
                  sent_at: app.sent_at ?? null,
                  scheduled_at: app.scheduled_at ?? null,
                  updated_at: app.updated_at,
                  notes: app.notes ?? null,
                  title: job.title,
                  company: job.company,
                  source: job.source,
                  apply_url: job.apply_url ?? null,
                  location: job.location ?? null,
                  salary_raw: job.salary_raw ?? null,
                  salary_min: job.salary_min ?? null,
                  salary_max: job.salary_max ?? null,
                  currency: job.currency ?? null,
                  contact_email: job.contact_email ?? null,
                  match_score: job.match_score ?? null,
                  route_reason: job.route_reason ?? null,
                });
              }
            }
            // Sort by updated_at ASC
            results.sort((a, b) => {
              const aUp = (a as { updated_at: string }).updated_at;
              const bUp = (b as { updated_at: string }).updated_at;
              return aUp.localeCompare(bUp);
            });
            return { results: results as T[] };
          }
          return { results: [] };
        },
        async run() {
          if (query.includes('UPDATE applications SET synced_at = ? WHERE id = ?')) {
            const syncedAt = String(boundParams[0]);
            const id = String(boundParams[1]);
            const app = applications.get(id);
            if (app) {
              app.synced_at = syncedAt;
            }
            return { changes: 1 };
          }
          if (query.includes('INSERT INTO events')) {
            const type = query.includes('sheet_sync_failed')
              ? 'sheet_sync_failed'
              : String(boundParams[3] || boundParams[1] || 'event');
            const payload = String(boundParams[0] || boundParams[1] || '{}');
            events.push({ type, payload });
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

  return { db, applications, jobs, resumes, events };
}

function createMockSheetsClient(initialColA: string[] = ['Application ID']) {
  const sheetRows = new Map<string, unknown[]>(); // range -> values
  let colA = [...initialColA];
  let ensureSheetCalls = 0;
  let readRowKeysCalls = 0;
  let batchUpdateCalls = 0;
  const batchUpdatePayloads: Array<{ range: string; values: unknown[][] }> = [];

  const client: SheetsClient = {
    async ensureSheet() {
      ensureSheetCalls++;
      return { spreadsheetId: 'mock-sheet-123', sheetId: 0, created: false };
    },
    async readRowKeys() {
      readRowKeysCalls++;
      return colA;
    },
    async batchUpdateValues(options) {
      batchUpdateCalls++;
      for (const item of options.data) {
        batchUpdatePayloads.push(item);
        sheetRows.set(item.range, item.values[0] || []);

        // Also track column A for new rows
        const val = item.values[0]?.[0];
        if (val !== undefined && val !== null) {
          const id = String(val);
          if (!colA.includes(id)) {
            colA.push(id);
          }
        }
      }
      return { updatedRows: options.data.length };
    },
    async appendValues(options) {
      for (const row of options.values) {
        const id = String(row[0] || '');
        colA.push(id);
      }
      return { updatedRows: options.values.length };
    },
  };

  return {
    client,
    sheetRows,
    getColA: () => colA,
    setColA: (newColA: string[]) => {
      colA = newColA;
    },
    getCalls: () => ({
      ensureSheetCalls,
      readRowKeysCalls,
      batchUpdateCalls,
      batchUpdatePayloads,
    }),
  };
}

describe('Phase 8: Google Sheets One-Way Sync', () => {
  describe('Sanitizer & Formula Injection Security (Rule 9 & Prompt Task 3)', () => {
    it('prefixes formula triggers =, +, -, and @ with single quote so evil titles remain inert text', () => {
      // Prompt requirement: A title of =IMPORTXML("http://evil") is stored as inert text
      expect(sanitizeSheetCell('=IMPORTXML("http://evil")')).toBe('\'=IMPORTXML("http://evil")');
      expect(sanitizeSheetCell('+12345')).toBe("'+12345");
      expect(sanitizeSheetCell('-CMD|/c calc')).toBe("'-CMD|/c calc");
      expect(sanitizeSheetCell('@SUM(1,2)')).toBe("'@SUM(1,2)");
      expect(sanitizeSheetCell(' =IMPORTXML("http://evil")')).toBe('\' =IMPORTXML("http://evil")');
    });

    it('leaves safe strings, numbers and booleans intact', () => {
      expect(sanitizeSheetCell('Staff Software Engineer')).toBe('Staff Software Engineer');
      expect(sanitizeSheetCell('Stripe, Inc.')).toBe('Stripe, Inc.');
      expect(sanitizeSheetCell(95)).toBe(95);
      expect(sanitizeSheetCell(0)).toBe(0);
      expect(sanitizeSheetCell(true)).toBe('TRUE');
      expect(sanitizeSheetCell(false)).toBe('FALSE');
      expect(sanitizeSheetCell(null)).toBe('');
      expect(sanitizeSheetCell(undefined)).toBe('');
    });

    it('Missing salary renders as "Not listed"', () => {
      // Prompt requirement: Missing salary renders as "Not listed"
      expect(formatSalaryForSheet(null, null, null, null)).toBe('Not listed');
      expect(formatSalaryForSheet('', null, null, null)).toBe('Not listed');
      expect(formatSalaryForSheet('   ', null, null, null)).toBe('Not listed');
      expect(formatSalaryForSheet(undefined, undefined, undefined, undefined)).toBe('Not listed');
    });

    it('formats raw salary and numeric salary ranges properly', () => {
      expect(formatSalaryForSheet('$140,000 - $180,000', null, null, null)).toBe(
        '$140,000 - $180,000',
      );
      expect(formatSalaryForSheet(null, 120000, 160000, 'USD')).toBe('120,000 - 160,000 USD');
      expect(formatSalaryForSheet(null, 150000, null, 'USD')).toBe('150,000+ USD');
      expect(formatSalaryForSheet(null, null, 200000, 'EUR')).toBe('Up to 200,000 EUR');
    });

    it('formatDateForSheet extracts YYYY-MM-DD cleanly', () => {
      expect(formatDateForSheet('2026-11-05T12:00:00Z')).toBe('2026-11-05');
      expect(formatDateForSheet('2026-11-05')).toBe('2026-11-05');
      expect(formatDateForSheet(null)).toBe('');
    });

    it('formatApplicationRow builds exactly 17 sanitized columns in specified order', () => {
      const app: ApplicationToSync = {
        id: 'app-test-1',
        job_id: 'job-1',
        kind: 'initial',
        channel: 'email',
        title: '=IMPORTXML("http://evil")',
        company: 'Stripe',
        source: 'greenhouse',
        apply_url: 'https://stripe.com/jobs/1',
        location: 'Remote, US',
        salary_raw: null,
        contact_email: 'recruiter@stripe.com',
        resume_label: 'Core Resume',
        match_score: 92,
        route_reason: 'STRONG_MATCH',
        status: 'approved',
        applied_at: null,
        sent_at: '2026-11-05T14:30:00Z',
        scheduled_at: null,
        updated_at: '2026-11-05T14:30:00Z',
        notes: 'Priority application',
      };

      const row = formatApplicationRow(app);
      expect(row).toHaveLength(17);
      expect(SHEET_COLUMNS).toHaveLength(17);

      // Verify key columns
      expect(row[0]).toBe('app-test-1'); // Application ID
      expect(row[1]).toBe('2026-11-05'); // Date
      expect(row[2]).toBe('Stripe'); // Company
      expect(row[3]).toBe('\'=IMPORTXML("http://evil")'); // Role (inert text!)
      expect(row[4]).toBe('greenhouse'); // Source
      expect(row[5]).toBe('Email'); // Channel
      expect(row[6]).toBe('https://stripe.com/jobs/1'); // Job link
      expect(row[7]).toBe('Remote, US'); // Location
      expect(row[8]).toBe('Not listed'); // Salary
      expect(row[9]).toBe('recruiter@stripe.com'); // Contact email
      expect(row[10]).toBe('Core Resume'); // Resume used
      expect(row[11]).toBe(92); // Match score (number)
      expect(row[12]).toBe('STRONG_MATCH'); // Route reason
      expect(row[13]).toBe('approved'); // Status
      expect(row[14]).toBe('2026-11-05T14:30:00Z'); // Applied or sent at
      expect(row[15]).toBe('2026-11-05T14:30:00Z'); // Last updated
      expect(row[16]).toBe('Priority application'); // Notes
    });
  });

  describe('Sync Worker Logic & Tests', () => {
    let config: KVLike & { store: Map<string, string> };

    beforeEach(async () => {
      config = createMockKV();
      await setGoogleAuthHealth({ config, status: 'ok', reason: null });
    });

    it('A new emailed application appends a row with Channel=Email; a new manual one with Channel=Manual', async () => {
      const initialApps: MockApplicationRecord[] = [
        {
          id: 'app-email-1',
          job_id: 'job-1',
          kind: 'initial',
          channel: 'email',
          status: 'sent',
          sent_at: '2026-11-05T10:00:00Z',
          updated_at: '2026-11-05T10:00:00Z',
          synced_at: null,
        },
        {
          id: 'app-manual-1',
          job_id: 'job-2',
          kind: 'initial',
          channel: 'manual',
          status: 'manual_applied',
          applied_at: '2026-11-05T11:00:00Z',
          updated_at: '2026-11-05T11:00:00Z',
          synced_at: null,
        },
      ];

      const initialJobs: MockJobRecord[] = [
        {
          id: 'job-1',
          title: 'Staff Backend Engineer',
          company: 'Stripe',
          source: 'lever',
          contact_email: 'jobs@stripe.com',
          match_score: 95,
        },
        {
          id: 'job-2',
          title: 'Systems Lead',
          company: 'Linear',
          source: 'greenhouse',
          match_score: 88,
        },
      ];

      const { db, applications } = createMockDb(initialApps, initialJobs);
      const mockSheets = createMockSheetsClient(['Application ID']); // only header at row 1

      const result = await syncApplicationsToSheet({
        db,
        config,
        sheetsClient: mockSheets.client,
        spreadsheetId: 'sheet-123',
      });

      expect(result.success).toBe(true);
      expect(result.syncedCount).toBe(2);

      // Verify row 2 is the emailed app with Channel=Email
      const row2 = mockSheets.sheetRows.get('Applications!A2:Q2');
      expect(row2).toBeDefined();
      expect(row2?.[0]).toBe('app-email-1');
      expect(row2?.[5]).toBe('Email');

      // Verify row 3 is the manual app with Channel=Manual
      const row3 = mockSheets.sheetRows.get('Applications!A3:Q3');
      expect(row3).toBeDefined();
      expect(row3?.[0]).toBe('app-manual-1');
      expect(row3?.[5]).toBe('Manual');

      // Both applications now have synced_at set in D1
      expect(applications.get('app-email-1')?.synced_at).toBeTruthy();
      expect(applications.get('app-manual-1')?.synced_at).toBeTruthy();
    });

    it('A status change updates the same row rather than appending', async () => {
      // Row 1: Header
      // Row 2: app-1 already in the sheet with status 'draft'
      const initialApps: MockApplicationRecord[] = [
        {
          id: 'app-1',
          job_id: 'job-1',
          kind: 'initial',
          channel: 'email',
          status: 'approved', // Status changed to approved
          updated_at: '2026-11-05T12:00:00Z',
          synced_at: '2026-11-05T09:00:00Z', // updated_at > synced_at -> needs sync
        },
      ];

      const initialJobs: MockJobRecord[] = [
        {
          id: 'job-1',
          title: 'Infrastructure Engineer',
          company: 'Cloudflare',
          source: 'greenhouse',
        },
      ];

      const { db } = createMockDb(initialApps, initialJobs);
      // Sheet already contains 'app-1' at row 2
      const mockSheets = createMockSheetsClient(['Application ID', 'app-1']);

      const result = await syncApplicationsToSheet({
        db,
        config,
        sheetsClient: mockSheets.client,
        spreadsheetId: 'sheet-123',
      });

      expect(result.success).toBe(true);
      expect(result.syncedCount).toBe(1);

      // Verify it updated row 2 (NOT row 3!)
      const calls = mockSheets.getCalls();
      expect(calls.batchUpdatePayloads).toHaveLength(1);
      expect(calls.batchUpdatePayloads[0]?.range).toBe('Applications!A2:Q2');

      const updatedRow = mockSheets.sheetRows.get('Applications!A2:Q2');
      expect(updatedRow?.[0]).toBe('app-1');
      expect(updatedRow?.[13]).toBe('approved'); // Status column updated

      // No row 3 created
      expect(mockSheets.sheetRows.get('Applications!A3:Q3')).toBeUndefined();
    });

    it('Running sync twice makes no calls the second time', async () => {
      const initialApps: MockApplicationRecord[] = [
        {
          id: 'app-sync-1',
          job_id: 'job-1',
          kind: 'initial',
          channel: 'email',
          status: 'draft',
          updated_at: '2026-11-05T10:00:00Z',
          synced_at: null,
        },
      ];

      const initialJobs: MockJobRecord[] = [
        { id: 'job-1', title: 'Frontend Engineer', company: 'Vercel', source: 'ashby' },
      ];

      const { db } = createMockDb(initialApps, initialJobs);
      const mockSheets = createMockSheetsClient(['Application ID']);

      // First run: syncs 1 application
      const firstRun = await syncApplicationsToSheet({
        db,
        config,
        sheetsClient: mockSheets.client,
        spreadsheetId: 'sheet-123',
      });
      expect(firstRun.success).toBe(true);
      expect(firstRun.syncedCount).toBe(1);

      const callsAfterFirstRun = mockSheets.getCalls().batchUpdateCalls;
      expect(callsAfterFirstRun).toBe(1);

      // Second run: no pending applications (updated_at <= synced_at)
      const secondRun = await syncApplicationsToSheet({
        db,
        config,
        sheetsClient: mockSheets.client,
        spreadsheetId: 'sheet-123',
      });
      expect(secondRun.success).toBe(true);
      expect(secondRun.syncedCount).toBe(0);

      // Prompt requirement: Running sync twice makes no calls the second time
      const callsAfterSecondRun = mockSheets.getCalls().batchUpdateCalls;
      expect(callsAfterSecondRun).toBe(callsAfterFirstRun); // 0 additional calls!
    });

    it('A title of =IMPORTXML("http://evil") is stored as inert text', async () => {
      const initialApps: MockApplicationRecord[] = [
        {
          id: 'app-evil-title',
          job_id: 'job-evil',
          kind: 'initial',
          channel: 'email',
          status: 'draft',
          updated_at: '2026-11-05T10:00:00Z',
          synced_at: null,
        },
      ];

      const initialJobs: MockJobRecord[] = [
        {
          id: 'job-evil',
          title: '=IMPORTXML("http://evil")',
          company: '+CorpHack',
          source: 'adzuna',
        },
      ];

      const { db } = createMockDb(initialApps, initialJobs);
      const mockSheets = createMockSheetsClient(['Application ID']);

      const res = await syncApplicationsToSheet({
        db,
        config,
        sheetsClient: mockSheets.client,
        spreadsheetId: 'sheet-123',
      });

      expect(res.success).toBe(true);
      const row = mockSheets.sheetRows.get('Applications!A2:Q2');
      expect(row).toBeDefined();

      // Title is stored as inert text with apostrophe prefix
      expect(row?.[3]).toBe('\'=IMPORTXML("http://evil")');
      // Company also protected
      expect(row?.[2]).toBe("'+CorpHack");
    });

    it('Batch size is respected and 429 triggers backoff', async () => {
      const apps: MockApplicationRecord[] = [];
      const jobs: MockJobRecord[] = [];

      for (let i = 1; i <= 6; i++) {
        apps.push({
          id: `app-batch-${i}`,
          job_id: `job-batch-${i}`,
          kind: 'initial',
          channel: 'email',
          status: 'draft',
          updated_at: `2026-11-05T10:0${i}:00Z`,
          synced_at: null,
        });
        jobs.push({
          id: `job-batch-${i}`,
          title: `Role ${i}`,
          company: `Company ${i}`,
          source: 'adzuna',
        });
      }

      const { db } = createMockDb(apps, jobs);
      const mockSheets = createMockSheetsClient(['Application ID']);

      // Run with maxBatchSize = 2 (should create 3 batches: 2, 2, 2)
      const res = await syncApplicationsToSheet({
        db,
        config,
        sheetsClient: mockSheets.client,
        spreadsheetId: 'sheet-123',
        maxBatchSize: 2,
      });

      expect(res.success).toBe(true);
      expect(res.syncedCount).toBe(6);
      expect(mockSheets.getCalls().batchUpdateCalls).toBe(3);

      // Now verify RestSheetsClient handles 429 backoff
      let attempts = 0;
      const mockFetch = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts < 3) {
          return new Response(JSON.stringify({ error: { message: 'Quota exceeded' } }), {
            status: 429,
          });
        }
        return new Response(JSON.stringify({ totalUpdatedRows: 1 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const restClient = new RestSheetsClient(async () => 'mock-token', {
        fetchFn: mockFetch as unknown as typeof fetch,
        initialDelayMs: 5, // very fast for tests
        maxRetries: 3,
      });

      const updateRes = await restClient.batchUpdateValues({
        spreadsheetId: 'sheet-123',
        data: [{ range: 'Applications!A2:Q2', values: [['app-1']] }],
      });

      expect(updateRes.updatedRows).toBe(1);
      expect(attempts).toBe(3); // 2 rate limits backed off, 3rd succeeded
    });

    it('A sheet outage leaves records pending and a later run recovers every one of them', async () => {
      const initialApps: MockApplicationRecord[] = [
        {
          id: 'app-outage-1',
          job_id: 'job-1',
          kind: 'initial',
          channel: 'email',
          status: 'draft',
          updated_at: '2026-11-05T10:00:00Z',
          synced_at: null,
        },
        {
          id: 'app-outage-2',
          job_id: 'job-2',
          kind: 'initial',
          channel: 'manual',
          status: 'manual_pending',
          updated_at: '2026-11-05T10:05:00Z',
          synced_at: null,
        },
      ];

      const initialJobs: MockJobRecord[] = [
        { id: 'job-1', title: 'DevOps Lead', company: 'HashiCorp', source: 'greenhouse' },
        { id: 'job-2', title: 'SRE', company: 'Datadog', source: 'lever' },
      ];

      const { db, applications, events } = createMockDb(initialApps, initialJobs);

      // 1. Simulate Google Sheets outage on first run
      let failWrites = true;
      const faultyClient: SheetsClient = {
        async ensureSheet() {
          return { spreadsheetId: 'sheet-outage', sheetId: 0, created: false };
        },
        async readRowKeys() {
          return ['Application ID'];
        },
        async batchUpdateValues() {
          if (failWrites) {
            throw new Error('503 Service Unavailable: Google Sheets is temporarily down');
          }
          return { updatedRows: 2 };
        },
        async appendValues() {
          return { updatedRows: 2 };
        },
      };

      // Run 1: Outage
      const run1 = await syncApplicationsToSheet({
        db,
        config,
        sheetsClient: faultyClient,
        spreadsheetId: 'sheet-outage',
      });

      expect(run1.success).toBe(false);
      expect(run1.error).toContain('503 Service Unavailable');
      expect(run1.syncedCount).toBe(0);

      // Both records remain pending (synced_at is still null!)
      expect(applications.get('app-outage-1')?.synced_at).toBeNull();
      expect(applications.get('app-outage-2')?.synced_at).toBeNull();

      // Event was logged
      expect(events.some((e) => e.type === 'sheet_sync_failed')).toBe(true);

      // 2. Outage resolved on second run
      failWrites = false;

      const run2 = await syncApplicationsToSheet({
        db,
        config,
        sheetsClient: faultyClient,
        spreadsheetId: 'sheet-outage',
      });

      // Prompt requirement: A later run recovers every one of them
      expect(run2.success).toBe(true);
      expect(run2.syncedCount).toBe(2);

      // Both records are now marked as synced
      expect(applications.get('app-outage-1')?.synced_at).toBeTruthy();
      expect(applications.get('app-outage-2')?.synced_at).toBeTruthy();
    });

    it('While auth health is invalid no Sheets calls are made', async () => {
      // Set auth health to invalid
      await setGoogleAuthHealth({
        config,
        status: 'invalid',
        reason: 'invalid_grant: Token expired or revoked',
      });

      const initialApps: MockApplicationRecord[] = [
        {
          id: 'app-invalid-auth',
          job_id: 'job-1',
          kind: 'initial',
          channel: 'email',
          status: 'draft',
          updated_at: '2026-11-05T10:00:00Z',
          synced_at: null,
        },
      ];

      const initialJobs: MockJobRecord[] = [
        { id: 'job-1', title: 'Lead Architect', company: 'AWS', source: 'adzuna' },
      ];

      const { db, applications } = createMockDb(initialApps, initialJobs);
      const mockSheets = createMockSheetsClient(['Application ID']);

      const res = await syncApplicationsToSheet({
        db,
        config,
        sheetsClient: mockSheets.client,
        spreadsheetId: 'sheet-123',
      });

      // Prompt requirement: While auth health is invalid no Sheets calls are made
      expect(res.success).toBe(false);
      expect(res.paused).toBe(true);
      expect(res.reason).toContain('auth_invalid');

      // Verify ZERO calls made to SheetsClient
      const calls = mockSheets.getCalls();
      expect(calls.ensureSheetCalls).toBe(0);
      expect(calls.readRowKeysCalls).toBe(0);
      expect(calls.batchUpdateCalls).toBe(0);

      // Application remains pending
      expect(applications.get('app-invalid-auth')?.synced_at).toBeNull();
    });
  });
});
