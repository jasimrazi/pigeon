import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ManualQueueView } from './ManualQueueView.js';
import type { ManualQueueResponse, ManualKit } from '@pigeon/shared';

describe('ManualQueueView Component', () => {
  let container: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;

  const mockQueueResponse: ManualQueueResponse & { ok: boolean } = {
    ok: true,
    items: [
      {
        application_id: 'app-focus-1',
        job_id: 'job-1',
        channel: 'manual',
        status: 'manual_pending',
        title: 'Senior Systems Architect',
        company: 'Cloudflare',
        company_normalized: 'cloudflare',
        source: 'greenhouse',
        location: 'Remote',
        remote: true,
        salary_raw: '$180,000 - $220,000',
        salary_min: 180000,
        salary_max: 220000,
        currency: 'USD',
        match_score: 95,
        apply_route: 'manual_portal',
        route_reason: 'NO_EMAIL_FORM',
        route_reason_explained: 'No contact email in posting; apply via portal form',
        posted_at: new Date().toISOString(),
        fetched_at: new Date().toISOString(),
        snoozed_until: null,
        may_be_closed: false,
        applied_before_warning: false,
        untrusted: false,
        needs_attention: false,
        notes: null,
        validator_errors: null,
      },
      {
        application_id: 'app-attention-2',
        job_id: 'job-2',
        channel: 'manual',
        status: 'needs_review',
        title: 'Backend Engineer',
        company: 'Suspicious Corp',
        company_normalized: 'suspicious corp',
        source: 'ashby',
        location: 'New York, NY',
        remote: false,
        salary_raw: null,
        salary_min: null,
        salary_max: null,
        currency: null,
        match_score: 82,
        apply_route: 'manual_review',
        route_reason: 'RED_FLAGS',
        route_reason_explained: 'Posting contains potential scam or fee red flags',
        posted_at: new Date().toISOString(),
        fetched_at: new Date().toISOString(),
        snoozed_until: null,
        may_be_closed: false,
        applied_before_warning: false,
        untrusted: true,
        needs_attention: true,
        notes: null,
        validator_errors: null,
      },
    ],
    todays_focus: [
      {
        application_id: 'app-focus-1',
        job_id: 'job-1',
        channel: 'manual',
        status: 'manual_pending',
        title: 'Senior Systems Architect',
        company: 'Cloudflare',
        company_normalized: 'cloudflare',
        source: 'greenhouse',
        location: 'Remote',
        remote: true,
        salary_raw: '$180,000 - $220,000',
        salary_min: 180000,
        salary_max: 220000,
        currency: 'USD',
        match_score: 95,
        apply_route: 'manual_portal',
        route_reason: 'NO_EMAIL_FORM',
        route_reason_explained: 'No contact email in posting; apply via portal form',
        posted_at: new Date().toISOString(),
        fetched_at: new Date().toISOString(),
        snoozed_until: null,
        may_be_closed: false,
        applied_before_warning: false,
        untrusted: false,
        needs_attention: false,
        notes: null,
        validator_errors: null,
      },
    ],
    needs_attention: [
      {
        application_id: 'app-attention-2',
        job_id: 'job-2',
        channel: 'manual',
        status: 'needs_review',
        title: 'Backend Engineer',
        company: 'Suspicious Corp',
        company_normalized: 'suspicious corp',
        source: 'ashby',
        location: 'New York, NY',
        remote: false,
        salary_raw: null,
        salary_min: null,
        salary_max: null,
        currency: null,
        match_score: 82,
        apply_route: 'manual_review',
        route_reason: 'RED_FLAGS',
        route_reason_explained: 'Posting contains potential scam or fee red flags',
        posted_at: new Date().toISOString(),
        fetched_at: new Date().toISOString(),
        snoozed_until: null,
        may_be_closed: false,
        applied_before_warning: false,
        untrusted: true,
        needs_attention: true,
        notes: null,
        validator_errors: null,
      },
    ],
    counts: {
      total: 2,
      manual_pending: 1,
      needs_review: 1,
      snoozed: 0,
    },
  };

  const mockKitResponse: { ok: boolean; kit: ManualKit } = {
    ok: true,
    kit: {
      id: 'app-focus-1',
      job_id: 'job-1',
      title: 'Senior Systems Architect',
      company: 'Cloudflare',
      source: 'greenhouse',
      location: 'Remote',
      salary: '$180,000 - $220,000',
      posted_at: new Date().toISOString(),
      apply_url: 'https://boards.greenhouse.io/cloudflare/jobs/12345',
      apply_domain: 'boards.greenhouse.io',
      match_score: 95,
      matched_skills: ['TypeScript', 'Cloudflare Workers'],
      missing_skills: ['Rust'],
      red_flags: [],
      route_reason: 'NO_EMAIL_FORM',
      route_reason_explained: 'No contact email in posting; apply via portal form',
      untrusted: false,
      cover_letter: 'Dear Cloudflare, I am excited to apply for Senior Systems Architect...',
      subject: 'Application for Senior Systems Architect',
      validator_errors: null,
      resume: {
        id: 'res-1',
        label: 'Systems Architect Resume',
        download_url: '/api/resumes/res-1/download',
      },
      answers: {
        notice_period: '2 weeks',
        current_ctc: '$160,000',
        expected_ctc: '$190,000',
        work_authorisation: 'US Citizen',
        links: {
          portfolio: 'https://alexmercer.dev',
          github: 'https://github.com/alexmercer',
        },
      },
      description: '<script>alert("xss")</script>We are looking for a Senior Systems Architect.',
      notes: null,
      contact_email: null,
      contact_source: 'none',
    },
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    // @ts-expect-error React act environment flag
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;

    // Mock clipboard
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      configurable: true,
      writable: true,
    });

    // Mock window.open
    vi.stubGlobal('open', vi.fn());
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

  it('renders focus and attention groups and switches tabs', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/api/manual')) {
        return Promise.resolve(new Response(JSON.stringify(mockQueueResponse)));
      }
      if (url.includes('/api/manual/app-focus-1/kit')) {
        return Promise.resolve(new Response(JSON.stringify(mockKitResponse)));
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    await act(async () => {
      root?.render(<ManualQueueView />);
    });

    // Wait for async fetch to resolve
    await act(async () => {
      await Promise.resolve();
    });

    // Check Header & Tab buttons
    expect(container?.textContent).toContain("Today's Focus");
    expect(container?.textContent).toContain('Needs Attention (1)');
    expect(container?.textContent).toContain('All Active (2)');

    // In focus tab, Senior Systems Architect is rendered
    expect(container?.textContent).toContain('Senior Systems Architect');
    expect(container?.textContent).toContain('Cloudflare');

    // Switch to "Needs Attention" tab
    const buttons = Array.from(container?.querySelectorAll('button') ?? []);
    const needsAttentionBtn = buttons.find((b) => b.textContent?.includes('Needs Attention'));
    expect(needsAttentionBtn).toBeDefined();

    await act(async () => {
      needsAttentionBtn?.click();
    });

    // Now Backend Engineer is displayed
    expect(container?.textContent).toContain('Backend Engineer');
    expect(container?.textContent).toContain('Suspicious Corp');
  });

  it('renders job description strictly as plain text, never executing HTML/scripts', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/api/manual')) {
        return Promise.resolve(new Response(JSON.stringify(mockQueueResponse)));
      }
      if (url.includes('/api/manual/app-focus-1/kit')) {
        return Promise.resolve(new Response(JSON.stringify(mockKitResponse)));
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    await act(async () => {
      root?.render(<ManualQueueView />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const descEl = container?.querySelector('[data-testid="job-description-plain"]');
    expect(descEl).not.toBeNull();
    // The script tag should be rendered literally as text, NOT as an HTML element
    expect(descEl?.innerHTML).toContain('&lt;script&gt;alert("xss")&lt;/script&gt;');
    expect(descEl?.querySelector('script')).toBeNull();
  });

  it('rejects javascript: apply URL and displays warning instead of link', async () => {
    const maliciousKit = {
      ...mockKitResponse,
      kit: {
        ...mockKitResponse.kit,
        apply_url: null, // Sanitized to null by backend
        apply_domain: null,
      },
    };

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/api/manual')) {
        return Promise.resolve(new Response(JSON.stringify(mockQueueResponse)));
      }
      if (url.includes('/api/manual/app-focus-1/kit')) {
        return Promise.resolve(new Response(JSON.stringify(maliciousKit)));
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    await act(async () => {
      root?.render(<ManualQueueView />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container?.textContent).toContain('No valid HTTP/HTTPS apply link available');
    expect(container?.querySelector('a[href^="javascript:"]')).toBeNull();
  });

  it('click-to-copy copies cover letter and candidate answers to clipboard', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/api/manual')) {
        return Promise.resolve(new Response(JSON.stringify(mockQueueResponse)));
      }
      if (url.includes('/api/manual/app-focus-1/kit')) {
        return Promise.resolve(new Response(JSON.stringify(mockKitResponse)));
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    await act(async () => {
      root?.render(<ManualQueueView />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const buttons = Array.from(container?.querySelectorAll('button') ?? []);

    // 1. Copy letter button
    const copyLetterBtn = buttons.find((b) => b.textContent?.includes('Copy Letter'));
    expect(copyLetterBtn).toBeDefined();

    await act(async () => {
      copyLetterBtn?.click();
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('Dear Cloudflare'),
    );

    // 2. Click-to-copy profile answers (e.g. notice period)
    const noticeBtn = buttons.find((b) => b.textContent?.includes('Notice: 2 weeks'));
    expect(noticeBtn).toBeDefined();

    await act(async () => {
      noticeBtn?.click();
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('2 weeks');
  });

  it('keyboard shortcuts fire navigation and action API calls', async () => {
    const postCalls: Array<{ url: string; body: unknown }> = [];

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/api/manual')) {
        return Promise.resolve(new Response(JSON.stringify(mockQueueResponse)));
      }
      if (url.includes('/kit')) {
        return Promise.resolve(new Response(JSON.stringify(mockKitResponse)));
      }
      if (init?.method === 'POST') {
        postCalls.push({ url, body: init.body });
        return Promise.resolve(new Response(JSON.stringify({ success: true })));
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    await act(async () => {
      root?.render(<ManualQueueView />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    // 1. Press 'c' to copy cover letter
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c' }));
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('Dear Cloudflare'),
    );

    // 2. Press 'a' to mark applied
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    });
    expect(postCalls.some((c) => c.url.includes('/api/manual/app-focus-1/applied'))).toBe(true);

    // 3. Press 'z' to snooze
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z' }));
    });
    expect(postCalls.some((c) => c.url.includes('/api/manual/app-focus-1/snooze'))).toBe(true);
  });
});
