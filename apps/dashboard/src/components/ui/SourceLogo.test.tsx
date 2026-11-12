import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SourceLogo, getSourceDisplayName } from './SourceLogo.js';

// @ts-expect-error React 19 testing flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('SourceLogo Component', () => {
  let container: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    container = null;
    root = null;
  });

  it('maps all supported source names to human-friendly display names', () => {
    expect(getSourceDisplayName('linkedin')).toBe('LinkedIn');
    expect(getSourceDisplayName('greenhouse')).toBe('Greenhouse');
    expect(getSourceDisplayName('ashby')).toBe('Ashby');
    expect(getSourceDisplayName('weworkremotely')).toBe('We Work Remotely');
    expect(getSourceDisplayName('hiring_hn')).toBe('Hacker News');
    expect(getSourceDisplayName('bamboohr')).toBe('BambooHR');
    expect(getSourceDisplayName('smartrecruiters')).toBe('SmartRecruiters');
    expect(getSourceDisplayName('custom_portal')).toBe('Custom_portal');
  });

  it('renders actual image asset for known sources with title and alt attributes', async () => {
    await act(async () => {
      root?.render(<SourceLogo source="linkedin" size="md" />);
    });

    const logoDiv = container?.querySelector('div[title="LinkedIn"]');
    expect(logoDiv).not.toBeNull();
    const img = container?.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('/logos/linkedin.png');
    expect(img?.getAttribute('alt')).toBe('LinkedIn');
  });

  it('renders display name text when showName is true', async () => {
    await act(async () => {
      root?.render(<SourceLogo source="greenhouse" size="sm" showName={true} />);
    });

    expect(container?.textContent).toContain('Greenhouse');
  });
});
