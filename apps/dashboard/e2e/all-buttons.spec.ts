import { test, expect, type Page, type Route } from '@playwright/test';

// Setup comprehensive mocks so all actions succeed cleanly without network failures
async function setupMocks(page: Page) {
  // Catch page errors and unhandled exceptions
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
  });

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('response', (res) => {
    if (res.status() >= 400) {
      console.log(`[HTTP ${res.status()}] ${res.request().method()} ${res.url()}`);
    }
  });

  // 1. Overview API
  await page.route('**/api/overview', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sendsToday: 4,
        effectiveCap: 15,
        dailyCap: 20,
        bounceRate: 2,
        failureRate: 0,
        jobsByStatus: { routed: 12, draft: 3, manual_pending: 2, sent: 4 },
        jobsByRoute: { auto_email: 7, manual_portal: 5 },
        manualWaitingCount: 2,
        authHealth: { status: 'ok', reason: null, checked_at: new Date().toISOString() },
        dryRun: true,
        killSwitch: false,
      }),
    });
  });

  // 2. Settings API
  await page.route('**/api/settings', async (route: Route) => {
    if (route.request().method() === 'POST' || route.request().method() === 'PUT') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        dryRun: true,
        killSwitch: false,
        masterKeyConfigured: true,
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
            key: 'TELEGRAM_BOT_TOKEN',
            group: 'telegram',
            type: 'string',
            class: 'SECRET',
            source: 'ui',
            isSet: true,
            maskedHint: '4567',
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
            type: 'string',
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
        ],
        profile: {
          name: 'Alex Mercer',
          email: 'alex@example.com',
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
            titles: ['Senior Engineer', 'Architect'],
            company_blacklist: ['SpamCorp'],
            min_score: 75,
          },
        },
      }),
    });
  });

  // Action test endpoints
  await page.route('**/api/settings/test/*', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, message: 'Test connection succeeded!' }),
    });
  });

  await page.route('**/api/settings/*', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });

  // 3. Resumes API
  await page.route('**/api/resumes*', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        resumes: [
          {
            id: 'resume-1',
            label: 'Primary Resume',
            tags: ['Backend', 'Cloudflare'],
            is_default: true,
            usage: { open: 0, sent: 2 },
          },
          {
            id: 'resume-2',
            label: 'Systems Resume',
            tags: ['Rust', 'Distributed'],
            is_default: false,
            usage: { open: 0, sent: 0 },
          },
        ],
      }),
    });
  });

  // 4. Review Queue API
  await page.route('**/api/review-queue', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        items: [
          {
            id: 'app-review-1',
            job_id: 'job-1',
            status: 'draft',
            cover_letter: 'Dear Acme Corp, I am excited to apply for Senior Infrastructure Engineer.',
            subject: 'Application: Senior Infrastructure Engineer',
            resume_id: 'resume-1',
            resume_label: 'Primary Resume',
            validator_errors: null,
            updated_at: new Date().toISOString(),
            title: 'Senior Infrastructure Engineer',
            company: 'Acme Corp',
            location: 'Remote',
            salary_raw: '$165k - $190k',
            description: 'Full stack infrastructure role.',
            apply_url: 'https://acme.com/jobs/infra',
            contact_email: 'recruiting@acme.com',
            contact_source: 'posting',
            match_score: 94,
            match_reasons: 'Strong TypeScript skills.',
            red_flags: [],
            untrusted: false,
            route_reason: 'AUTO_EMAIL_CONTACT',
            is_safe_for_bulk: true,
          },
        ],
      }),
    });
  });

  await page.route('**/api/applications/*', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, validation_passed: true }),
    });
  });

  // 5. Manual Apply API
  await page.route('**/api/manual', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          {
            application_id: 'app-man-1',
            job_id: 'job-man-1',
            title: 'Staff Systems Architect',
            company: 'Cloudflare',
            source: 'greenhouse',
            location: 'Remote',
            match_score: 97,
            may_be_closed: false,
            applied_before_warning: false,
            untrusted: false,
            needs_attention: false,
            route_reason_explained: 'Portal listing requiring direct submission.',
          },
        ],
        todays_focus: [
          {
            application_id: 'app-man-1',
            job_id: 'job-man-1',
            title: 'Staff Systems Architect',
            company: 'Cloudflare',
            source: 'greenhouse',
            location: 'Remote',
            match_score: 97,
            may_be_closed: false,
            applied_before_warning: false,
            untrusted: false,
            needs_attention: false,
            route_reason_explained: 'Portal listing requiring direct submission.',
          },
        ],
        needs_attention: [],
        counts: { total: 1, manual_pending: 1, needs_review: 0, snoozed: 0 },
      }),
    });
  });

  await page.route('**/api/manual/*/kit', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        kit: {
          id: 'app-man-1',
          job_id: 'job-man-1',
          title: 'Staff Systems Architect',
          company: 'Cloudflare',
          source: 'greenhouse',
          location: 'Remote',
          salary: '$180k - $220k',
          match_score: 97,
          matched_skills: ['TypeScript', 'Cloudflare Workers'],
          missing_skills: [],
          red_flags: [],
          untrusted: false,
          route_reason_explained: 'Manual submission requested by ATS portal.',
          apply_url: 'https://boards.greenhouse.io/cloudflare/jobs/12345',
          apply_domain: 'boards.greenhouse.io',
          cover_letter: 'Dear Cloudflare hiring team, I am thrilled to apply.',
          validator_errors: [],
          resume: { id: 'resume-1', label: 'Primary Resume', download_url: '#' },
          answers: {
            notice_period: '2 weeks',
            current_ctc: '$160,000',
            expected_ctc: '$195,000',
            work_authorisation: 'US Citizen',
            links: { GitHub: 'https://github.com/alexmercer' },
          },
          description: 'Staff Systems Architect position description.',
        },
      }),
    });
  });

  await page.route('**/api/manual/*/*', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, success: true }),
    });
  });

  // 6. Applications API
  await page.route('**/api/applications/*/letter', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, success: true }),
    });
  });

  await page.route('**/api/applications*', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        applications: [
          {
            id: 'app-1',
            job_id: 'job-1',
            kind: 'initial',
            channel: 'email',
            status: 'draft',
            cover_letter: 'Cover letter...',
            subject: 'Application',
            sent_at: null,
            applied_at: null,
            outcome: null,
            outcome_at: null,
            notes: null,
            updated_at: new Date().toISOString(),
            title: 'Senior Infrastructure Engineer',
            company: 'Acme Corp',
            source: 'greenhouse',
            location: 'Remote',
            match_score: 94,
            contact_email: 'recruiting@acme.com',
            apply_url: 'https://acme.com/jobs/infra',
          },
        ],
      }),
    });
  });

  // 7. Sources API
  await page.route('**/api/sources*', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        sources: [
          {
            name: 'greenhouse',
            kind: 'ats',
            circuit_state: 'closed',
            failure_count: 0,
            last_run: new Date().toISOString(),
            last_error: null,
            boards_total: 12,
            boards_failed: 0,
          },
        ],
      }),
    });
  });

  // 8. Events API
  await page.route('**/api/events*', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        events: [
          {
            id: 'evt-1',
            entity: 'application',
            entity_id: 'app-review-1',
            type: 'draft_created',
            payload: { score: 94 },
            created_at: new Date().toISOString(),
          },
        ],
      }),
    });
  });

  // 9. Setup API
  await page.route('**/api/setup/status*', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        readyForDryRun: true,
        readyToGoLive: false,
        items: [
          {
            id: 'google_oauth',
            name: 'Google Cloud & Gmail Connection',
            status: 'ok',
            message: 'Connected and healthy',
          },
          {
            id: 'google_sheets',
            name: 'Google Sheets Tracker',
            status: 'ok',
            message: 'Spreadsheet ID configured and tabs verified',
          },
        ],
      }),
    });
  });

  return { pageErrors, consoleErrors };
}

