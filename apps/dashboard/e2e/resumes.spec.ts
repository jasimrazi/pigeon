import { test, expect, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
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

function copyToArtifact(filename: string) {
  const src = path.join(screenshotsDir, filename);
  const dest = path.join(artifactDir, filename);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
  }
}

test.describe('Resumes Feature E2E, Axe Accessibility & Screenshot Suite', () => {
  test('1. Core E2E Flow: upload PDF, see in list, set second default, see blocked delete message', async ({
    page,
  }) => {
    let mockResumes = [
      {
        id: 'res-default',
        label: 'Systems Engineering Resume',
        tags: ['systems', 'distributed', 'linux'],
        is_default: true,
        size_bytes: 524288,
        created_at: '2026-11-01T10:00:00.000Z',
        archived: false,
        usage: { open: 3, sent: 12 },
        download_url: '/api/resumes/res-default/download',
      },
      {
        id: 'res-fullstack',
        label: 'Fullstack Edge Resume',
        tags: ['typescript', 'react', 'cloudflare'],
        is_default: false,
        size_bytes: 412000,
        created_at: '2026-11-05T12:00:00.000Z',
        archived: false,
        usage: { open: 0, sent: 4 },
        download_url: '/api/resumes/res-fullstack/download',
      },
    ];

    // Mock API
    await page.route('**/api/overview', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sendsToday: 2,
          effectiveCap: 15,
          dailyCap: 20,
          bounceRate: 0,
          failureRate: 0,
          jobsByStatus: { routed: 5, draft: 3 },
          jobsByRoute: { auto_email: 3, manual_portal: 2 },
          manualWaitingCount: 2,
          authHealth: { status: 'ok', reason: null, checked_at: new Date().toISOString() },
          dryRun: true,
          killSwitch: false,
        }),
      });
    });

    await page.route('**/api/settings', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          profile: {
            name: 'Alex Mercer',
            email: 'alex.mercer@example.com',
            skills: ['TypeScript', 'Cloudflare Workers', 'Distributed Systems'],
            send_settings: {
              daily_cap: 20,
              window: { start: '09:00', end: '18:00' },
              timezone: 'UTC',
              ramp_base: 5,
              ramp_step: 2,
              auto_approve_above_score: 85,
            },
          },
          dryRun: true,
          killSwitch: false,
          masterKeyConfigured: true,
          settings: [],
        }),
      });
    });

    await page.route('**/api/resumes', async (route: Route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ resumes: mockResumes }),
        });
      } else if (route.request().method() === 'POST') {
        const newResume = {
          id: 'res-newly-uploaded',
          label: 'Platform Infrastructure Resume',
          tags: ['infra', 'kubernetes'],
          is_default: false,
          size_bytes: 350000,
          created_at: new Date().toISOString(),
          archived: false,
          usage: { open: 0, sent: 0 },
          download_url: '/api/resumes/res-newly-uploaded/download',
        };
        mockResumes.push(newResume);
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, resume: newResume }),
        });
      }
    });

    await page.route('**/api/resumes/*', async (route: Route) => {
      const url = route.request().url();
      if (route.request().method() === 'PATCH') {
        // Toggle default
        mockResumes = mockResumes.map((r) => ({
          ...r,
          is_default: url.includes(r.id),
        }));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true }),
        });
      } else if (route.request().method() === 'DELETE') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, action: 'deleted' }),
        });
      }
    });

    // 1. Navigate to Settings > Resumes
    await page.goto('/');
    await page.click('button:has-text("Settings")');
    await page.click('button:has-text("Resumes")');

    // 2. Upload a new PDF resume
    const pdfBuffer = Buffer.from(
      '%PDF-1.4\n1 0 obj << /Length 5 >> stream\nhello\nendstream endobj\n%%EOF',
    );
    await page.setInputFiles('#resume-file-picker', {
      name: 'platform-infra.pdf',
      mimeType: 'application/pdf',
      buffer: pdfBuffer,
    });

    await page.fill('#resume-label-input', 'Platform Infrastructure Resume');
    await page.fill('#resume-tags-input', 'infra');
    await page.keyboard.press('Enter');
    await page.click('button:has-text("Upload Resume")');

    // 3. Verify it appears in the list
    await expect(page.locator('tbody').getByText('Platform Infrastructure Resume')).toBeVisible();

    // 4. Set the second resume as default
    const setDefBtn = page.locator('button[aria-label="Set Fullstack Edge Resume as default"]');
    if (await setDefBtn.isVisible()) {
      await setDefBtn.click();
      await expect(page.locator('text=is now your default resume')).toBeVisible();
    }

    // 5. Try deleting a resume in use (Systems Engineering Resume has open: 3)
    const deleteBtn = page.locator('button[aria-label="Delete Systems Engineering Resume"]');
    await deleteBtn.click();

    // Verify blocked message appears
    await expect(page.locator('text=Deletion Blocked: Resume Currently In Use')).toBeVisible();
    await expect(page.locator('text=referenced by 3 open application(s)')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reassign Open Applications' })).toBeVisible();
  });

  test('2. Axe Accessibility Scan on Resumes Tab', async ({ page }) => {
    await page.goto('/');
    await page.click('button:has-text("Settings")');
    await page.click('button:has-text("Resumes")');
    await page.waitForTimeout(500);

    const axeResults = await new AxeBuilder({ page }).analyze();
    const criticalViolations = axeResults.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(criticalViolations).toEqual([]);
  });

  test('3. Visual Screenshots: Resumes Tab (Empty, With Data, 3 Delete Dialog Variants)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });

    const fullResumesList = [
      {
        id: 'res-default',
        label: 'Systems Engineering Resume',
        tags: ['systems', 'distributed', 'linux'],
        is_default: true,
        size_bytes: 524288,
        created_at: '2026-11-01T10:00:00.000Z',
        archived: false,
        usage: { open: 0, sent: 5 },
        download_url: '/api/resumes/res-default/download',
      },
      {
        id: 'res-in-use',
        label: 'Platform Infrastructure Resume',
        tags: ['infra', 'kubernetes'],
        is_default: false,
        size_bytes: 412000,
        created_at: '2026-11-05T12:00:00.000Z',
        archived: false,
        usage: { open: 3, sent: 12 },
        download_url: '/api/resumes/res-in-use/download',
      },
      {
        id: 'res-sent-only',
        label: 'Fullstack Edge Resume',
        tags: ['typescript', 'react', 'cloudflare'],
        is_default: false,
        size_bytes: 380000,
        created_at: '2026-11-06T14:00:00.000Z',
        archived: false,
        usage: { open: 0, sent: 8 },
        download_url: '/api/resumes/res-sent-only/download',
      },
      {
        id: 'res-unused',
        label: 'Backend Rust Resume',
        tags: ['rust', 'backend'],
        is_default: false,
        size_bytes: 280000,
        created_at: '2026-11-08T15:00:00.000Z',
        archived: false,
        usage: { open: 0, sent: 0 },
        download_url: '/api/resumes/res-unused/download',
      },
      {
        id: 'res-legacy',
        label: 'Legacy 2025 Resume',
        tags: ['legacy'],
        is_default: false,
        size_bytes: 350000,
        created_at: '2025-06-01T00:00:00.000Z',
        archived: true,
        usage: { open: 0, sent: 15 },
        download_url: '/api/resumes/res-legacy/download',
      },
    ];

    const themes: Array<'light' | 'dark'> = ['light', 'dark'];

    for (const theme of themes) {
      // Setup mock with data
      await page.route('**/api/overview', async (route: Route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            sendsToday: 4,
            effectiveCap: 15,
            dailyCap: 20,
            bounceRate: 0,
            failureRate: 0,
            jobsByStatus: { routed: 8, draft: 3 },
            jobsByRoute: { auto_email: 4, manual_portal: 4 },
            manualWaitingCount: 3,
            authHealth: { status: 'ok', reason: null, checked_at: new Date().toISOString() },
            dryRun: true,
            killSwitch: false,
          }),
        });
      });

      await page.route('**/api/settings', async (route: Route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            profile: {
              name: 'Alex Mercer',
              email: 'alex.mercer@example.com',
              skills: ['TypeScript', 'Cloudflare Workers', 'Distributed Systems'],
              send_settings: {
                daily_cap: 20,
                window: { start: '09:00', end: '18:00' },
                timezone: 'UTC',
                ramp_base: 5,
                ramp_step: 2,
                auto_approve_above_score: 85,
              },
            },
            dryRun: true,
            killSwitch: false,
            masterKeyConfigured: true,
            settings: [],
          }),
        });
      });

      // 1. Resumes With Data Screenshot
      await page.route('**/api/resumes', async (route: Route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ resumes: fullResumesList }),
        });
      });

      await page.goto('/');
      await page.evaluate((t) => {
        document.documentElement.setAttribute('data-theme', t);
      }, theme);
      await page.waitForTimeout(100);

      await page.click('button:has-text("Settings")');
      await page.click('button:has-text("Resumes")');
      await page.waitForTimeout(400);

      const dataShot = `resumes-data-${theme}.png`;
      await page.screenshot({ path: path.join(screenshotsDir, dataShot), fullPage: true });
      copyToArtifact(dataShot);

      // 2. Delete Dialog Variant A: Blocked by open applications (Platform Infrastructure Resume has open: 3)
      await page.locator('button[aria-label="Delete Platform Infrastructure Resume"]').click();
      await page.waitForTimeout(400);

      const blockedShot = `resumes-delete-blocked-${theme}.png`;
      await page.screenshot({ path: path.join(screenshotsDir, blockedShot), fullPage: true });
      copyToArtifact(blockedShot);

      // Close modal
      await page.click('button:has-text("Cancel")');
      await page.waitForTimeout(200);

      // 3. Delete Dialog Variant B: Soft Archive (Fullstack Edge Resume has open: 0, sent: 8)
      await page.locator('button[aria-label="Delete Fullstack Edge Resume"]').click();
      await page.waitForTimeout(400);

      const archiveShot = `resumes-delete-archive-${theme}.png`;
      await page.screenshot({ path: path.join(screenshotsDir, archiveShot), fullPage: true });
      copyToArtifact(archiveShot);

      // Close modal
      await page.click('button:has-text("Cancel")');
      await page.waitForTimeout(200);

      // 4. Delete Dialog Variant C: Permanent Delete (Backend Rust Resume has open: 0, sent: 0)
      await page.locator('button[aria-label="Delete Backend Rust Resume"]').click();
      await page.waitForTimeout(400);

      const permanentShot = `resumes-delete-permanent-${theme}.png`;
      await page.screenshot({ path: path.join(screenshotsDir, permanentShot), fullPage: true });
      copyToArtifact(permanentShot);

      // Close modal
      await page.click('button:has-text("Cancel")');
      await page.waitForTimeout(200);

      // 5. Empty State Screenshot
      await page.unroute('**/api/resumes');
      await page.route('**/api/resumes', async (route: Route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ resumes: [] }),
        });
      });

      // Refresh Resumes tab
      await page.click('button[aria-label="Refresh resumes"]');
      await page.waitForTimeout(400);

      const emptyShot = `resumes-empty-${theme}.png`;
      await page.screenshot({ path: path.join(screenshotsDir, emptyShot), fullPage: true });
      copyToArtifact(emptyShot);
    }
  });
});
