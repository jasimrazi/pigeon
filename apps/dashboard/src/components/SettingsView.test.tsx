import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsView } from './SettingsView.js';
import { SetupView } from './SetupView.js';
import { SecretSettingField } from './SecretSettingField.js';

// @ts-expect-error React 19 testing flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('SettingsView & SetupView Sub-Navigation & Integrations', () => {
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

        if (u.includes('/api/settings')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              ok: true,
              settings: [
                {
                  key: 'GOOGLE_CLIENT_ID',
                  group: 'google',
                  type: 'string',
                  class: 'SECRET',
                  source: 'ui',
                  isSet: true,
                  maskedHint: '9abc',
                },
                {
                  key: 'GOOGLE_CLIENT_SECRET',
                  group: 'google',
                  type: 'string',
                  class: 'SECRET',
                  source: 'ui',
                  isSet: true,
                  maskedHint: 'wxyz',
                },
                {
                  key: 'GOOGLE_SHEET_ID',
                  group: 'sheets',
                  type: 'string',
                  class: 'SETTING',
                  source: 'ui',
                  isSet: true,
                  value: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
                },
                {
                  key: 'SHEET_TAB_APPLICATIONS',
                  group: 'sheets',
                  type: 'string',
                  class: 'SETTING',
                  source: 'ui',
                  isSet: true,
                  value: 'Applications',
                },
                {
                  key: 'SHEET_TAB_METRICS',
                  group: 'sheets',
                  type: 'string',
                  class: 'SETTING',
                  source: 'ui',
                  isSet: true,
                  value: 'Metrics',
                },
                {
                  key: 'LLM_PROVIDER',
                  group: 'llm',
                  type: 'select',
                  class: 'SETTING',
                  source: 'ui',
                  isSet: true,
                  value: 'workers-ai',
                },
                {
                  key: 'LLM_MODEL',
                  group: 'llm',
                  type: 'string',
                  class: 'SETTING',
                  source: 'ui',
                  isSet: true,
                  value: '@cf/meta/llama-3.3-70b-instruct',
                },
                {
                  key: 'GEMINI_API_KEY',
                  group: 'llm',
                  type: 'string',
                  class: 'SECRET',
                  source: 'unset',
                  isSet: false,
                },
                {
                  key: 'TELEGRAM_BOT_TOKEN',
                  group: 'telegram',
                  type: 'string',
                  class: 'SECRET',
                  source: 'ui',
                  isSet: true,
                  maskedHint: '7890',
                },
                {
                  key: 'TELEGRAM_CHAT_ID',
                  group: 'telegram',
                  type: 'string',
                  class: 'SETTING',
                  source: 'ui',
                  isSet: true,
                  value: '12345678',
                },
                {
                  key: 'USER_AGENT_CONTACT_EMAIL',
                  group: 'identity',
                  type: 'email',
                  class: 'SETTING',
                  source: 'ui',
                  isSet: true,
                  value: 'bot@example.com',
                },
                {
                  key: 'TIMEZONE',
                  group: 'identity',
                  type: 'string',
                  class: 'SETTING',
                  source: 'ui',
                  isSet: true,
                  value: 'UTC',
                },
              ],
              profile: {
                name: 'Alex Mercer',
                email: 'alex@example.com',
                skills: ['TypeScript', 'Cloudflare Workers'],
                send_settings: {
                  daily_cap: 25,
                  ramp_base: 5,
                  ramp_step: 2,
                  window: { start: '09:00', end: '18:00' },
                  timezone: 'UTC',
                  auto_approve_above_score: 85,
                },
                filters: {
                  titles: ['Software Engineer'],
                  company_blacklist: ['SpamCorp'],
                  min_score: 70,
                },
              },
              dryRun: true,
              killSwitch: false,
              masterKeyConfigured: true,
              masterKeyError: null,
              legacyEnvKeys: [],
            }),
          });
        }

        if (u.includes('/api/auth/google/health')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              ok: true,
              health: { status: 'ok', reason: null, checked_at: new Date().toISOString() },
            }),
          });
        }

        if (u.includes('/api/setup/status')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              items: [
                {
                  id: 'master_key',
                  name: 'Master Encryption Key',
                  status: 'ok',
                  message: 'Configured',
                },
                { id: 'profile', name: 'Candidate Profile', status: 'ok', message: 'Configured' },
                { id: 'llm', name: 'LLM Provider & Model', status: 'ok', message: 'Configured' },
                {
                  id: 'google_oauth',
                  name: 'Google Cloud Credentials',
                  status: 'ok',
                  message: 'Configured',
                },
                {
                  id: 'google_account',
                  name: 'Google Account Sign-In',
                  status: 'ok',
                  message: 'Connected',
                },
                {
                  id: 'sheets',
                  name: 'Google Sheets Tracker',
                  status: 'ok',
                  message: 'Configured',
                },
              ],
              readyForDryRun: true,
              readyToGoLive: true,
            }),
          });
        }

        return Promise.reject(new Error(`Unhandled URL: ${u}`));
      }),
    );
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
    vi.restoreAllMocks();
  });

  it('renders sub-navigation tabs (Profile, Integrations, Safety) and allows switching', async () => {
    await act(async () => {
      root?.render(<SettingsView />);
    });

    // Verify sub-nav buttons
    const buttons = Array.from(container?.querySelectorAll('button') || []);
    const profileTab = buttons.find((b) => b.textContent?.includes('Profile'));
    const integrationsTab = buttons.find((b) => b.textContent?.includes('Integrations'));
    const safetyTab = buttons.find((b) => b.textContent?.includes('Safety'));

    expect(profileTab).toBeDefined();
    expect(integrationsTab).toBeDefined();
    expect(safetyTab).toBeDefined();

    // Default tab is Profile
    expect(container?.textContent).toContain('Profile & Candidate Information');
    expect(container?.textContent).toContain('Candidate Full Name');

    // Switch to Integrations
    await act(async () => {
      integrationsTab?.click();
    });

    expect(container?.textContent).toContain('Google Cloud & Gmail Connection');
    expect(container?.textContent).toContain('Google Sheets Tracker');
    expect(container?.textContent).toContain('LLM Provider & Model');
    expect(container?.textContent).toContain('Notifications & Alerts (Telegram)');
    expect(container?.textContent).toContain('Sending Identity & Headers');

    // Switch to Safety
    await act(async () => {
      safetyTab?.click();
    });

    expect(container?.textContent).toContain('Safety Gates & Emergency Controls');
    expect(container?.textContent).toContain('Kill Switch');
    expect(container?.textContent).toContain('DRY_RUN Mode');
  });

  it('renders secret fields with masked hint and Replace/Clear actions in Integrations', async () => {
    await act(async () => {
      root?.render(<SettingsView initialSubTab="integrations" />);
    });

    // Google Client ID is a secret and isSet: true with hint 9abc
    expect(container?.textContent).toContain('Google Client ID');
    expect(container?.textContent).toContain('ends in ••••9abc');

    // Google Client Secret is a secret and isSet: true with hint wxyz
    expect(container?.textContent).toContain('Google Client Secret');
    expect(container?.textContent).toContain('ends in ••••wxyz');

    // Clicking Replace renders a password input with Cancel button
    const replaceButtons = Array.from(container?.querySelectorAll('button') || []).filter((b) =>
      b.textContent?.includes('Replace'),
    );
    expect(replaceButtons.length).toBeGreaterThanOrEqual(1);

    await act(async () => {
      replaceButtons[0]?.click();
    });

    const passwordInput = container?.querySelector('input[type="password"]');
    expect(passwordInput).not.toBeNull();
    expect(container?.textContent).toContain('Cancel Replace');
  });

  it('renders 7-day refresh token warning and collapsible How-to-get-this in Google Cloud card', async () => {
    await act(async () => {
      root?.render(<SettingsView initialSubTab="integrations" />);
    });

    // 7-day token warning
    expect(container?.textContent).toContain('Google refresh tokens expire every 7 days');

    // Collapsible details
    expect(container?.textContent).toContain('How to get Google Cloud credentials');
  });

  it('renders SetupView checklist items and readiness badges', async () => {
    await act(async () => {
      root?.render(<SetupView />);
    });

    expect(container?.textContent).toContain('First-Run Setup & Readiness');
    expect(container?.textContent).toContain('Ready for Dry-Run');
    expect(container?.textContent).toContain('Ready to Go Live');
    expect(container?.textContent).toContain('Candidate Profile');
    expect(container?.textContent).toContain('Google Cloud Credentials');
  });

  it('SecretSettingField: write-only behavior, never reveals secret plaintext unless explicitly typed', async () => {
    let enteredValue = '';
    const mockOnChange = vi.fn((val: string) => {
      enteredValue = val;
    });

    await act(async () => {
      root?.render(
        <SecretSettingField
          id="test-secret"
          label="Test Secret"
          summary={{
            key: 'GOOGLE_CLIENT_SECRET',
            group: 'google',
            type: 'string',
            class: 'SECRET',
            source: 'ui',
            isSet: true,
            maskedHint: '1234',
            updatedAt: '2026-11-11T00:00:00.000Z',
          }}
          value={enteredValue}
          onChange={mockOnChange}
        />,
      );
    });

    // Initially shows Saved + masked hint
    expect(container?.textContent).toContain('Saved');
    expect(container?.textContent).toContain('ends in ••••1234');
    // Input is NOT in DOM
    expect(container?.querySelector('input')).toBeNull();

    // Click Replace
    const replaceBtn = Array.from(container?.querySelectorAll('button') || []).find((b) =>
      b.textContent?.includes('Replace'),
    );
    await act(async () => {
      replaceBtn?.click();
    });

    // Now input is in DOM with type=password and autoComplete=off
    const input = container?.querySelector('input') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.type).toBe('password');
    expect(input.getAttribute('autocomplete')).toBe('off');
  });
});