test.describe('Complete Button & Interactive UI Smoke Test Suite', () => {
  // Test desktop viewport (1280x800)
  test('Desktop: all navigation, metric, modal, action, and filter buttons execute without errors', async ({
    page,
  }) => {
    const { pageErrors, consoleErrors } = await setupMocks(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await expect(page.getByText('Pigeon')).toBeVisible();

    // 1. Overview buttons
    const overviewRefresh = page.getByRole('button', { name: /^Refresh$/i }).first();
    if (await overviewRefresh.isVisible()) {
      await overviewRefresh.click();
    }

    // Toggle Kill Switch (opens modal)
    const killSwitchBtn = page.getByRole('button', { name: /Deactivate|Emergency Kill-Switch/i }).first();
    if (await killSwitchBtn.isVisible()) {
      await killSwitchBtn.click();
      // Cancel modal
      const cancelBtn = page.getByRole('button', { name: /^Cancel$/i });
      await expect(cancelBtn).toBeVisible();
      await cancelBtn.click();
    }

    // Navigate to Review Queue
    await page.getByRole('button', { name: /^Review Queue$/i }).first().click();
    await expect(page.getByText('Email Review Queue')).toBeVisible();

    // Review Queue actions
    const copyLetterBtn = page.getByRole('button', { name: /Copy Letter/i });
    if (await copyLetterBtn.isVisible()) {
      await copyLetterBtn.click();
    }
    const saveLetterBtn = page.getByRole('button', { name: /Save & Validate/i });
    if (await saveLetterBtn.isVisible()) {
      await saveLetterBtn.click();
    }

    // Navigate to Manual Apply Queue
    await page.getByRole('button', { name: /^Manual Apply$/i }).first().click();
    await expect(page.getByText('Manual Apply Queue')).toBeVisible();

    // Test Manual Apply metrics & filter tabs
    await page.getByRole('button', { name: /Waiting/i }).first().click();
    await page.getByRole('button', { name: /Needs Review/i }).first().click();
    await page.getByRole('button', { name: /Today's Focus/i }).click();
    await page.getByRole('button', { name: /All Active/i }).click();

    // Manual Queue Refresh button
    const manualRefreshBtn = page.getByRole('button', { name: /Refresh manual queue/i });
    await expect(manualRefreshBtn).toBeVisible();
    await manualRefreshBtn.click();

    // Manual item actions
    const markAppliedBtn = page.getByRole('button', { name: /Mark Applied/i });
    if (await markAppliedBtn.isVisible()) {
      await markAppliedBtn.click();
    }

    // Navigate to Applications
    await page.getByRole('button', { name: /^Applications$/i }).first().click();
    await expect(page.getByText('All Applications')).toBeVisible();

    // Channel filter selects
    await page.getByLabel('Filter by application channel').selectOption('email');
    await page.getByLabel('Filter by application channel').selectOption('manual');
    await page.getByLabel('Filter by application channel').selectOption('');

    // Open detail modal and click Close button
    const viewDetailsBtn = page.getByRole('button', { name: /View Details/i }).first();
    if (await viewDetailsBtn.isVisible()) {
      await viewDetailsBtn.click();
      const closeBtn = page.getByRole('button', { name: /^Close$/i });
      await expect(closeBtn).toBeVisible();
      await closeBtn.click();
    }

    // Navigate to Sources
    await page.getByRole('button', { name: /^Sources$/i }).first().click();
    await expect(page.getByText('Job Sources & Ingestion Health')).toBeVisible();

    // Navigate to Settings
    await page.getByRole('button', { name: /^Settings$/i }).first().click();
    await expect(page.getByText('System Settings & Operational Controls')).toBeVisible();

    // Subtabs in Settings
    // 1) Integrations
    await page.getByRole('button', { name: /^Integrations$/i }).click();
    await expect(page.getByText('Google Sheets Tracker')).toBeVisible();

    // Test Sheets Connection button
    const testSheetsBtn = page.getByRole('button', { name: /Test Sheets Connection/i });
    await expect(testSheetsBtn).toBeVisible();
    await testSheetsBtn.click();

    // Save Sheets Settings button is disabled until changes are made
    const saveSheetsBtn = page.getByRole('button', { name: /Save Sheets Settings/i });
    await expect(saveSheetsBtn).toBeVisible();
    await expect(saveSheetsBtn).toBeDisabled();

    // Modify a field to enable save button
    await page.locator('#sheet-apps-tab-input').fill('Applications-E2E');
    await expect(saveSheetsBtn).toBeEnabled();
    await saveSheetsBtn.click();

    // Test LLM Completion button
    const testLlmBtn = page.getByRole('button', { name: /Test LLM Completion/i });
    await expect(testLlmBtn).toBeVisible();
    await testLlmBtn.click();

    // Test Telegram Notification button
    const testTelegramBtn = page.getByRole('button', { name: /Test Telegram Notification/i });
    await expect(testTelegramBtn).toBeVisible();
    await testTelegramBtn.click();

    // 2) Resumes subtab
    await page.getByRole('button', { name: /^Resumes$/i }).click();
    await expect(page.getByText('Upload PDF Resume')).toBeVisible();

    // 3) Safety subtab
    await page.getByRole('button', { name: /^Safety$/i }).click();
    await expect(page.getByText('Safety Gates & Emergency Controls')).toBeVisible();

    // 4) Profile Facts subtab
    await page.getByRole('button', { name: /^Profile$/i }).click();
    await expect(page.getByText('Profile & Candidate Information')).toBeVisible();

    // Navigate to Events
    await page.getByRole('button', { name: /^Events$/i }).first().click();
    await expect(page.getByText('Audit Events Log')).toBeVisible();

    // Filter controls in Events
    const entityFilterSelect = page.getByLabel('Filter by audit entity');
    await expect(entityFilterSelect).toBeVisible();
    await entityFilterSelect.selectOption('application');
    await entityFilterSelect.selectOption('settings');
    await entityFilterSelect.selectOption('');

    const refreshEventsBtn = page.getByRole('button', { name: /Refresh events/i });
    if (await refreshEventsBtn.isVisible()) {
      await refreshEventsBtn.click();
    }

    // Navigate to Setup via URL on desktop
    await page.goto('/setup');
    await expect(page.getByText('First-Run Setup & Readiness')).toBeVisible();

    // Assert zero page errors or console exceptions occurred
    expect(pageErrors, `Page errors encountered: ${pageErrors.join(', ')}`).toEqual([]);
    expect(consoleErrors, `Console errors encountered: ${consoleErrors.join(', ')}`).toEqual([]);
  });

  // Test mobile viewport (390x844)
  test('Mobile: bottom navbar, More bottom sheet, stacked buttons, and touch interactions work cleanly', async ({
    page,
  }) => {
    const { pageErrors, consoleErrors } = await setupMocks(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.getByText('Pigeon')).toBeVisible();

    // 1. Bottom Navbar: Switch to Review Queue
    const btmReview = page.getByRole('button', { name: /^Review Queue$/i });
    await expect(btmReview).toBeVisible();
    await btmReview.click();
    await expect(page.getByText('Email Review Queue')).toBeVisible();

    // Detail view back button on mobile
    const reviewItem = page.getByText('Acme Corp').first();
    if (await reviewItem.isVisible()) {
      await reviewItem.click();
      const backBtn = page.getByRole('button', { name: /Back to review queue/i });
      if (await backBtn.isVisible()) {
        await backBtn.click();
      }
    }

    // 2. Bottom Navbar: Switch to Manual Apply
    const btmManual = page.getByRole('button', { name: /^Manual Apply$/i });
    await expect(btmManual).toBeVisible();
    await btmManual.click();
    await expect(page.getByText('Manual Apply Queue')).toBeVisible();

    // Test responsive metric cards (Waiting, Needs Review, Snoozed)
    const waitingCard = page.getByRole('button', { name: /Waiting/i });
    await expect(waitingCard).toBeVisible();
    await waitingCard.click();

    const reviewCard = page.getByRole('button', { name: /Needs Review/i });
    await expect(reviewCard).toBeVisible();
    await reviewCard.click();

    // Mobile header refresh button
    const mobileManualRefresh = page.getByRole('button', { name: /Refresh manual queue/i });
    await expect(mobileManualRefresh).toBeVisible();
    await mobileManualRefresh.click();

    // 3. Bottom Navbar: Switch to Applications
    const btmApps = page.getByRole('button', { name: /^Applications$/i });
    await expect(btmApps).toBeVisible();
    await btmApps.click();
    await expect(page.getByText('All Applications')).toBeVisible();

    // 4. Bottom Navbar: Open "More" Drawer
    const btmMore = page.getByRole('button', { name: /Toggle navigation menu/i });
    await expect(btmMore).toBeVisible();
    await btmMore.click();

    // In More sheet: Open Settings
    const moreSettings = page.getByRole('dialog').getByRole('button', { name: /^Settings$/i });
    await expect(moreSettings).toBeVisible();
    await moreSettings.click();
    await expect(page.getByText('System Settings & Operational Controls')).toBeVisible();

    // Subtabs in Settings
    await page.getByRole('button', { name: /^Integrations$/i }).click();
    await expect(page.getByText('Google Sheets Tracker')).toBeVisible();

    // Check stacked buttons in Google Sheets (Test Sheets Connection & Save Sheets Settings)
    const testSheetsBtn = page.getByRole('button', { name: /Test Sheets Connection/i });
    const saveSheetsBtn = page.getByRole('button', { name: /Save Sheets Settings/i });
    await expect(testSheetsBtn).toBeVisible();
    await expect(saveSheetsBtn).toBeVisible();

    // Confirm save is disabled until changes are made, then test click after modification
    await expect(saveSheetsBtn).toBeDisabled();
    await testSheetsBtn.click();
    await page.locator('#sheet-apps-tab-input').fill('Applications-Mobile-E2E');
    await expect(saveSheetsBtn).toBeEnabled();
    await saveSheetsBtn.click();

    // Check LLM buttons
    const testLlmBtn = page.getByRole('button', { name: /Test LLM Completion/i });
    await expect(testLlmBtn).toBeVisible();
    await testLlmBtn.click();

    // Check Telegram buttons
    const testTgBtn = page.getByRole('button', { name: /Test Telegram Notification/i });
    await expect(testTgBtn).toBeVisible();
    await testTgBtn.click();

    // Open More sheet again to test Sources
    await btmMore.click();
    const moreSources = page.getByRole('dialog').getByRole('button', { name: /^Sources$/i });
    await expect(moreSources).toBeVisible();
    await moreSources.click();
    await expect(page.getByText('Job Sources & Ingestion Health')).toBeVisible();

    // Open More sheet again to test Events
    await btmMore.click();
    const moreEvents = page.getByRole('dialog').getByRole('button', { name: /^Events$/i });
    await expect(moreEvents).toBeVisible();
    await moreEvents.click();
    await expect(page.getByText('Audit Events Log')).toBeVisible();

    // Open More sheet again to test Setup
    await btmMore.click();
    const moreSetup = page.getByRole('dialog').getByRole('button', { name: /^Setup$/i });
    await expect(moreSetup).toBeVisible();
    await moreSetup.click();
    await expect(page.getByText('First-Run Setup & Readiness')).toBeVisible();

    // Return to Overview via mobile bottom navigation
    const btmNav = page.getByRole('navigation', { name: 'Mobile navigation' });
    const btmOverview = btmNav.getByRole('button', { name: /^Overview$/i });
    await expect(btmOverview).toBeVisible();
    await btmOverview.click();
    await expect(page.getByRole('heading', { name: 'Operations Controls' })).toBeVisible();

    // Assert zero page errors or console exceptions occurred
    expect(pageErrors, `Page errors encountered on mobile: ${pageErrors.join(', ')}`).toEqual([]);
    expect(consoleErrors, `Console errors encountered on mobile: ${consoleErrors.join(', ')}`).toEqual([]);
  });
});
