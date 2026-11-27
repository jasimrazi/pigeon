import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';

// Suppress React 19 test environment warning
// @ts-expect-error global IS_REACT_ACT_ENVIRONMENT flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Polyfill localStorage for Node 22+ happy-dom compatibility
if (!globalThis.localStorage || typeof globalThis.localStorage.setItem !== 'function') {
  let store: Record<string, string> = {};
  const mockStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, val: string) => {
      store[key] = String(val);
    },
    removeItem: (key: string) => {
      Reflect.deleteProperty(store, key);
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: mockStorage,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(window, 'localStorage', {
    value: mockStorage,
    configurable: true,
    writable: true,
  });
}

describe('Dashboard App & Operations Components', () => {
  let container: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;

  beforeEach(() => {
    localStorage.setItem('pigeon_admin_token', 'mock-owner-token');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    // Mock global fetch for API endpoints
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const u = url.toString();

        if (u.includes('/api/overview')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              sendsToday: 3,
              effectiveCap: 15,
              dailyCap: 20,
              bounceRate: 0,
              failureRate: 0,
              jobsByStatus: { routed: 5, draft: 2 },
              jobsByRoute: { auto_email: 2, manual_portal: 3 },
              manualWaitingCount: 4,
              authHealth: { status: 'ok', reason: null, checked_at: new Date().toISOString() },
              dryRun: true,
              killSwitch: false,
            }),
          });
        }

        if (u.includes('/api/review-queue')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              ok: true,
              items: [
                {
                  id: 'app-review-1',
                  job_id: 'job-1',
                  status: 'draft',
                  cover_letter:
                    'Dear Acme, I am excited about Senior Engineer. Sincerely, Alex Mercer',
                  subject: 'Application for Senior Engineer',
                  resume_id: 'resume-1',
                  resume_label: 'Main Resume',
                  validator_errors: JSON.stringify([
                    'Cover letter is too short (11 words; minimum is 150).',
                  ]),
                  updated_at: new Date().toISOString(),
                  title: 'Senior Engineer',
                  company: 'Acme Corp',
                  location: 'Remote',
                  salary_raw: '$160k',
                  description: 'Engineering description for Acme Corp',
                  apply_url: 'https://acme.com/jobs/1',
                  contact_email: 'jobs@acme.com',
                  contact_source: 'posting',
                  match_score: 92,
                  match_reasons: 'Strong skill overlap',
                  red_flags: [],
                  untrusted: false,
                  route_reason: 'AUTO_EMAIL_CONTACT',
                  is_safe_for_bulk: true,
                },
              ],
            }),
          });
        }

        if (u.includes('/api/resumes')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              resumes: [
                { id: 'resume-1', label: 'Main Resume', tags: ['Backend'], is_default: true },
              ],
            }),
          });
        }

        if (u.includes('/api/manual')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              ok: true,
              items: [],
              todays_focus: [],
              needs_attention: [],
              total_waiting: 0,
              target: 10,
            }),
          });
        }

        if (u.includes('/api/applications')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              ok: true,
              applications: [
                {
                  id: 'app-app-1',
                  job_id: 'job-1',
                  kind: 'initial',
                  channel: 'email',
                  status: 'sent',
                  cover_letter: null,
                  subject: null,
                  sent_at: new Date().toISOString(),
                  applied_at: null,
                  outcome: null,
                  outcome_at: null,
                  notes: null,
                  updated_at: new Date().toISOString(),
                  title: 'Senior Engineer',
                  company: 'Acme Corp',
                  source: 'greenhouse',
                  location: 'Remote',
                  match_score: 92,
                  contact_email: 'jobs@acme.com',
                  apply_url: null,
                },
              ],
            }),
          });
        }

        if (u.includes('/api/sources')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              ok: true,
              sources: [
                {
                  name: 'greenhouse',
                  kind: 'ats',
                  circuit_state: 'closed',
                  failure_count: 0,
                  last_run: new Date().toISOString(),
                  last_error: null,
                },
                {
                  name: 'linkedin',
                  kind: 'alert_email',
                  circuit_state: 'closed',
                  failure_count: 0,
                  last_run: new Date().toISOString(),
                  last_error: null,
                  parser_empty_streak: 4,
                  is_suspect: true,
                },
              ],
            }),
          });
        }

        if (u.includes('/api/alerts/sync') && init?.method === 'POST') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              ok: true,
              processed: 2,
              routed: 1,
              filtered: 1,
              skipped: 0,
            }),
          });
        }

        if (u.includes('/api/jobs')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              ok: true,
              jobs: [
                {
                  id: 'job-mail-1',
                  dedupe_key: 'dedupe-whatjobs-1',
                  source: 'whatjobs',
                  source_kind: 'alert_email',
                  source_job_id: 'wj-101',
                  title: 'Flutter Developer',
                  company: 'Acme Mobile',
                  location: 'Bengaluru, India',
                  remote: true,
                  salary_raw: '₹15,00,000 - ₹20,00,000',
                  description: 'Looking for a talented Flutter and Dart developer.',
                  apply_url: 'https://whatjobs.com/apply/101',
                  contact_email: 'hiring@acmemobile.com',
                  contact_source: 'posting',
                  posted_at: new Date().toISOString(),
                  fetched_at: new Date().toISOString(),
                  status: 'routed',
                  filter_reason: null,
                  match_score: 88,
                  match_reasons: JSON.stringify(['Strong Flutter/Dart experience', 'Remote role fits preferences']),
                  red_flags: JSON.stringify([]),
                  apply_route: 'auto_email',
                  route_reason: 'AUTO_EMAIL_CONTACT',
                  updated_at: new Date().toISOString(),
                },
              ],
              total: 1,
            }),
          });
        }

        if (u.includes('/api/settings/kill-switch') && init?.method === 'POST') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ ok: true, killSwitch: true }),
          });
        }

        if (u.includes('/api/settings')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              ok: true,
              profile: {
                name: 'Alex Mercer',
                email: 'alex@example.com',
                skills: ['TypeScript', 'Cloudflare Workers'],
                send_settings: {
                  daily_cap: 20,
                  ramp_base: 5,
                  ramp_step: 2,
                  window: { start: '09:00', end: '18:00' },
                  timezone: 'UTC',
                  auto_approve_above_score: 85,
                },
                filters: { titles: ['Engineer'], company_blacklist: [] },
              },
              dryRun: true,
              killSwitch: false,
            }),
          });
        }

        if (u.includes('/api/events') || u.includes('/api/audit-logs')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              ok: true,
              events: [
                {
                  id: 'evt-1',
                  entity: 'settings',
                  entity_id: 'kill_switch',
                  type: 'kill_switch_toggled',
                  payload: { kill_switch: true },
                  created_at: new Date().toISOString(),
                },
              ],
            }),
          });
        }

        return Promise.reject(new Error(`Unhandled mock fetch URL: ${u}`));
      }),
    );
  });

  afterEach(() => {
    localStorage.clear();
    if (root && container) {
      act(() => {
        root?.unmount();
      });
      container.remove();
    }
    vi.restoreAllMocks();
  });

  it('renders top navigation and default overview with system metrics', async () => {
    await act(async () => {
      root?.render(<App />);
    });

    expect(container?.textContent).toContain('Pigeon');
    expect(container?.textContent).toContain("Today's Sends");
    expect(container?.textContent).toContain('Bounce Rate');
    expect(container?.textContent).toContain('24h Failure Rate');
    expect(container?.textContent).toContain('Manual Queue');
    expect(container?.textContent).toContain('Google Auth Health: Connected & Healthy');
  });

  it('navigates to Review Queue and displays draft items with validator warnings', async () => {
    await act(async () => {
      root?.render(<App />);
    });

    // Find and click "Review Queue" nav tab
    const reviewTabs = Array.from(container?.querySelectorAll('button') || []).filter((b) =>
      b.textContent?.includes('Review Queue'),
    );
    expect(reviewTabs.length).toBeGreaterThan(0);

    await act(async () => {
      reviewTabs[0]?.click();
    });

    expect(container?.textContent).toContain('Email Review Queue');
    expect(container?.textContent).toContain('Acme Corp');
    expect(container?.textContent).toContain('Senior Engineer');
    expect(container?.textContent).toContain('Guardrail Validation Failed');
  });

  it('navigates to Sources and displays parser suspect warnings', async () => {
    await act(async () => {
      root?.render(<App />);
    });

    const sourcesTabs = Array.from(container?.querySelectorAll('button') || []).filter((b) =>
      b.textContent?.includes('Sources'),
    );
    expect(sourcesTabs.length).toBeGreaterThan(0);

    await act(async () => {
      sourcesTabs[0]?.click();
    });

    expect(container?.textContent).toContain('Job Sources & Ingestion Health');
    expect(container?.textContent).toContain('greenhouse');
    expect(container?.textContent).toContain('linkedin');
    expect(container?.textContent).toContain('Parser Suspect Warning');
  });

  it('navigates to Events view and renders searchable audit log', async () => {
    await act(async () => {
      root?.render(<App />);
    });

    const eventsTabs = Array.from(container?.querySelectorAll('button') || []).filter((b) =>
      b.textContent?.includes('Events'),
    );
    expect(eventsTabs.length).toBeGreaterThan(0);

    await act(async () => {
      eventsTabs[0]?.click();
    });

    expect(container?.textContent).toContain('Audit Events Log');
    expect(container?.textContent).toContain('kill_switch_toggled');
  });

  it('navigates to Parsed Jobs view and displays parsed jobs with match scores', async () => {
    await act(async () => {
      root?.render(<App />);
    });

    const parsedJobsTabs = Array.from(container?.querySelectorAll('button') || []).filter((b) =>
      b.textContent?.includes('Parsed Jobs'),
    );
    expect(parsedJobsTabs.length).toBeGreaterThan(0);

    await act(async () => {
      parsedJobsTabs[0]?.click();
    });

    await act(async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(container?.textContent).toContain('Mail Parsed Jobs & AI Match Scoring');
    expect(container?.textContent).toContain('Flutter Developer');
    expect(container?.textContent).toContain('Acme Mobile');
    expect(container?.textContent).toContain('88');
    expect(container?.textContent).toContain('Sync Alerts from Gmail');
  });

  it('opens confirmation modal before toggling Kill Switch', async () => {
    await act(async () => {
      root?.render(<App />);
    });

    // Find header Kill Switch button
    const ksButton = Array.from(container?.querySelectorAll('button') || []).find((b) =>
      b.textContent?.includes('Kill Switch Off'),
    );
    expect(ksButton).toBeDefined();

    await act(async () => {
      ksButton?.click();
    });

    // Modal dialog should be in document
    const modal = document.querySelector('[role="dialog"]');
    expect(modal).not.toBeNull();
    expect(modal?.textContent).toContain('Activate Kill Switch?');
    expect(modal?.textContent).toContain('Yes, Activate Kill Switch');

    // Confirm action
    const confirmBtn = Array.from(modal?.querySelectorAll('button') || []).find((b) =>
      b.textContent?.includes('Yes, Activate Kill Switch'),
    );
    expect(confirmBtn).toBeDefined();

    await act(async () => {
      confirmBtn?.click();
    });

    // Modal should close
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('opens confirmation modal before switching DRY_RUN to false in Overview', async () => {
    let dryRunPayloadSent: { dry_run?: boolean; confirmed?: boolean } | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const u = url.toString();
        if (u.includes('/api/settings/dry-run') && init?.method === 'POST') {
          dryRunPayloadSent = JSON.parse(init.body as string);
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ ok: true, dryRun: false }),
          });
        }
        if (u.includes('/api/overview')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              sendsToday: 3,
              effectiveCap: 15,
              dailyCap: 20,
              bounceRate: 0,
              failureRate: 0,
              jobsByStatus: { routed: 5 },
              jobsByRoute: { auto_email: 2 },
              manualWaitingCount: 4,
              authHealth: { status: 'ok', reason: null, checked_at: new Date().toISOString() },
              dryRun: true,
              killSwitch: false,
            }),
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
      }),
    );

    await act(async () => {
      root?.render(<App />);
    });

    // Find DRY RUN toggle button in Overview
    const dryRunBtn = Array.from(container?.querySelectorAll('button') || []).find((b) =>
      b.textContent?.includes('DRY RUN: ON'),
    );
    expect(dryRunBtn).toBeDefined();

    // Clicking toggle to switch to false opens ConfirmationModal
    await act(async () => {
      dryRunBtn?.click();
    });

    const modal = document.querySelector('[role="dialog"]');
    expect(modal).not.toBeNull();
    expect(modal?.textContent).toContain('Switch to LIVE Sending Mode?');
    expect(modal?.textContent).toContain('Disabling DRY_RUN will activate live email sending');

    // Confirm action
    const confirmBtn = Array.from(modal?.querySelectorAll('button') || []).find((b) =>
      b.textContent?.includes('Switch to LIVE'),
    );
    expect(confirmBtn).toBeDefined();

    await act(async () => {
      confirmBtn?.click();
    });

    // Modal closes and confirmed: true is sent
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(dryRunPayloadSent).toEqual({ dry_run: false, confirmed: true });
  });

  it('renders score threshold (min_score) in Settings and requires confirmation when switching DRY_RUN to false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const u = url.toString();
        if (u.includes('/api/overview')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              sendsToday: 0,
              effectiveCap: 20,
              dailyCap: 20,
              bounceRate: 0,
              failureRate: 0,
              jobsByStatus: {},
              jobsByRoute: {},
              manualWaitingCount: 0,
              authHealth: { status: 'ok', reason: null, checked_at: null },
              dryRun: true,
              killSwitch: false,
            }),
          });
        }
        if (u.includes('/api/settings') && init?.method === 'POST') {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
        }
        if (u.includes('/api/settings')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              ok: true,
              dryRun: true,
              killSwitch: false,
              profile: {
                name: 'Alex Mercer',
                email: 'alex@example.com',
                skills: ['TypeScript'],
                send_settings: {
                  daily_cap: 20,
                  ramp_base: 5,
                  ramp_step: 2,
                  window: { start: '09:00', end: '18:00' },
                  timezone: 'UTC',
                  auto_approve_above_score: 85,
                },
                filters: {
                  titles: ['Engineer'],
                  company_blacklist: [],
                  min_score: 75,
                },
              },
            }),
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
      }),
    );

    await act(async () => {
      root?.render(<App />);
    });

    // Navigate to Settings
    const settingsTab = Array.from(container?.querySelectorAll('button') || []).find((b) =>
      b.textContent?.includes('Settings'),
    );
    expect(settingsTab).toBeDefined();

    await act(async () => {
      settingsTab?.click();
    });

    // Verify min_score score threshold is rendered
    expect(container?.textContent).toContain('Minimum Score Threshold');
    const minScoreInput = container?.querySelector('input[type="number"]') as HTMLInputElement;
    expect(minScoreInput).not.toBeNull();

    // Switch to Safety sub-tab
    const safetyTab = Array.from(container?.querySelectorAll('button') || []).find((b) =>
      b.textContent?.includes('Safety'),
    );
    expect(safetyTab).toBeDefined();
    await act(async () => {
      safetyTab?.click();
    });

    // Verify DRY_RUN toggle in Settings opens modal
    const dryRunBtn = Array.from(container?.querySelectorAll('button') || []).find((b) =>
      b.textContent?.includes('DRY_RUN: ENABLED'),
    );
    expect(dryRunBtn).toBeDefined();

    await act(async () => {
      dryRunBtn?.click();
    });

    const modal = document.querySelector('[role="dialog"]');
    expect(modal).not.toBeNull();
    expect(modal?.textContent).toContain('Switch to LIVE Sending Mode?');

    // Close modal
    const cancelBtn = Array.from(modal?.querySelectorAll('button') || []).find((b) =>
      b.textContent?.includes('Cancel'),
    );
    await act(async () => {
      cancelBtn?.click();
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  describe('Dashboard Header Status Badges', () => {
    it('header badges show grey unknown/loading state while overview API is pending', async () => {
      // Mock fetch that hangs (never resolves)
      vi.stubGlobal('fetch', () => new Promise(() => {}));

      await act(async () => {
        root?.render(<App />);
      });

      const googleLoading = container?.querySelector('[data-testid="badge-google-loading"]');
      const dryRunLoading = container?.querySelector('[data-testid="badge-dryrun-loading"]');
      const ksLoading = container?.querySelector('[data-testid="badge-killswitch-loading"]');

      expect(googleLoading).not.toBeNull();
      expect(googleLoading?.textContent).toContain('Google: Loading...');
      expect(googleLoading?.className).toContain('bg-surface-subtle');

      expect(dryRunLoading).not.toBeNull();
      expect(dryRunLoading?.textContent).toContain('DRY_RUN: Loading...');
      expect(dryRunLoading?.className).toContain('bg-surface-subtle');

      expect(ksLoading).not.toBeNull();
      expect(ksLoading?.textContent).toContain('Kill Switch: unknown');
      expect(ksLoading?.className).toContain('bg-surface-subtle');

      // Verify it does NOT default to "Google OK" or "Kill Switch Off"
      expect(container?.textContent).not.toContain('Google OK');
      expect(container?.textContent).not.toContain('Kill Switch Off');
    });

    it('header badges show "API unreachable" on error instead of defaulting to OK/Off', async () => {
      // Mock fetch rejecting with error
      vi.stubGlobal('fetch', () => Promise.reject(new Error('Connection refused')));

      await act(async () => {
        root?.render(<App />);
      });

      const googleError = container?.querySelector('[data-testid="badge-google-error"]');
      const dryRunError = container?.querySelector('[data-testid="badge-dryrun-error"]');
      const ksError = container?.querySelector('[data-testid="badge-killswitch-error"]');

      expect(googleError).not.toBeNull();
      expect(googleError?.textContent).toContain('Google: API unreachable');

      expect(dryRunError).not.toBeNull();
      expect(dryRunError?.textContent).toContain('DRY_RUN: API unreachable');

      expect(ksError).not.toBeNull();
      expect(ksError?.textContent).toContain('Kill Switch: API unreachable');

      // Verify it does NOT default to "Google OK" or "Kill Switch Off"
      expect(container?.textContent).not.toContain('Google OK');
      expect(container?.textContent).not.toContain('Kill Switch Off');
    });

    it('header badges show healthy green "Google OK" only when authHealth is ok', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string) => {
          if (url.includes('/api/overview')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                sendsToday: 0,
                effectiveCap: 15,
                dailyCap: 20,
                bounceRate: 0,
                failureRate: 0,
                jobsByStatus: {},
                jobsByRoute: {},
                manualWaitingCount: 0,
                killSwitch: false,
                dryRun: true,
                authHealth: { status: 'ok' },
              }),
            });
          }
          return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
        }),
      );

      await act(async () => {
        root?.render(<App />);
      });

      const googleBadge = container?.querySelector('[data-testid="badge-google-ok"]');
      expect(googleBadge).not.toBeNull();
      expect(googleBadge?.textContent).toContain('Google OK');
      expect(googleBadge?.className).toContain('bg-state-ok-bg');
      expect(googleBadge?.className).toContain('text-state-ok-fg');
      expect(container?.textContent).toContain('DRY_RUN');
      expect(container?.textContent).toContain('Kill Switch Off');
    });

    it('header Google badge shows grey "Google: not connected" when authHealth is unknown', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string) => {
          if (url.includes('/api/overview')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                sendsToday: 0,
                effectiveCap: 15,
                dailyCap: 20,
                bounceRate: 0,
                failureRate: 0,
                jobsByStatus: {},
                jobsByRoute: {},
                manualWaitingCount: 0,
                killSwitch: false,
                dryRun: true,
                authHealth: {
                  status: 'unknown',
                  reason: 'No auth health record found in KV',
                },
              }),
            });
          }
          return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
        }),
      );

      await act(async () => {
        root?.render(<App />);
      });

      const unknownBadge = container?.querySelector('[data-testid="badge-google-unknown"]');
      expect(unknownBadge).not.toBeNull();
      expect(unknownBadge?.textContent).toContain('Google: not connected');
      expect(unknownBadge?.className).toContain('bg-surface-subtle');
      expect(unknownBadge?.className).toContain('text-fg-muted');
      expect(unknownBadge?.getAttribute('href')).toBe('/auth/google/start');

      // CRITICAL: Must NEVER be green or say Google OK
      expect(container?.querySelector('[data-testid="badge-google-ok"]')).toBeNull();
      expect(container?.textContent).not.toContain('Google OK');
      expect(unknownBadge?.className).not.toContain('bg-state-ok-bg');
      expect(unknownBadge?.className).not.toContain('text-state-ok-fg');
    });

    it('header Google badge shows red "Google: reconnect" when authHealth is invalid', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string) => {
          if (url.includes('/api/overview')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                sendsToday: 0,
                effectiveCap: 15,
                dailyCap: 20,
                bounceRate: 0,
                failureRate: 0,
                jobsByStatus: {},
                jobsByRoute: {},
                manualWaitingCount: 0,
                killSwitch: false,
                dryRun: true,
                authHealth: {
                  status: 'invalid',
                  reason: 'Token revoked',
                },
              }),
            });
          }
          return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
        }),
      );

      await act(async () => {
        root?.render(<App />);
      });

      const invalidBadge = container?.querySelector('[data-testid="badge-google-invalid"]');
      expect(invalidBadge).not.toBeNull();
      expect(invalidBadge?.textContent).toContain('Google: reconnect');
      expect(invalidBadge?.className).toContain('bg-state-danger-bg');
      expect(invalidBadge?.className).toContain('text-state-danger-fg');
      expect(invalidBadge?.getAttribute('href')).toBe('/auth/google/start');

      // CRITICAL: Must NEVER be green or say Google OK
      expect(container?.querySelector('[data-testid="badge-google-ok"]')).toBeNull();
      expect(container?.textContent).not.toContain('Google OK');
      expect(invalidBadge?.className).not.toContain('bg-state-ok-bg');
      expect(invalidBadge?.className).not.toContain('text-state-ok-fg');
    });

    it('FAILS if Google badge defaults to ok when authHealth is unknown or omitted from API', async () => {
      // Simulates an API response where authHealth is missing or empty
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string) => {
          if (url.includes('/api/overview')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                sendsToday: 0,
                effectiveCap: 15,
                dailyCap: 20,
                bounceRate: 0,
                failureRate: 0,
                jobsByStatus: {},
                jobsByRoute: {},
                manualWaitingCount: 0,
                killSwitch: false,
                dryRun: true,
                // Omitted or unknown authHealth
              }),
            });
          }
          return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
        }),
      );

      await act(async () => {
        root?.render(<App />);
      });

      // Strict enforcement: A badge defaulting to "ok" would fail these 4 assertions
      const okBadge = container?.querySelector('[data-testid="badge-google-ok"]');
      expect(okBadge).toBeNull();
      expect(container?.textContent).not.toContain('Google OK');

      const unknownBadge = container?.querySelector('[data-testid="badge-google-unknown"]');
      expect(unknownBadge).not.toBeNull();
      expect(unknownBadge?.textContent).toContain('Google: not connected');
    });

    it('Kill Switch badge renders active alert state when killSwitch is true in KV', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string) => {
          if (url.includes('/api/overview')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                sendsToday: 0,
                effectiveCap: 0,
                dailyCap: 20,
                bounceRate: 0,
                failureRate: 0,
                jobsByStatus: {},
                jobsByRoute: {},
                manualWaitingCount: 0,
                killSwitch: true, // Active in KV
                dryRun: true,
                authHealth: { status: 'ok' },
              }),
            });
          }
          return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
        }),
      );

      await act(async () => {
        root?.render(<App />);
      });

      const ksActiveBadge = container?.querySelector('[data-testid="badge-killswitch-active"]');
      expect(ksActiveBadge).not.toBeNull();
      expect(ksActiveBadge?.textContent).toContain('KILL SWITCH ON');
      expect(ksActiveBadge?.className).toContain('bg-state-danger-bg');
    });

    it('Kill Switch badge renders disarmed state when killSwitch is false in KV', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string) => {
          if (url.includes('/api/overview')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                sendsToday: 0,
                effectiveCap: 20,
                dailyCap: 20,
                bounceRate: 0,
                failureRate: 0,
                jobsByStatus: {},
                jobsByRoute: {},
                manualWaitingCount: 0,
                killSwitch: false, // Disarmed in KV
                dryRun: true,
                authHealth: { status: 'ok' },
              }),
            });
          }
          return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
        }),
      );

      await act(async () => {
        root?.render(<App />);
      });

      const ksOffBadge = container?.querySelector('[data-testid="badge-killswitch-off"]');
      expect(ksOffBadge).not.toBeNull();
      expect(ksOffBadge?.textContent).toContain('Kill Switch Off');
      expect(ksOffBadge?.className).toContain('bg-surface-subtle');
    });
  });

  describe('Single-Owner Login & Bearer Token Authentication', () => {
    it('renders LoginView when no token is present in localStorage', async () => {
      localStorage.clear();
      await act(async () => {
        root?.render(<App />);
      });

      expect(container?.textContent).toContain('Pigeon');
      expect(container?.textContent).toContain('Owner Authentication');
      expect(container?.textContent).toContain('Admin Password');

      const passInput = container?.querySelector('[data-testid="admin-password-input"]');
      expect(passInput).not.toBeNull();
      const submitBtn = container?.querySelector('[data-testid="login-submit-button"]');
      expect(submitBtn).not.toBeNull();
    });

    it('logging in saves token in localStorage and attaches Authorization: Bearer <password> header', async () => {
      localStorage.clear();
      const fetchCalls: Array<{ url: string; headers: HeadersInit | undefined }> = [];

      vi.stubGlobal(
        'fetch',
        vi.fn((url: string, init?: RequestInit) => {
          fetchCalls.push({ url: url.toString(), headers: init?.headers });
          if (url.toString().includes('/api/overview')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                sendsToday: 5,
                effectiveCap: 20,
                dailyCap: 20,
                bounceRate: 0,
                failureRate: 0,
                jobsByStatus: {},
                jobsByRoute: {},
                manualWaitingCount: 0,
                authHealth: { status: 'ok' },
                dryRun: true,
                killSwitch: false,
              }),
            });
          }
          return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
        }),
      );

      await act(async () => {
        root?.render(<App />);
      });

      const passInput = container?.querySelector(
        '[data-testid="admin-password-input"]',
      ) as HTMLInputElement;
      expect(passInput).not.toBeNull();

      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;

      // Type password into input
      await act(async () => {
        nativeInputValueSetter?.call(passInput, 'my-secret-admin-token');
        passInput.dispatchEvent(new Event('input', { bubbles: true }));
      });

      const form = container?.querySelector('form') as HTMLFormElement;
      expect(form).not.toBeNull();

      await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });

      // Verify token is saved in localStorage
      expect(localStorage.getItem('pigeon_admin_token')).toBe('my-secret-admin-token');

      // Verify Authorization header was sent
      const overviewCall = fetchCalls.find((c) => c.url.includes('/api/overview'));
      expect(overviewCall).toBeDefined();
      const authHeader =
        overviewCall?.headers instanceof Headers
          ? overviewCall.headers.get('Authorization')
          : (overviewCall?.headers as Record<string, string>)?.[
              'Authorization'
            ];
      expect(authHeader).toBe('Bearer my-secret-admin-token');

      // Verify dashboard overview rendered
      expect(container?.textContent).toContain("Today's Sends");
    });

    it('displays error alert when login returns 401 Unauthorized', async () => {
      localStorage.clear();

      vi.stubGlobal(
        'fetch',
        vi.fn((url: string) => {
          if (url.toString().includes('/api/overview')) {
            return Promise.resolve({
              ok: false,
              status: 401,
              json: async () => ({ error: 'Unauthorized: Invalid admin password' }),
            });
          }
          return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
        }),
      );

      await act(async () => {
        root?.render(<App />);
      });

      const passInput = container?.querySelector(
        '[data-testid="admin-password-input"]',
      ) as HTMLInputElement;
      const form = container?.querySelector('form') as HTMLFormElement;

      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;

      await act(async () => {
        nativeInputValueSetter?.call(passInput, 'wrong-password');
        passInput.dispatchEvent(new Event('input', { bubbles: true }));
      });

      await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });

      // Token should NOT be saved in localStorage
      expect(localStorage.getItem('pigeon_admin_token')).toBeNull();

      // Error alert should be displayed
      const errorAlert = container?.querySelector('[data-testid="login-error-alert"]');
      expect(errorAlert).not.toBeNull();
      expect(errorAlert?.textContent).toContain('Invalid admin password');
    });

    it('redirects to LoginView when an API call returns 401 Unauthorized', async () => {
      localStorage.setItem('pigeon_admin_token', 'initial-token');

      await act(async () => {
        root?.render(<App />);
      });

      // Initially rendered in dashboard view
      expect(container?.textContent).toContain('Pigeon');
      expect(container?.textContent).toContain("Today's Sends");

      // Now mock a 401 response and trigger an action
      vi.stubGlobal(
        'fetch',
        vi.fn(() => {
          return Promise.resolve({
            ok: false,
            status: 401,
            json: async () => ({ error: 'Unauthorized: Session expired' }),
          });
        }),
      );

      // Trigger an API call using the kill-switch toggle or directly dispatch unauthorized
      const { notifyUnauthorized } = await import('./api.js');
      await act(async () => {
        notifyUnauthorized();
      });

      // Token in localStorage is cleared
      expect(localStorage.getItem('pigeon_admin_token')).toBeNull();

      // App should transition back to LoginView
      expect(container?.textContent).toContain('Owner Authentication');
      expect(container?.textContent).toContain('Admin Password');
    });

    it('clicking Sign Out button clears token and redirects to LoginView', async () => {
      localStorage.setItem('pigeon_admin_token', 'initial-token');

      await act(async () => {
        root?.render(<App />);
      });

      expect(container?.textContent).toContain("Today's Sends");

      const signOutBtn = container?.querySelector(
        '[data-testid="header-signout-button"]',
      ) as HTMLButtonElement;
      expect(signOutBtn).not.toBeNull();

      await act(async () => {
        signOutBtn.click();
      });

      expect(localStorage.getItem('pigeon_admin_token')).toBeNull();
      expect(container?.textContent).toContain('Owner Authentication');
    });
  });

  describe('Manual Cron Run Buttons in Overview', () => {
    it('renders Run Now button for each cron job and triggers POST /api/cron/:id/run', async () => {
      const triggeredUrls: string[] = [];
      let overviewFetchCount = 0;

      vi.stubGlobal(
        'fetch',
        vi.fn((url: string, init?: RequestInit) => {
          const u = url.toString();
          if (u.includes('/api/cron/') && u.endsWith('/run') && init?.method === 'POST') {
            triggeredUrls.push(u);
            const id = u.split('/api/cron/')[1]?.split('/run')[0] || '';
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                ok: true,
                id,
                message: `Triggered ${id} successfully.`,
              }),
            });
          }
          if (u.includes('/api/overview')) {
            overviewFetchCount++;
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                sendsToday: 3,
                effectiveCap: 15,
                dailyCap: 20,
                bounceRate: 0,
                failureRate: 0,
                jobsByStatus: { routed: 5 },
                jobsByRoute: { auto_email: 2 },
                manualWaitingCount: 4,
                authHealth: { status: 'ok', reason: null, checked_at: new Date().toISOString() },
                dryRun: true,
                killSwitch: false,
                cronJobs: [
                  {
                    id: 'ingest',
                    name: 'Job Ingestion',
                    cron: '0 */3 * * *',
                    schedule: 'Every 3 hours',
                    description: 'Fetches active ATS & job boards, purges stale records',
                    lastRunAt: null,
                  },
                  {
                    id: 'score',
                    name: 'Scoring & Pipeline',
                    cron: '*/10 * * * *',
                    schedule: 'Every 10 minutes',
                    description: 'Evaluates new jobs with LLM & syncs Google Sheets',
                    lastRunAt: null,
                  },
                  {
                    id: 'inbox',
                    name: 'Inbox & Health',
                    cron: '*/15 * * * *',
                    schedule: 'Every 15 minutes',
                    description: 'Polls Gmail for employer replies & verifies auth',
                    lastRunAt: null,
                  },
                ],
              }),
            });
          }
          return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
        }),
      );

      await act(async () => {
        root?.render(<App />);
      });

      const ingestBtn = container?.querySelector(
        '[data-testid="run-cron-ingest"]',
      ) as HTMLButtonElement | null;
      const scoreBtn = container?.querySelector(
        '[data-testid="run-cron-score"]',
      ) as HTMLButtonElement | null;
      const inboxBtn = container?.querySelector(
        '[data-testid="run-cron-inbox"]',
      ) as HTMLButtonElement | null;

      expect(ingestBtn).not.toBeNull();
      expect(scoreBtn).not.toBeNull();
      expect(inboxBtn).not.toBeNull();

      const beforeCount = overviewFetchCount;

      await act(async () => {
        ingestBtn?.click();
      });
      expect(triggeredUrls).toContain('/api/cron/ingest/run');
      expect(container?.textContent).toContain('Job Ingestion: Triggered ingest successfully.');
      expect(overviewFetchCount).toBeGreaterThan(beforeCount);

      await act(async () => {
        scoreBtn?.click();
      });
      expect(triggeredUrls).toContain('/api/cron/score/run');
      expect(container?.textContent).toContain('Scoring & Pipeline: Triggered score successfully.');

      await act(async () => {
        inboxBtn?.click();
      });
      expect(triggeredUrls).toContain('/api/cron/inbox/run');
      expect(container?.textContent).toContain('Inbox & Health: Triggered inbox successfully.');
    });

    it('displays error feedback when manual cron run fails', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string, init?: RequestInit) => {
          const u = url.toString();
          if (u.includes('/api/cron/score/run') && init?.method === 'POST') {
            return Promise.resolve({
              ok: false,
              status: 500,
              json: async () => ({ error: 'Queue unavailable' }),
            });
          }
          if (u.includes('/api/overview')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                sendsToday: 0,
                effectiveCap: 20,
                dailyCap: 20,
                bounceRate: 0,
                failureRate: 0,
                jobsByStatus: {},
                jobsByRoute: {},
                manualWaitingCount: 0,
                authHealth: { status: 'ok', reason: null, checked_at: null },
                dryRun: true,
                killSwitch: false,
              }),
            });
          }
          return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
        }),
      );

      await act(async () => {
        root?.render(<App />);
      });

      const scoreBtn = container?.querySelector(
        '[data-testid="run-cron-score"]',
      ) as HTMLButtonElement | null;
      expect(scoreBtn).not.toBeNull();

      await act(async () => {
        scoreBtn?.click();
      });

      expect(container?.textContent).toContain('Scoring & Pipeline: Queue unavailable');
    });
  });

  describe('App-Wide Styled Alert & Confirmation Dialogs', () => {
    it('shows in-app AlertModal on action error and ConfirmationModal on Review Queue reject instead of browser dialogs', async () => {
      const alertSpy = vi.fn(() => {
        throw new Error('window.alert should not be called');
      });
      const confirmSpy = vi.fn(() => {
        throw new Error('window.confirm should not be called');
      });
      vi.stubGlobal('alert', alertSpy);
      vi.stubGlobal('confirm', confirmSpy);

      let rejected = false;
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string, init?: RequestInit) => {
          const u = url.toString();
          if (u.includes('/api/overview')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                sendsToday: 0,
                effectiveCap: 20,
                dailyCap: 20,
                bounceRate: 0,
                failureRate: 0,
                jobsByStatus: {},
                jobsByRoute: {},
                manualWaitingCount: 0,
                authHealth: { status: 'ok', reason: null, checked_at: null },
                dryRun: true,
                killSwitch: false,
              }),
            });
          }
          if (u.includes('/api/settings/dry-run') && init?.method === 'POST') {
            return Promise.resolve({
              ok: false,
              status: 500,
              json: async () => ({ error: 'Failed to persist DRY_RUN' }),
            });
          }
          if (u.includes('/api/review-queue')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                ok: true,
                items: [
                  {
                    id: 'app-rq-1',
                    job_id: 'job-rq-1',
                    status: 'draft',
                    cover_letter: 'Dear Acme...',
                    subject: 'Application for Engineer',
                    resume_id: null,
                    resume_label: null,
                    validator_errors: null,
                    updated_at: new Date().toISOString(),
                    title: 'Systems Engineer',
                    company: 'Acme Corp',
                    location: 'Remote',
                    salary_raw: null,
                    description: 'Systems engineering role.',
                    apply_url: 'https://acme.com/jobs/1',
                    contact_email: 'jobs@acme.com',
                    contact_source: 'posting',
                    match_score: 90,
                    match_reasons: 'Great match',
                    red_flags: [],
                    untrusted: false,
                    route_reason: 'OK',
                    is_safe_for_bulk: true,
                  },
                ],
              }),
            });
          }
          if (u.includes('/api/resumes')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({ ok: true, resumes: [] }),
            });
          }
          if (u.includes('/api/applications/app-rq-1/reject') && init?.method === 'POST') {
            rejected = true;
            return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
          }
          return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
        }),
      );

      await act(async () => {
        root?.render(<App />);
      });

      // Trigger DRY_RUN live modal, confirm it -> 500 error opens in-app AlertModal
      const dryRunBtn = Array.from(container?.querySelectorAll('button') || []).find((b) =>
        b.textContent?.includes('DRY RUN: ON'),
      );
      await act(async () => {
        dryRunBtn?.click();
      });
      const confirmLiveBtn = Array.from(
        document.querySelector('[role="dialog"]')?.querySelectorAll('button') || [],
      ).find((b) => b.textContent?.includes('Switch to LIVE'));
      await act(async () => {
        confirmLiveBtn?.click();
      });

      expect(alertSpy).not.toHaveBeenCalled();
      const alertModal = document.querySelector('[role="dialog"]');
      expect(alertModal).not.toBeNull();
      expect(alertModal?.textContent).toContain('DRY_RUN Update Failed');
      expect(alertModal?.textContent).toContain('Failed to persist DRY_RUN');

      const alertOkBtn = alertModal?.querySelector('[data-testid="alert-modal-ok"]') as HTMLButtonElement;
      await act(async () => {
        alertOkBtn?.click();
      });
      expect(document.querySelector('[role="dialog"]')).toBeNull();

      // Switch to Review Queue and click Reject -> opens in-app ConfirmationModal
      const rqTab = Array.from(container?.querySelectorAll('button') || []).find((b) =>
        b.textContent?.includes('Review Queue'),
      );
      await act(async () => {
        rqTab?.click();
      });

      const rejectBtn = Array.from(container?.querySelectorAll('button') || []).find((b) =>
        b.textContent?.trim() === 'Reject Application',
      );
      expect(rejectBtn).toBeDefined();
      await act(async () => {
        rejectBtn?.click();
      });

      expect(confirmSpy).not.toHaveBeenCalled();
      const confirmModal = document.querySelector('[role="dialog"]');
      expect(confirmModal).not.toBeNull();
      expect(confirmModal?.textContent).toContain('Reject Application?');
      expect(confirmModal?.textContent).toContain('Acme Corp');

      const confirmRejectBtn = Array.from(confirmModal?.querySelectorAll('button') || []).find((b) =>
        b.textContent?.includes('Reject Application'),
      );
      await act(async () => {
        confirmRejectBtn?.click();
      });
      expect(rejected).toBe(true);
    });
  });
});
