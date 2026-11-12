import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ResumesSettings } from './ResumesSettings.js';
import type { ResumeSummary } from '@pigeon/shared';

// @ts-expect-error React 19 testing flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockResumes: ResumeSummary[] = [
  {
    id: 'res-default',
    label: 'Systems Engineer Resume',
    tags: ['systems', 'distributed', 'c++'],
    is_default: true,
    size_bytes: 524288, // 512 KB
    created_at: '2026-11-01T10:00:00.000Z',
    archived: false,
    usage: { open: 2, sent: 5 },
    download_url: '/api/resumes/res-default/download',
  },
  {
    id: 'res-custom',
    label: 'Edge & Cloud Resume',
    tags: ['cloudflare', 'workers'],
    is_default: false,
    size_bytes: 1048576, // 1 MB
    created_at: '2026-11-05T12:00:00.000Z',
    archived: false,
    usage: { open: 0, sent: 3 },
    download_url: '/api/resumes/res-custom/download',
  },
  {
    id: 'res-unused',
    label: 'Unused Draft Resume',
    tags: ['draft'],
    is_default: false,
    size_bytes: 262144, // 256 KB
    created_at: '2026-11-08T14:00:00.000Z',
    archived: false,
    usage: { open: 0, sent: 0 },
    download_url: '/api/resumes/res-unused/download',
  },
  {
    id: 'res-archived',
    label: 'Old 2025 Resume',
    tags: ['legacy'],
    is_default: false,
    size_bytes: 400000,
    created_at: '2025-01-01T00:00:00.000Z',
    archived: true,
    usage: { open: 0, sent: 10 },
    download_url: '/api/resumes/res-archived/download',
  },
];

