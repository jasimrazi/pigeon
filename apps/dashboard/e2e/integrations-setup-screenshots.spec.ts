import { test, expect, type Route } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const screenshotsDir = path.resolve(__dirname, '../screenshots');
const artifactDir =
  'C:/Users/Elara/.gemini/antigravity-cli/brain/31dcf282-d28d-4712-af4a-a9eb1f2a7990';

if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

test.describe('Settings > Integrations and Setup Page Screenshots', () => {
  test.beforeEach(async ({ page }) => {
    // Mock /api/overview
    await page.route('**/api/overview', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
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
    });

    // Mock /api/settings
    await page.route('**/api/settings', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          settings: [
            {
              key: 'GOOGLE_CLIENT_ID',
              group: 'google',
              type: 'string',
              class: 'SECRET',
              source: 'ui',
              isSet: true,
              maskedHint: '8910',
              updatedAt: new Date().toISOString(),
            },
            {
              key: 'GOOGLE_CLIENT_SECRET',
              group: 'google',
              type: 'string',
              class: 'SECRET',
              source: 'ui',
              isSet: true,
              maskedHint: 'GOCX',
              updatedAt: new Date().toISOString(),
            },
            {
              key: 'GOOGLE_SHEET_ID',
              group: 'sheets',
              type: 'string',
              class: 'SETTING',
              source: 'ui',
              isSet: true,
              value: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
              updatedAt: new Date().toISOString(),
            },
            {
              key: 'SHEET_TAB_APPLICATIONS',
              group: 'sheets',
              type: 'string',
              class: 'SETTING',
              source: 'ui',
              isSet: true,
              value: 'Applications',
              updatedAt: new Date().toISOString(),
            },
            {
              key: 'SHEET_TAB_METRICS',
              group: 'sheets',
              type: 'string',
              class: 'SETTING',
              source: 'ui',
              isSet: true,
              value: 'Metrics',
              updatedAt: new Date().toISOString(),
            },
            {
              key: 'LLM_PROVIDER',
              group: 'llm',
              type: 'select',
              class: 'SETTING',
              source: 'ui',
              isSet: true,
              value: 'workers-ai',
              updatedAt: new Date().toISOString(),
            },
            {
              key: 'LLM_MODEL',
              group: 'llm',
              type: 'string',
              class: 'SETTING',
              source: 'ui',
              isSet: true,
              value: '@cf/meta/llama-3.3-70b-instruct',
              updatedAt: new Date().toISOString(),
            },
            {
              key: 'GEMINI_API_KEY',
              group: 'llm',
              type: 'string',
              class: 'SECRET',
              source: 'unset',
              isSet: false,
              updatedAt: null,
            },
            {
              key: 'TELEGRAM_BOT_TOKEN',
              group: 'telegram',
              type: 'string',
              class: 'SECRET',
              source: 'ui',
              isSet: true,
              maskedHint: '5566',
              updatedAt: new Date().toISOString(),
            },
            {
              key: 'TELEGRAM_CHAT_ID',
              group: 'telegram',
              type: 'string',
              class: 'SETTING',
              source: 'ui',
              isSet: true,
              value: '987654321',
              updatedAt: new Date().toISOString(),
            },
            {
              key: 'USER_AGENT_CONTACT_EMAIL',
              group: 'identity',
              type: 'email',
              class: 'SETTING',
              source: 'ui',
              isSet: true,
              value: 'operator@example.com',
              updatedAt: new Date().toISOString(),
            },
            {
              key: 'TIMEZONE',
              group: 'identity',
              type: 'string',
              class: 'SETTING',
              source: 'ui',
              isSet: true,
              value: 'UTC',
              updatedAt: new Date().toISOString(),
            },
            {
              key: 'ALERT_FORWARDING_ADDRESS',
              group: 'identity',
              type: 'email',
              class: 'SETTING',
              source: 'ui',
              isSet: true,
              value: 'alerts@example.com',
              updatedAt: new Date().toISOString(),
            },
          ],
          profile: {
            name: 'Alex Mercer',
            email: 'alex.mercer@example.com',
            skills: ['TypeScript', 'Cloudflare Workers', 'Distributed Systems'],
            send_settings: {
              daily_cap: 20,
              ramp_base: 5,
              ramp_step: 2,
              window: { start: '09:00', end: '18:00' },
              timezone: 'UTC',
              auto_approve_above_score: 85,
            },
            filters: {
              titles: ['Software Engineer', 'Backend Engineer'],
              company_blacklist: ['SpamCorp'],
              min_score: 75,
            },
          },
          resumes: [],
          dryRun: true,
          killSwitch: false,
          masterKeyConfigured: true,
          masterKeyError: null,
          legacyEnvKeys: [],
        }),
      });
    });

    // Mock /api/auth/google/health
    await page.route('**/api/auth/google/health', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          health: {
            status: 'ok',
            reason: null,
            checked_at: new Date().toISOString(),
          },
        }),
      });
    });

    // Mock /api/setup/status
    await page.route('**/api/setup/status', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              id: 'master_key',
              name: 'Master Encryption Key',
              status: 'ok',
              message: 'Configured and active for token & setting encryption',
            },
            {
              id: 'profile',
              name: 'Candidate Profile',
              status: 'ok',
              message: 'Configured with contact facts and skill grounding',
            },
            {
              id: 'llm',
              name: 'LLM Provider & Model',
              status: 'ok',
              message: 'Workers AI (@cf/meta/llama-3.3-70b-instruct) configured',
            },
            {
              id: 'google_oauth',
              name: 'Google Cloud Credentials',
              status: 'ok',
              message: 'Client ID and Client Secret saved',
            },
            {
              id: 'google_account',
              name: 'Google Account Sign-In',
              status: 'ok',
              message: 'Authorized and healthy token active',
            },
            {
              id: 'sheets',
              name: 'Google Sheets Tracker',
              status: 'ok',
              message: 'Spreadsheet ID configured and tabs verified',
            },
            {
              id: 'telegram',
              name: 'Telegram Notifications',
              status: 'ok',
              message: 'Bot token and Chat ID saved',
            },
          ],
          readyForDryRun: true,
          readyToGoLive: true,
        }),
      });
    });
  });

  test('captures Settings > Integrations in light and dark mode', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto('/');

    // Navigate to Settings tab
    await page.getByRole('button', { name: /^Settings$/i }).click();

    // Navigate to Integrations sub-tab
    await page.getByRole('button', { name: /^Integrations$/i }).click();
    await expect(page.getByText('Google Cloud & Gmail Connection')).toBeVisible();

    // 1. Light Mode
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'light');
    });
    await page.waitForTimeout(300);

    const lightPath = path.join(screenshotsDir, 'settings-integrations-light.png');
    await page.screenshot({ path: lightPath, fullPage: true });

    // Also copy to artifactDir if exists
    if (fs.existsSync(artifactDir)) {
      fs.copyFileSync(lightPath, path.join(artifactDir, 'settings-integrations-light.png'));
    }

    // 2. Dark Mode
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });
    await page.waitForTimeout(300);

    const darkPath = path.join(screenshotsDir, 'settings-integrations-dark.png');
    await page.screenshot({ path: darkPath, fullPage: true });

    if (fs.existsSync(artifactDir)) {
      fs.copyFileSync(darkPath, path.join(artifactDir, 'settings-integrations-dark.png'));
    }
  });

  test('captures /setup page in light and dark mode', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/setup');
    await expect(page.getByText('First-Run Setup & Readiness')).toBeVisible();

    // 1. Light Mode
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'light');
    });
    await page.waitForTimeout(300);

    const lightPath = path.join(screenshotsDir, 'setup-light.png');
    await page.screenshot({ path: lightPath, fullPage: true });

    if (fs.existsSync(artifactDir)) {
      fs.copyFileSync(lightPath, path.join(artifactDir, 'setup-light.png'));
    }

    // 2. Dark Mode
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });
    await page.waitForTimeout(300);

    const darkPath = path.join(screenshotsDir, 'setup-dark.png');
    await page.screenshot({ path: darkPath, fullPage: true });

    if (fs.existsSync(artifactDir)) {
      fs.copyFileSync(darkPath, path.join(artifactDir, 'setup-dark.png'));
    }
  });
});
