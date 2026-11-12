import { test, expect, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const screenshotsDir = path.resolve(__dirname, '../screenshots');

// Ensure screenshots directory exists
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

interface MockConfig {
  seeded: boolean;
}

async function setupApiMocks(page: Page, config: MockConfig) {
  const { seeded } = config;

  await page.route('**/api/overview', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        seeded
          ? {
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
            }
          : {
              sendsToday: 0,
              effectiveCap: 20,
              dailyCap: 20,
              bounceRate: 0,
              failureRate: 0,
              jobsByStatus: {},
              jobsByRoute: {},
              manualWaitingCount: 0,
              authHealth: { status: 'ok', reason: null, checked_at: new Date().toISOString() },
              dryRun: true,
              killSwitch: false,
            },
      ),
    });
  });

  await page.route('**/api/resumes', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        resumes: [
          {
            id: 'resume-1',
            label: 'Primary Resume',
            tags: ['Backend', 'Cloudflare'],
            is_default: true,
          },
          {
            id: 'resume-2',
            label: 'Systems Resume',
            tags: ['Rust', 'Distributed'],
            is_default: false,
          },
        ],
      }),
    });
  });

  await page.route('**/api/review-queue', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        items: seeded
          ? [
              {
                id: 'app-review-1',
                job_id: 'job-1',
                status: 'draft',
                cover_letter:
                  'Dear Acme Corp hiring team,\n\nI am writing to express my enthusiastic interest in the Senior Infrastructure Engineer position. With extensive hands-on experience designing fault-tolerant backend architectures on Cloudflare Workers and PostgreSQL, I have spent the last five years architecting distributed systems that handle high throughput.\n\nAt my current role, I spearheaded the deployment of microservices and pipeline automation that reduced deployment latency by 40%. My background in TypeScript strict typing and resilient event streaming aligns directly with your platform objectives. I welcome the opportunity to discuss how my skill set will support your engineering initiatives.\n\nSincerely,\nAlex Mercer',
                subject: 'Application: Senior Infrastructure Engineer - Alex Mercer',
                resume_id: 'resume-1',
                resume_label: 'Primary Resume',
                validator_errors: null,
                updated_at: new Date().toISOString(),
                title: 'Senior Infrastructure Engineer',
                company: 'Acme Corp',
                location: 'Remote, US',
                salary_raw: '$165,000 - $190,000',
                description:
                  'Full stack infrastructure role focusing on edge workers and serverless scale.',
                apply_url: 'https://acme.com/jobs/infra',
                contact_email: 'engineering-recruiting@acme.com',
                contact_source: 'posting',
                match_score: 94,
                match_reasons:
                  'Strong alignment with TypeScript, distributed architecture, and Cloudflare stack.',
                red_flags: [],
                untrusted: false,
                route_reason: 'AUTO_EMAIL_CONTACT',
                is_safe_for_bulk: true,
              },
            ]
          : [],
      }),
    });
  });

  await page.route('**/api/manual', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        seeded
          ? {
              items: [
                {
                  application_id: 'app-manual-1',
                  job_id: 'job-man-1',
                  title: 'Staff Systems Architect',
                  company: 'Cloudflare',
                  source: 'greenhouse',
                  location: 'San Francisco, CA (Remote)',
                  match_score: 97,
                  may_be_closed: false,
                  applied_before_warning: false,
                  untrusted: false,
                  needs_attention: false,
                  route_reason_explained: 'Portal listing requiring direct ATS submission.',
                },
              ],
              todays_focus: [
                {
                  application_id: 'app-manual-1',
                  job_id: 'job-man-1',
                  title: 'Staff Systems Architect',
                  company: 'Cloudflare',
                  source: 'greenhouse',
                  location: 'San Francisco, CA (Remote)',
                  match_score: 97,
                  may_be_closed: false,
                  applied_before_warning: false,
                  untrusted: false,
                  needs_attention: false,
                  route_reason_explained: 'Portal listing requiring direct ATS submission.',
                },
              ],
              needs_attention: [],
              counts: { total: 1, needs_review: 0, snoozed: 0 },
            }
          : {
              items: [],
              todays_focus: [],
              needs_attention: [],
              counts: { total: 0, needs_review: 0, snoozed: 0 },
            },
      ),
    });
  });

  await page.route('**/api/manual/*/kit', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        kit: {
          application_id: 'app-manual-1',
          job_id: 'job-man-1',
          title: 'Staff Systems Architect',
          company: 'Cloudflare',
          source: 'greenhouse',
          location: 'Remote',
          salary: '$180k - $220k',
          match_score: 97,
          matched_skills: ['TypeScript', 'Cloudflare Workers', 'Distributed Systems'],
          missing_skills: ['Go'],
          red_flags: [],
          untrusted: false,
          route_reason_explained: 'Manual submission requested by ATS portal.',
          apply_url: 'https://boards.greenhouse.io/cloudflare/jobs/12345',
          apply_domain: 'boards.greenhouse.io',
          cover_letter:
            'Dear Cloudflare hiring team,\n\nI am thrilled to apply for the Staff Systems Architect role.',
          validator_errors: [],
          resume: {
            id: 'resume-1',
            label: 'Primary Resume',
            download_url: 'https://example.com/resumes/resume-1.pdf',
          },
          answers: {
            notice_period: '2 weeks',
            current_ctc: '$160,000',
            expected_ctc: '$195,000',
            work_authorisation: 'US Citizen / Authorized to work',
            links: {
              GitHub: 'https://github.com/alexmercer',
              LinkedIn: 'https://linkedin.com/in/alexmercer',
            },
          },
          description:
            'Responsibilities:\n- Design low-latency distributed primitives across global edge network.\n- Collaborate on developer platform ergonomics and runtime security boundaries.\n- Maintain 99.999% uptime for mission-critical routing APIs.',
        },
      }),
    });
  });

  await page.route('**/api/applications*', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        applications: seeded
          ? [
              {
                id: 'app-1',
                job_id: 'job-1',
                kind: 'initial',
                channel: 'email',
                status: 'draft',
                cover_letter: 'Cover letter body...',
                subject: 'Application: Senior Infrastructure Engineer',
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
                contact_email: 'engineering-recruiting@acme.com',
                apply_url: 'https://acme.com/jobs/infra',
              },
              {
                id: 'app-2',
                job_id: 'job-2',
                kind: 'initial',
                channel: 'manual',
                status: 'applied',
                cover_letter: null,
                subject: null,
                sent_at: null,
                applied_at: new Date().toISOString(),
                outcome: 'interview',
                outcome_at: new Date().toISOString(),
                notes: 'Recruiter screen scheduled for Friday',
                updated_at: new Date().toISOString(),
                title: 'Staff Systems Architect',
                company: 'Cloudflare',
                source: 'greenhouse',
                location: 'Remote',
                match_score: 97,
                contact_email: null,
                apply_url: 'https://boards.greenhouse.io/cloudflare/jobs/12345',
              },
            ]
          : [],
      }),
    });
  });

  await page.route('**/api/sources', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        sources: seeded
          ? [
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
              {
                name: 'remoteok',
                kind: 'api',
                circuit_state: 'closed',
                failure_count: 0,
                last_run: new Date().toISOString(),
                last_error: null,
              },
              {
                name: 'alert_email',
                kind: 'alert_email',
                circuit_state: 'half-open',
                failure_count: 1,
                last_run: new Date().toISOString(),
                last_error: 'HTML parse streak warning',
                parser_empty_streak: 3,
                is_suspect: true,
              },
            ]
          : [],
      }),
    });
  });

  await page.route('**/api/settings', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        dryRun: true,
        killSwitch: false,
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

  await page.route('**/api/events*', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        events: seeded
          ? [
              {
                id: 'evt-1',
                entity: 'application',
                entity_id: 'app-review-1',
                type: 'draft_created',
                payload: { score: 94, route: 'auto_email' },
                created_at: new Date().toISOString(),
              },
              {
                id: 'evt-2',
                entity: 'settings',
                entity_id: 'profile',
                type: 'settings_updated',
                payload: { daily_cap: 20 },
                created_at: new Date().toISOString(),
              },
            ]
          : [],
      }),
    });
  });
}

