import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ReviewQueueView } from './ReviewQueueView.js';
import { DialogProvider } from './ui/DialogProvider.js';
import { ToastProvider } from './ui/ToastProvider.js';

// @ts-expect-error global IS_REACT_ACT_ENVIRONMENT flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function renderWithProviders(ui: React.ReactNode) {
  return (
    <DialogProvider>
      <ToastProvider>{ui}</ToastProvider>
    </DialogProvider>
  );
}

describe('ReviewQueueView Component', () => {
  let container: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;

  const mockReviewItem = {
    id: 'app-rq-10',
    job_id: 'job-rq-10',
    kind: 'follow_up',
    status: 'needs_review',
    cover_letter: 'Dear Hiring Team at Stripe, following up on my application.',
    subject: 'Re: Application for Staff Engineer',
    resume_id: 'res-1',
    resume_label: 'Primary Resume',
    validator_errors: null,
    updated_at: '2026-11-27T10:00:00.000Z',
    title: 'Staff Engineer',
    company: 'Stripe',
    location: 'Remote',
    remote: true,
    salary_raw: '$210,000',
    description: 'Build distributed financial infrastructure.',
    apply_url: 'https://stripe.com/jobs/10',
    contact_email: 'talent@gmail.com',
    contact_source: 'posting',
    match_score: 91,
    match_reasons: 'Strong TypeScript and payments background.',
    red_flags: [],
    untrusted: false,
    route_reason: 'FREEMAIL_CONTACT',
    is_safe_for_bulk: false,
    bulk_block_reasons: ['Freemail contact address requires individual approval'],
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
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

  it('sends { cover_letter, subject } on save, displays JD & Fit context tabs, and shows bulk blockers', async () => {
    const patchCalls: Array<{ url: string; body: string }> = [];
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/review-queue')) {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true, items: [mockReviewItem], outbox: [] })),
        );
      }
      if (url.includes('/api/resumes')) {
        return Promise.resolve(new Response(JSON.stringify({ resumes: [] })));
      }
      if (url.includes('/api/applications/app-rq-10/letter') && init?.method === 'PATCH') {
        patchCalls.push({ url, body: String(init.body || '') });
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true, validation_passed: true, validator_errors: [] })),
        );
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    await act(async () => {
      root?.render(renderWithProviders(<ReviewQueueView />));
    });
    await act(async () => {
      await Promise.resolve();
    });

    // Follow-up badge and bulk-safety blocker explainability rendered
    expect(container?.textContent).toContain('Follow-up');
    expect(container?.textContent).toContain('Freemail contact address requires individual approval');

    // Save letter uses { cover_letter, subject }
    const saveBtn = Array.from(container?.querySelectorAll('button') ?? []).find((b) =>
      b.textContent?.includes('Save & Validate Letter'),
    );
    expect(saveBtn).toBeDefined();
    await act(async () => {
      saveBtn?.click();
    });

    expect(patchCalls).toContainEqual({
      url: '/api/applications/app-rq-10/letter',
      body: JSON.stringify({
        cover_letter: mockReviewItem.cover_letter,
        subject: mockReviewItem.subject,
      }),
    });

    // Switch to Job Description tab
    const jdTab = Array.from(container?.querySelectorAll('button') ?? []).find((b) =>
      b.textContent?.includes('Job Description'),
    );
    await act(async () => {
      jdTab?.click();
    });
    expect(container?.textContent).toContain('Build distributed financial infrastructure.');

    // Switch to AI Fit & Signals tab
    const fitTab = Array.from(container?.querySelectorAll('button') ?? []).find((b) =>
      b.textContent?.includes('AI Fit & Signals'),
    );
    await act(async () => {
      fitTab?.click();
    });
    expect(container?.textContent).toContain('Strong TypeScript and payments background.');
  });
});