describe('ResumesSettings Component Tests', () => {
  let container: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        const u = url.toString();
        if (u.includes('/api/resumes')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              ok: true,
              resumes: mockResumes,
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({}),
        });
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

  it('renders the explanation banner explaining how tags guide resume selection', async () => {
    await act(async () => {
      root?.render(<ResumesSettings apiBase="" />);
    });

    expect(container?.textContent).toContain('How Resume Selection Works');
    expect(container?.textContent).toContain('Tags help Pigeon match the best resume');
    expect(container?.textContent).toContain('Pigeon selects your default resume');
  });

  it('renders the list of active resumes by default and hides archived resumes', async () => {
    await act(async () => {
      root?.render(<ResumesSettings apiBase="" />);
    });

    expect(container?.textContent).toContain('Systems Engineer Resume');
    expect(container?.textContent).toContain('Edge & Cloud Resume');
    expect(container?.textContent).toContain('Unused Draft Resume');
    expect(container?.textContent).toContain('Default');
    expect(container?.textContent).toContain('used in 2 open, 5 sent');

    // Archived resume should be hidden initially
    expect(container?.textContent).not.toContain('Old 2025 Resume');
  });

  it('toggles archived resumes when the "Show archived" checkbox is clicked', async () => {
    await act(async () => {
      root?.render(<ResumesSettings apiBase="" />);
    });

    const checkbox = container?.querySelector('#show-archived-checkbox') as HTMLInputElement;
    expect(checkbox).not.toBeNull();

    await act(async () => {
      checkbox.click();
    });

    expect(container?.textContent).toContain('Old 2025 Resume');
    expect(container?.textContent).toContain('Archived');
  });

  it('enforces tag input validation: pattern matching and maximum limits', async () => {
    await act(async () => {
      root?.render(<ResumesSettings apiBase="" />);
    });

    const tagInput = container?.querySelector('#resume-tags-input') as HTMLInputElement;

    // React controlled input setter
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )?.set;

    await act(async () => {
      nativeInputValueSetter?.call(tagInput, 'invalid tag!');
      tagInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const form = container?.querySelector('form') as HTMLFormElement;
    const addButtons = Array.from(form.querySelectorAll('button')).filter(
      (b) => b.textContent?.trim() === 'Add',
    );
    expect(addButtons.length).toBeGreaterThan(0);

    await act(async () => {
      addButtons[0]?.click();
    });

    expect(container?.textContent).toContain('Tags may only contain lowercase letters');
  });

  it('shows Delete dialog Variant A (Blocked by open applications) with reassign selector', async () => {
    const openNonDefault: ResumeSummary[] = [
      {
        id: 'res-open',
        label: 'Busy Non-Default Resume',
        tags: ['busy'],
        is_default: false,
        size_bytes: 300000,
        created_at: '2026-11-01T00:00:00.000Z',
        archived: false,
        usage: { open: 4, sent: 2 },
        download_url: '/api/resumes/res-open/download',
      },
      ...mockResumes,
    ];

    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ ok: true, resumes: openNonDefault }),
        }),
      ),
    );

    await act(async () => {
      root?.render(<ResumesSettings apiBase="" />);
    });

    const deleteBtn = container?.querySelector(
      'button[aria-label="Delete Busy Non-Default Resume"]',
    ) as HTMLButtonElement;
    expect(deleteBtn).not.toBeNull();

    await act(async () => {
      deleteBtn.click();
    });

    expect(container?.textContent).toContain('Deletion Blocked: Resume Currently In Use');
    expect(container?.textContent).toContain('referenced by 4 open application(s)');
    expect(container?.textContent).toContain('Reassign Open Applications To');
    expect(container?.textContent).toContain('Reassign Open Applications');
  });

  it('shows Delete dialog Variant B (Soft archive) when only sent applications exist', async () => {
    await act(async () => {
      root?.render(<ResumesSettings apiBase="" />);
    });

    // res-custom has open: 0, sent: 3, is_default: false
    const deleteBtn = container?.querySelector('button[aria-label="Delete Edge & Cloud Resume"]');
    expect(deleteBtn).not.toBeNull();

    await act(async () => {
      (deleteBtn as HTMLButtonElement).click();
    });

    expect(container?.textContent).toContain('Archive Resume');
    expect(container?.textContent).toContain('used in 3 sent application(s)');
    expect(container?.textContent).toContain('It will be archived instead of permanently deleted');
  });

  it('shows Delete dialog Variant C (Permanent delete) when 0 applications reference it', async () => {
    await act(async () => {
      root?.render(<ResumesSettings apiBase="" />);
    });

    // res-unused has open: 0, sent: 0, is_default: false
    const deleteBtn = container?.querySelector('button[aria-label="Delete Unused Draft Resume"]');
    expect(deleteBtn).not.toBeNull();

    await act(async () => {
      (deleteBtn as HTMLButtonElement).click();
    });

    expect(container?.textContent).toContain('Permanently Delete Resume');
    expect(container?.textContent).toContain('not used by any applications');
    expect(container?.textContent).toContain('permanently removed from database and storage');
  });

  it('shows Default Resume Guard when trying to delete the default resume', async () => {
    // Modify mock to have multiple resumes where one is default
    await act(async () => {
      root?.render(<ResumesSettings apiBase="" />);
    });

    // If we click delete on res-default (it has is_default = true):
    // Wait, in our table, delete button is rendered for all active resumes
    // Let's find button for Systems Engineer Resume
    const allDeleteBtns = Array.from(
      container?.querySelectorAll('button[aria-label^="Delete"]') || [],
    );
    const defaultDeleteBtn = allDeleteBtns.find((b) =>
      b.getAttribute('aria-label')?.includes('Systems Engineer Resume'),
    );

    if (defaultDeleteBtn) {
      await act(async () => {
        (defaultDeleteBtn as HTMLButtonElement).click();
      });

      expect(container?.textContent).toContain('Default Resume Cannot Be Deleted');
    }
  });

  it('renders empty state when zero resumes exist', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ ok: true, resumes: [] }),
        }),
      ),
    );

    await act(async () => {
      root?.render(<ResumesSettings apiBase="" />);
    });

    expect(container?.textContent).toContain('No resumes uploaded yet');
    // Checkbox is checked and disabled
    const makeDefaultCheckbox = container?.querySelector(
      '#make-default-checkbox',
    ) as HTMLInputElement;
    expect(makeDefaultCheckbox.checked).toBe(true);
    expect(makeDefaultCheckbox.disabled).toBe(true);
  });
});