const views: Array<{ tabKey: string; navName: RegExp; viewName: string }> = [
  { tabKey: 'overview', navName: /^Overview$/i, viewName: 'overview' },
  { tabKey: 'review-queue', navName: /^Review Queue$/i, viewName: 'review-queue' },
  { tabKey: 'manual-apply', navName: /^Manual Apply$/i, viewName: 'manual-apply' },
  { tabKey: 'applications', navName: /^Applications$/i, viewName: 'applications' },
  { tabKey: 'sources', navName: /^Sources$/i, viewName: 'sources' },
  { tabKey: 'settings', navName: /^Settings$/i, viewName: 'settings' },
  { tabKey: 'events', navName: /^Events$/i, viewName: 'events' },
];

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

const themes: Array<'light' | 'dark'> = ['light', 'dark'];
const dataStates: Array<'seeded' | 'empty'> = ['seeded', 'empty'];

test.describe('Visual Design Audit, Axe Accessibility, & Screenshot Suite', () => {
  for (const v of views) {
    for (const dataState of dataStates) {
      test(`View: ${v.viewName} [${dataState}] - captures screenshots and passes Axe AA`, async ({
        page,
      }) => {
        // Setup API mocks according to dataState
        await setupApiMocks(page, { seeded: dataState === 'seeded' });

        for (const viewport of viewports) {
          await page.setViewportSize({ width: viewport.width, height: viewport.height });

          // Navigate
          await page.goto('/');
          await expect(page.getByText('Pigeon')).toBeVisible();

          // Switch tab if not overview
          if (v.tabKey !== 'overview') {
            if (viewport.width < 768) {
              const isMoreSection = ['sources', 'settings', 'events', 'setup'].includes(v.tabKey);
              if (isMoreSection) {
                const menuBtn = page.getByRole('button', { name: /Toggle navigation menu/i });
                if (await menuBtn.isVisible()) {
                  await menuBtn.click();
                  await page.getByRole('dialog').getByRole('button', { name: v.navName }).click();
                }
              } else {
                await page
                  .getByRole('navigation', { name: 'Mobile navigation' })
                  .getByRole('button', { name: v.navName })
                  .click();
              }
            } else {
              await page.getByRole('banner').getByRole('button', { name: v.navName }).click();
            }
          }

          // Capture both light and dark modes
          for (const theme of themes) {
            await page.evaluate((t) => {
              document.documentElement.setAttribute('data-theme', t);
            }, theme);

            // Wait a tick for rendering transition
            await page.waitForTimeout(200);

            // 1. Take Screenshot
            const shotPath = path.join(
              screenshotsDir,
              `${v.viewName}-${dataState}-${theme}-${viewport.width}.png`,
            );
            await page.screenshot({ path: shotPath, fullPage: true });

            // 2. Run Axe Accessibility Scan
            const axeResults = await new AxeBuilder({ page }).analyze();
            const seriousOrCritical = axeResults.violations.filter(
              (violation) => violation.impact === 'critical' || violation.impact === 'serious',
            );

            expect(
              seriousOrCritical,
              `Axe accessibility violations in ${v.viewName} [${dataState}, ${theme}, ${viewport.name}]:\n` +
                seriousOrCritical
                  .map((vi) => `  [${vi.impact}] ${vi.id}: ${vi.description} (help: ${vi.helpUrl})`)
                  .join('\n'),
            ).toEqual([]);
          }
        }
      });
    }
  }
});
