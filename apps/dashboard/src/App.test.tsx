import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';

// Suppress React 19 test environment warning
// @ts-expect-error global IS_REACT_ACT_ENVIRONMENT flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('Dashboard App & Operations Components', () => {
  let container: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;

  beforeEach(() => {
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

        if (u.includes('/api/events')) {
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
      expect(googleLoading?.className).toContain('bg-gray-100');

      expect(dryRunLoading).not.toBeNull();
      expect(dryRunLoading?.textContent).toContain('DRY_RUN: Loading...');
      expect(dryRunLoading?.className).toContain('bg-gray-100');

      expect(ksLoading).not.toBeNull();
      expect(ksLoading?.textContent).toContain('Kill Switch: Loading...');
      expect(ksLoading?.className).toContain('bg-gray-100');

      // Verify it does NOT default to "Google OK" or "Kill Switch Off"
      expect(container?.textContent).not.toContain('✅ Google OK');
      expect(container?.textContent).not.toContain('🛡️ Kill Switch Off');
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
      expect(container?.textContent).not.toContain('✅ Google OK');
      expect(container?.textContent).not.toContain('🛡️ Kill Switch Off');
    });

    it('header badges show healthy status when overview API responds ok', async () => {
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

      expect(container?.textContent).toContain('✅ Google OK');
      expect(container?.textContent).toContain('DRY_RUN');
      expect(container?.textContent).toContain('🛡️ Kill Switch Off');
    });
  });
});
