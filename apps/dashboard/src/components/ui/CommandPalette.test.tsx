import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { CommandPalette } from './CommandPalette.js';

// @ts-expect-error global IS_REACT_ACT_ENVIRONMENT flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('CommandPalette', () => {
  let container: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;

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

  it('filters actions by query and invokes selected action on click', async () => {
    const onSelectOverview = vi.fn();
    const onSelectSync = vi.fn();
    const onClose = vi.fn();

    await act(async () => {
      root?.render(
        <CommandPalette
          isOpen={true}
          onClose={onClose}
          actions={[
            {
              id: 'overview',
              label: 'Go to Overview',
              group: 'Navigation',
              onSelect: onSelectOverview,
            },
            {
              id: 'sync-sheet',
              label: 'Sync Google Sheet',
              group: 'Actions',
              keywords: 'spreadsheet',
              onSelect: onSelectSync,
            },
          ]}
        />,
      );
    });

    const input = document.querySelector('input[aria-label="Search commands"]') as HTMLInputElement;
    expect(input).not.toBeNull();

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(input, 'spreadsheet');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('Sync Google Sheet');
    expect(dialog?.textContent).not.toContain('Go to Overview');

    const actionBtn = Array.from(dialog?.querySelectorAll('button') ?? []).find((b) =>
      b.textContent?.includes('Sync Google Sheet'),
    );
    await act(async () => {
      actionBtn?.click();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelectSync).toHaveBeenCalledTimes(1);
  });
});
