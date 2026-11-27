import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ApplicationsView, sanitizeCsvCell } from './ApplicationsView.js';
import { DialogProvider } from './ui/DialogProvider.js';
import { ToastProvider } from './ui/ToastProvider.js';

// Suppress React 19 test environment warning
// @ts-expect-error global IS_REACT_ACT_ENVIRONMENT flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function renderWithProviders(ui: React.ReactNode) {
  return (
    <DialogProvider>
      <ToastProvider>{ui}</ToastProvider>
    </DialogProvider>
  );
}

describe('ApplicationsView & CSV Safety', () => {
  let container: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;

  const sampleApps = [
    {
      id: 'app-1',
      job_id: 'job-1',
      kind: 'initial',
      channel: 'email',
      status: 'sent',
      resume_id: 'res-1',
      cover_letter: 'Dear Acme team, I would love to join.',
      subject: 'Application for Senior Engineer',
      sent_at: '2026-11-25T10:00:00.000Z',
      applied_at: null,
      notes: 'Initial outreach',
      updated_at: '2026-11-25T10:00:00.000Z',
      title: 'Senior Backend Engineer',
      company: 'Acme Corp',
      source: 'greenhouse',
      location: 'Remote',
      remote: true,
      match_score: 92,
      contact_email: 'jobs@acme.com',
      apply_url: 'https://acme.com/jobs/1',
    },
    {
      id: 'app-2',
      job_id: 'job-2',
      kind: 'initial',
      channel: 'manual',
      status: 'interview',
      resume_id: 'res-1',
      cover_letter: 'Dear Beta team...',
      subject: null,
      sent_at: null,
      applied_at: '2026-11-24T09:00:00.000Z',
      notes: 'Phone screen passed',
      updated_at: '2026-11-26T09:00:00.000Z',
      title: 'Staff Systems Engineer',
      company: 'Beta Labs',
      source: 'lever',
      location: 'Bengaluru',
      remote: false,
      match_score: 88,
      contact_email: null,
      apply_url: 'https://jobs.lever.co/beta/2',
    },
  ];

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    vi.useRealTimers();
    if (root && container) {
      act(() => {
        root?.unmount();
      });
      container.remove();
    }
    vi.restoreAllMocks();
  });

  it('neutralizes spreadsheet formula injection in CSV export cells', () => {
    expect(sanitizeCsvCell('=CMD("calc")')).toBe('"\'=CMD(""calc"")"');
    expect(sanitizeCsvCell('+1234')).toBe('"\'+1234"');
    expect(sanitizeCsvCell('-SUM(A1:A2)')).toBe('"\'-SUM(A1:A2)"');
    expect(sanitizeCsvCell('@evil')).toBe('"\'@evil"');
    expect(sanitizeCsvCell('Normal "Co"')).toBe('"Normal ""Co"""');
  });

  it('renders applications from worker { items } payload, opens detail drawer, and posts outcome { status, notes }', async () => {
    const postCalls: Array<{ url: string; body: string }> = [];
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/applications/app-1/outcome') && init?.method === 'POST') {
        postCalls.push({ url, body: String(init.body || '') });
        return Promise.resolve(new Response(JSON.stringify({ ok: true, success: true })));
      }
      if (url.includes('/api/applications/app-1') && !url.includes('/outcome')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              application: {
                ...sampleApps[0],
                description: 'Plain text JD <script>xss</script>',
                resume_label: 'Primary Resume',
              },
              events: [
                {
                  id: 'ev-1',
                  entity: 'application',
                  entity_id: 'app-1',
                  type: 'email_sent',
                  payload: { recipient: 'jobs@acme.com' },
                  created_at: '2026-11-25T10:00:00.000Z',
                },
              ],
            }),
          ),
        );
      }
      if (url.includes('/api/applications?')) {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true, items: sampleApps, total: 2 })),
        );
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    await act(async () => {
      root?.render(renderWithProviders(<ApplicationsView />));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(container?.textContent).toContain('Acme Corp');
    expect(container?.textContent).toContain('Beta Labs');
    // Funnel conversion metrics (2 submitted, 1 interview -> 50% response, 50% interview)
    expect(container?.textContent).toContain('50%');

    // Click row to open detail drawer
    const rows = Array.from(container?.querySelectorAll('tbody tr') ?? []);
    expect(rows.length).toBe(2);
    await act(async () => {
      (rows[0] as HTMLElement).click();
    });

    const drawer = document.querySelector('[role="dialog"]');
    expect(drawer).not.toBeNull();
    expect(drawer?.textContent).toContain('Dear Acme team, I would love to join.');

    // Click Record Outcome inside drawer
    const recordBtn = Array.from(drawer?.querySelectorAll('button') ?? []).find((b) =>
      b.textContent?.includes('Record Outcome'),
    );
    await act(async () => {
      recordBtn?.click();
    });

    const notesInput = document.querySelector('#outcome-notes-input') as HTMLTextAreaElement;
    expect(notesInput).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      setter?.call(notesInput, 'Scheduled technical interview');
      notesInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const saveBtn = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Save Outcome'),
    );
    await act(async () => {
      saveBtn?.click();
    });

    expect(postCalls).toContainEqual({
      url: '/api/applications/app-1/outcome',
      body: JSON.stringify({ status: 'interview', notes: 'Scheduled technical interview' }),
    });
  });
});
