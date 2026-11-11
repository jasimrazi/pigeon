# Local Testing Guide (Windows PowerShell)

This guide walks you through testing Pigeon end-to-end entirely on your local machine using Windows PowerShell before deploying to Cloudflare.

---

## Prerequisites

- **Node.js**: v20 or higher
- **pnpm**: v9 or higher (`pnpm -v`)
- **Shell**: Windows PowerShell or PowerShell 7 (`pwsh`)

---

## Step 1: Clean Reset

Before testing, ensure your local Miniflare D1 database and KV namespaces are in a clean state:

```powershell
pnpm db:reset:local
```

This script:

- Verifies `ENV=dev` to prevent accidental deletion in non-dev environments.
- Removes `.wrangler/state` in `apps/worker`.
- Re-applies all local D1 migrations (`0000_initial.sql` and `0001_source_state_untrusted.sql`).

---

## Step 2: Start the Development Stack

Start the unified development runner:

```powershell
pnpm dev:local
```

### What happens under the hood:

1. Automatically copies `apps/worker/.dev.vars.example` to `apps/worker/.dev.vars` if `.dev.vars` is missing.
2. Applies local D1 migrations to guarantee the SQLite schema is up-to-date.
3. Spawns `wrangler dev --port 8787 --test-scheduled` (Worker API) and `vite` (Dashboard on port 5173) concurrently.
4. Prefixes process output with `[worker]` and `[dashboard]`. If either process dies, the other is terminated automatically.
5. Polls `http://127.0.0.1:8787/health` until ready, then displays the startup banner:

```text
╔═════════════════════════════════════════════════════════════════════════╗
║                         PIGEON DEV SERVER READY                         ║
╠═════════════════════════════════════════════════════════════════════════╣
║  ENV:                  dev                                              ║
║  Effective DRY_RUN:    true                                             ║
║  Kill Switch:          Off                                              ║
║  Google Auth Health:   unknown                                          ║
║  Active LLM Provider:  workers-ai                                       ║
║  Dashboard URL:        http://localhost:5173                            ║
║  Worker API URL:       http://127.0.0.1:8787                            ║
╚═════════════════════════════════════════════════════════════════════════╝

! [WARNING] DEV_RECIPIENT_ALLOWLIST is empty in .dev.vars.
! Outbound email sends are disabled in dev until an address/domain is configured.
```

> [!NOTE]
> Leave this terminal open. Run the following steps in a second PowerShell window.

---

## Step 3: Visual Inspection in Browser

