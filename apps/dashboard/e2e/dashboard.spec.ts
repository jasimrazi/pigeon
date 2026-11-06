import { test, expect } from '@playwright/test';

test.describe('Pigeon Operations & Workflows E2E', () => {
  test('Review Queue (edit, approve) and Manual Apply (mark applied) reflect on Applications page', async ({
    page,
  }) => {
    page.on('console', (msg) => console.log('[BROWSER CONSOLE]', msg.text()));
    page.on('pageerror', (err) => console.log('[BROWSER PAGE ERROR]', err.message));
    page.on('request', (req) => console.log('[REQ]', req.method(), req.url()));
    page.on('response', (res) => console.log('[RESP]', res.status(), res.url()));

    // Dynamic mock state for E2E flow
    let reviewItemStatus = 'draft';
    let reviewLetter = 'Initial cover letter draft for Acme Corp.';
    let manualItemStatus = 'manual_pending';

    // Mock API requests
    await page.route('**/api/overview', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sendsToday: 2,
          effectiveCap: 15,
          dailyCap: 20,
          bounceRate: 0,
          failureRate: 0,
          jobsByStatus: { routed: 4, draft: 1, manual_pending: 1 },
          jobsByRoute: { auto_email: 1, manual_portal: 1 },
          manualWaitingCount: 1,
          authHealth: { status: 'ok', reason: null, checked_at: new Date().toISOString() },
          dryRun: true,
          killSwitch: false,
        }),
      });
    });

    await page.route('**/api/resumes', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          resumes: [
            { id: 'resume-1', label: 'Primary Resume', tags: ['Backend'], is_default: true },
          ],
        }),
      });
    });

    await page.route('**/api/review-queue', async (route) => {
      const items =
        reviewItemStatus === 'draft'
          ? [
              {
                id: 'app-review-e2e',
                job_id: 'job-e2e-1',
                status: reviewItemStatus,
                cover_letter: reviewLetter,
                subject: 'Application for Senior Infrastructure Engineer',
                resume_id: 'resume-1',
                resume_label: 'Primary Resume',
                validator_errors: null,
                updated_at: new Date().toISOString(),
                title: 'Senior Infrastructure Engineer',
                company: 'Acme Corp',
                location: 'Remote',
                salary_raw: '$180,000',
                description: 'We are seeking a senior infrastructure engineer.',
                apply_url: 'https://acme.com/jobs/senior-infra',
                contact_email: 'recruiter@acme.com',
                contact_source: 'posting',
                match_score: 95,
                match_reasons: 'Perfect fit for Cloudflare Workers & TypeScript',
                red_flags: [],
                untrusted: false,
                route_reason: 'AUTO_EMAIL_CONTACT',
                is_safe_for_bulk: true,
              },
            ]
          : [];

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, items }),
      });
    });

    await page.route('**/api/applications/app-review-e2e/letter', async (route) => {
      const postData = route.request().postDataJSON() as { cover_letter: string };
      reviewLetter = postData.cover_letter;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, validator_errors: [] }),
      });
    });

    await page.route('**/api/applications/app-review-e2e/approve', async (route) => {
      reviewItemStatus = 'approved';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, success: true }),
      });
    });

    await page.route('**/api/manual', async (route) => {
      const items =
        manualItemStatus === 'manual_pending'
          ? [
              {
                application_id: 'app-manual-e2e',
                job_id: 'job-e2e-2',
                channel: 'manual',
                status: manualItemStatus,
                title: 'Platform Architect',
                company: 'Cloudflare',
                company_normalized: 'cloudflare',
                source: 'greenhouse',
                location: 'Remote',
                remote: true,
                salary_raw: '$200,000',
                salary_min: 200000,
                salary_max: 200000,
                currency: 'USD',
                match_score: 98,
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
            ]
          : [];

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          items,
          todays_focus: items,
          needs_attention: [],
          counts: {
            total: items.length,
            manual_pending: items.length,
            needs_review: 0,
          },
          target: 10,
        }),
      });
    });

    await page.route('**/api/manual/app-manual-e2e/kit', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          kit: {
            id: 'app-manual-e2e',
            job_id: 'job-e2e-2',
            title: 'Platform Architect',
            company: 'Cloudflare',
            source: 'greenhouse',
            location: 'Remote',
            salary: '$200,000',
            posted_at: new Date().toISOString(),
            apply_url: 'https://boards.greenhouse.io/cloudflare/jobs/12345',
            apply_domain: 'boards.greenhouse.io',
            match_score: 98,
            matched_skills: ['TypeScript', 'Cloudflare Workers'],
            missing_skills: [],
            red_flags: [],
            route_reason: 'NO_EMAIL_FORM',
            route_reason_explained: 'Apply on portal form',
            untrusted: false,
            cover_letter: 'Dear Cloudflare Team, I am excited about the Platform Architect role.',
            subject: 'Application for Platform Architect',
            validator_errors: null,
            resume: {
              id: 'resume-1',
              label: 'Primary Resume',
              download_url: '/api/resumes/resume-1/download',
            },
            answers: {
              notice_period: '2 weeks',
              current_ctc: '$160,000',
              expected_ctc: '$180,000',
              work_authorisation: 'Citizen',
              links: { portfolio: 'https://alexmercer.dev' },
            },
            description: 'Platform engineering description for Cloudflare.',
            notes: null,
            contact_email: null,
            contact_source: null,
          },
        }),
      });
    });

    await page.route('**/api/manual/app-manual-e2e/applied', async (route) => {
      manualItemStatus = 'applied';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, status: 'applied' }),
      });
    });

    await page.route('**/api/applications*', async (route) => {
      const appList = [];
      // Review item
      appList.push({
        id: 'app-review-e2e',
        job_id: 'job-e2e-1',
        kind: 'initial',
        channel: 'email',
        status: reviewItemStatus,
        cover_letter: reviewLetter,
        subject: 'Application for Senior Infrastructure Engineer',
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
        match_score: 95,
        contact_email: 'recruiter@acme.com',
        apply_url: 'https://acme.com/jobs/senior-infra',
      });

      // Manual item
      appList.push({
        id: 'app-manual-e2e',
        job_id: 'job-e2e-2',
        kind: 'initial',
        channel: 'manual',
        status: manualItemStatus,
        cover_letter: null,
        subject: null,
        sent_at: null,
        applied_at: manualItemStatus === 'applied' ? new Date().toISOString() : null,
        outcome: null,
        outcome_at: null,
        notes: null,
        updated_at: new Date().toISOString(),
        title: 'Platform Architect',
        company: 'Cloudflare',
        source: 'greenhouse',
        location: 'Remote',
        match_score: 98,
        contact_email: null,
        apply_url: 'https://boards.greenhouse.io/cloudflare/jobs/12345',
      });

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, applications: appList }),
      });
    });

    // 1. Visit Dashboard
    await page.goto('/');
    await expect(page.getByText('Pigeon')).toBeVisible();
    await expect(page.getByText("Today's Sends")).toBeVisible();

    // 2. Open Review Queue
    await page
      .getByRole('button', { name: /Review Queue/i })
      .first()
      .click();
    await expect(page.getByText('Email Review Queue')).toBeVisible();
    await expect(page.getByText('Acme Corp').first()).toBeVisible();

    // Edit letter
    const textarea = page.locator('textarea');
    await expect(textarea).toBeVisible();
    await textarea.fill(
      'Dear Acme Corp, I am excited to apply for Senior Infrastructure Engineer with extensive experience in TypeScript and Cloudflare Workers.',
    );
    await page.getByRole('button', { name: /Save & Validate Letter/i }).click();

    // Approve application
    await page.getByRole('button', { name: /Approve Application/i }).click();

    // 3. Open Applications page and verify status change to 'approved'
    await page
      .getByRole('button', { name: /Applications/i })
      .first()
      .click();
    await expect(page.getByText('All Applications')).toBeVisible();

    const acmeRow = page.locator('tr').filter({ hasText: 'Acme Corp' });
    await expect(acmeRow).toBeVisible();
    await expect(acmeRow.getByText('approved')).toBeVisible();

    // 4. Open Manual Apply
    await page
      .getByRole('button', { name: /Manual Apply/i })
      .first()
      .click();
    await expect(page.locator('h4', { hasText: 'Platform Architect' })).toBeVisible();
    await expect(page.getByText('Cloudflare').first()).toBeVisible();

    // Mark Applied
    await page.getByRole('button', { name: /Mark Applied/i }).click();

    // 5. Check Applications page again: verify manual item has channel Manual and status applied
    await page
      .getByRole('button', { name: /Applications/i })
      .first()
      .click();
    const cloudflareRow = page.locator('tr').filter({ hasText: 'Cloudflare' });
    await expect(cloudflareRow).toBeVisible();
    await expect(cloudflareRow.getByText('manual', { exact: true })).toBeVisible();
    await expect(cloudflareRow.getByText('applied')).toBeVisible();
  });
});