Open your browser and navigate to:
[http://localhost:5173](http://localhost:5173)

### Header Status Badges

Inspect the top header bar containing the three status badges:

1. **Google Auth**: Initial state displays a neutral grey `Google: Checking...` badge with a pulse indicator. When loaded, it displays green `Google: OK`, amber `Google: Expired`, or red `Google: Reconnect Required`.
2. **DRY_RUN**: Initial state displays grey `DRY_RUN: Checking...`. Once loaded, it displays green `DRY_RUN: Active (simulated)` or amber `DRY_RUN: Inactive (live sends)`.
3. **Kill Switch**: Initial state displays grey `Kill Switch: Checking...`. Once loaded, it displays green `Kill Switch: Disarmed` or red `Kill Switch: ARMED`.

If the Worker API is unreachable or returns an error, the badges transition to a clear grey `API unreachable` indicator rather than defaulting to false positives.

---

## Step 3.5: First-Run Setup & Integrations Sub-Navigation

Navigate to the setup checklist in your browser:
[http://localhost:5173/setup](http://localhost:5173/setup)

### What to verify:

1. **Readiness Indicators**: Shows **Ready for Dry-Run** and **Ready to Go Live** milestone statuses driven by `/api/setup/status`.
2. **Overview Setup Banner**: The Overview tab displays a banner linking to the setup checklist until dry-run readiness is met.
3. **Settings Sub-Navigation**: Navigate to **Settings** [http://localhost:5173/settings](http://localhost:5173/settings) and test the 3 sub-navigation tabs:
   - **Profile**: Candidate information, skills, and target filters.
   - **Integrations**: Google Cloud (with computed redirect URI and copy button), Google Sheets (spreadsheet ID and tab names), LLM provider (Workers AI default or Gemini), Telegram notifications, and User-Agent identity.
   - **Safety**: Kill switch, DRY_RUN toggle, sending caps, ramp-up schedules, and appearance theme.
4. **Secret Fields**: Secret inputs are write-only with masked hints (`ends in ••••xxxx`), Replace actions, and Clear actions.

---

## Step 4: Seed Realistic Test Data

In a second PowerShell terminal, seed the local database:

```powershell
pnpm seed:local
```

### What this creates:

- **Candidate Profile**: Alex Mercer (`alex.mercer@example.test`) with technical skills, portfolio link, and min match score (70).
- **R2 Resumes**: Generates 2 valid PDF-1.4 documents on the fly:
  - `alex-mercer-systems.pdf` (tag: `systems`)
  - `alex-mercer-fullstack.pdf` (tag: `fullstack`)
- **KV ATS Sources**: Sets configured slugs in `CONFIG` KV for Greenhouse (`cloudflare`), Lever (`netflix`), and Ashby (`linear`).
- **Jobs & Applications** (13 jobs, 11 applications):
  - Clean drafts ready for review.
  - Draft with cover letter validator warning (letter too short).
  - Approved applications ready for sending.
  - Sent application with thread history.
  - Follow-up application scheduled 6 business days after initial contact.
  - Manual apply queue entries (`manual_portal` and `manual_review`).
  - Skipped jobs (one filtered for `LOW_SCORE`, one for `RED_FLAGS`).
  - Blocked applications (one blocked by `do_not_contact`, one blocked by 90-day cooldown).
  - _Safety constraint_: Every contact email strictly ends in `@example.test`.

---

## Step 5: Review Queue & Bulk Actions

Navigate to the Review Queue:
[http://localhost:5173/review](http://localhost:5173/review)

### 1. Single Application Actions

- Click **Approve** on a draft application (e.g. `seed-app-1`). The status immediately transitions to `approved`.
- Click **Reject** on another application. It transitions to `rejected` and removes it from the active review list.

### 2. Bulk Approval Guardrails

Select multiple applications using the checkboxes or the "Select All Clean Drafts" button:

- **Eligible**: Only applications where status is `draft`, route is `auto_email`, contact source is `posting` or `finder`, score $\ge 70$, no red flags, `untrusted=false`, contact not on DNC, and cover letter passes validation.
- **Blocked**: The dashboard disables selection and displays clear tooltips/reasons for any application that fails safety checks:
  - Jobs with red flags or untrusted text cannot be bulk-approved.
  - Scores below minimum cannot be bulk-approved.
  - Guessed addresses (`careers@`, `hr@`, `jobs@`) cannot be bulk-approved.

### 3. Cover Letter Editing & Revalidation

- Click **Edit Letter** on an application.
- Modify the text to introduce a hallucinated skill not in the profile (e.g., adding `"Expertise in COBOL Mainframe"`).
- Click **Save**. The server revalidates the letter and raises a `Cover letter validation failed` alert, preventing approval.

---

## Step 6: Trigger Scheduled Workflows

Pigeon automates background tasks using Cloudflare Cron Triggers. You can manually execute any workflow locally using the trigger scripts:

```powershell
# 1. Ingest jobs from configured ATS boards
pnpm trigger:ingest

# 2. Score new jobs and route to email or manual
pnpm trigger:score

# 3. Generate cover letters and application drafts
pnpm trigger:draft

# 4. Dispatch approved applications (dry-run simulated send)
pnpm trigger:send

# 5. Check for follow-ups due after 6 business days
pnpm trigger:followups

# 6. Execute full pipeline in one command
pnpm trigger:all
```

### Verifying Send Safety & Audit Events

When running `pnpm trigger:send`:

- Because `DRY_RUN=true` by default, **no live emails are sent via Gmail**.
- The worker claims no daily cap slot, performs all 11 safety gate checks, logs the simulated dispatch, and writes an audit event.
- Navigate to the Events Log at [http://localhost:5173/events](http://localhost:5173/events) to see the recorded events (`application_sent_dry_run`, `job_scored`, `source_ingested`).

---

## Step 7: Ingest Alert Emails

Pigeon parses incoming job alerts from LinkedIn, job portals, and hiring digests without fetching untrusted links. Test email ingestion using the committed alert fixtures:

```powershell
# 1. Ingest LinkedIn alert fixture
pnpm feed:eml "packages/shared/fixtures/alerts/linkedin-alert.eml"

# 2. Ingest Multi-job Digest fixture
pnpm feed:eml "packages/shared/fixtures/alerts/digest-alert.eml"

# 3. Ingest Malformed email fixture (tests parser error isolation)
pnpm feed:eml "packages/shared/fixtures/alerts/malformed.eml"
```

### Verification:

- After ingesting `linkedin-alert.eml` and `digest-alert.eml`, run `pnpm trigger:score` to score the new jobs.
- For `malformed.eml`, verify in the console and at [http://localhost:5173/sources](http://localhost:5173/sources) that parser health logs a handled error without crashing the worker.

---

## Step 8: Google Sheets Sync (Optional)

Pigeon supports a one-way mirror of applications to Google Sheets.

```powershell
pnpm trigger:sheets
```

- **Without Credentials**: If `GOOGLE_SERVICE_ACCOUNT_KEY` or `SHEET_ID` are not configured in `.dev.vars`, the sync cleanly logs that Sheets is unconfigured and skips without error.
- **With Credentials**: If valid service account credentials and spreadsheet ID are configured in `.dev.vars`, applications are synced with sanitized formulas (preventing CSV/formula injection).

---

## Step 9: Teardown & Reset

When finished testing:

1. In the terminal running `pnpm dev:local`, press `Ctrl+C`. Both the Worker and Dashboard processes will terminate cleanly.
2. To verify no orphaned processes remain on Windows:
   ```powershell
   Get-NetTCPConnection -LocalPort 8787, 5173 -ErrorAction SilentlyContinue
   ```
3. To reset the database for the next run:
   ```powershell
   pnpm db:reset:local
   ```

---

## Automated Smoke Verification

To verify that the entire local stack (Worker, Vite dev proxy, KV settings, and dev authentication) is running properly:

```powershell
pnpm smoke:local
```

### Expected Output:

```text
[smoke:local] Running local end-to-end smoke checks...
[smoke:local] PASS: Worker /health check (port 8787) - 200 OK
[smoke:local] PASS: Vite dev proxy /api/overview (port 5173) - 200 OK (killSwitch: false, dryRun: true)
[smoke:local] PASS: Kill switch KV readability via /api/settings - killSwitch: false
[smoke:local] PASS: Unauthenticated dev auth bypass (/api/overview) - 200 OK without JWT or session token

[smoke:local] All local smoke checks passed successfully!
```

---

## Troubleshooting Guide

| Issue                                       | Cause                                                                             | Solution                                                                                                                                 |
| :------------------------------------------ | :-------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------- |
| **Port 8787 or 5173 in use**                | A previous dev server process is still running.                                   | Run `Get-Process -Id (Get-NetTCPConnection -LocalPort 8787).OwningProcess \| Stop-Process -Force` in PowerShell.                         |
| **"Binding AI needs to be run remotely"**   | Cloudflare Workers AI local emulation requires remote access or Cloudflare login. | Set `LLM_PROVIDER=gemini` and `GEMINI_API_KEY=...` in `apps/worker/.dev.vars`, OR run `npx wrangler login` to enable remote AI bindings. |
| **Vite proxy returning HTML for `/api/*`**  | Vite dev server is running without the proxy target, or Worker is down.           | Ensure `apps/dashboard/vite.config.ts` proxies `/api`, `/auth`, `/health` to `http://127.0.0.1:8787` and Worker is running on port 8787. |
| **Google auth badge: "Reconnect Required"** | No valid Google OAuth tokens are stored in local KV.                              | Expected in local dev before OAuth linking. For simulated sending, `DRY_RUN=true` allows full pipeline testing without live tokens.      |

---

## What This Does NOT Test Yet

The local kit exercises all business logic, data models, safety gates, and UI state machines locally. However, the following external cloud integrations are deferred until deployment:

1. **Live Google OAuth Callback**: Authorizing with Google consent screens requires public HTTPS callback URLs configured in Google Cloud Console.
2. **Live Email Sending**: Real email dispatches to actual recipient mailboxes via Gmail API require production OAuth credentials and `DRY_RUN=false`.
3. **Cloudflare Access JWT Headers**: Edge JWT cryptographic validation by Cloudflare Access is only active when deployed behind a Cloudflare Zero Trust tunnel/domain.
4. **Cloudflare Queues Remote Consumer**: Local Miniflare emulates queue dispatch locally; production distributed queues run on Cloudflare's global network.
