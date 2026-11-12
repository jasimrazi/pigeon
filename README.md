# Pigeon

Pigeon is a personal job-application assistant built on Cloudflare Workers, D1, R2, KV, Queues, and a React web dashboard. It is designed for single-user deployment to help automate job discovery, AI fit-scoring, application drafting, and tracking while keeping human review and safety gates firmly in control.

---

## Dashboard Sections

Pigeon organizes your job search workflow into seven clear dashboard sections:

### 1. Overview

Your operational control center. Shows live system metrics at a glance:

- **Daily Sends & Caps**: How many applications were sent today versus your configured daily cap and ramp limit.
- **Safety Status**: Current state of `DRY_RUN` mode (default ON) and the emergency **Kill Switch** (one-click instant freeze on all outbound email).
- **Service Health**: Connection status for Google OAuth (Gmail & Google Sheets) and active LLM provider.
- **Pipeline Breakdown**: Counts of jobs currently in review, manual apply queue, and sent status.

### 2. Review Queue

Human-in-the-loop approval for jobs with contact emails (`auto_email` route):

- Pigeon automatically drafts personalized cover letters using your profile and selects the best matching resume based on skill tags.
- Nothing is ever sent automatically without human approval.
- You can inspect the email draft, edit the text, change the attached resume, approve for sending, or dismiss.

### 3. Manual Apply

Your workspace for jobs that must be submitted through websites and portals (`manual_portal` route):

- Handles jobs found on LinkedIn, Indeed, Naukri, or company careers pages.
- Provides a **1-Click Apply Kit**: opens the job posting in a new tab, copies your tailored cover letter, downloads the best-matching resume, and tracks your submission date.
- Keeps you focused on applying without context switching.

### 4. Applications

The complete record and status ledger for every application:

- Search and filter applications by company, title, date, route, and status (`draft`, `approved`, `sent`, `replied`, `interview`, `rejected`).
- View application details, timestamps, notes, and simulated or real reply events.
- Synchronizes one-way to your personal Google Sheet for spreadsheet tracking.

### 5. Sources

Live health monitor for all 11 supported job data pipelines:

- **Alert Email Parsers**: Inbound email alerts from **LinkedIn**, **Indeed**, and **Naukri** (parsed safely from forwarded alert emails; Pigeon never automates or scrapes login-walled portals).
- **ATS Endpoints**: Direct public board feeds from **Greenhouse**, **Lever**, and **Ashby**.
- **Public Job APIs & RSS**: Feeds from **Adzuna**, **RemoteOK**, **Remotive**, **WeWorkRemotely**, and **Hacker News (Hiring)**.
- Displays circuit breaker states (`closed`, `open`), failure counts, empty streak warnings, and last run timestamps.

### 6. Settings

Central configuration for your profile, documents, and credentials:

- **Profile**: Your contact information, target job titles, work history, skills, locations, and minimum match score.
- **Resumes**: Upload and manage multiple PDF resumes (up to 20). Assign skill tags (e.g. `typescript`, `infra`) to guide automated matching, set your default resume, preview inline, or download.
- **Integrations**: Securely configure and test third-party services:
  - _Google OAuth_: Gmail for outbound email & Google Sheets for tracking.
  - _LLM Providers_: Cloudflare Workers AI (default) or Google Gemini.
  - _Telegram Bot_: Real-time alerts for incoming recruiter replies and daily digest reminders.
- **Safety**: Configure daily send caps, hourly send windows (e.g. 09:00–18:00 in your local timezone), ramp steps, and kill switch.

### 7. Events

A searchable, chronological audit log recording every system action:

- Tracks when jobs are ingested, scored, drafted, approved, sent, or bounced.
- Zero personal identifying information (PII), email bodies, or credentials are ever stored in logs.

---

## Safety Policy & Guardrails

Pigeon is designed with strict safety invariants:

1. **DRY_RUN by Default**: Outbound emails are disabled by default. Nothing is sent unless `DRY_RUN=false`, the Kill Switch is disarmed, and Google authentication is healthy.
2. **Never Scrapes Portals**: Under Rule 6, Pigeon never automates logins or scrapes LinkedIn, Indeed, or Naukri. Jobs from portals arrive strictly via forwarded alert emails.
3. **Owner-Only Access**: All API endpoints and dashboard views are secured behind Cloudflare Access (Zero Trust) JWT verification and strict CORS checks.
4. **Encrypted Secrets**: Sensitive credentials (Google OAuth secrets, Gemini API key, Telegram tokens) are encrypted at rest with AES-256-GCM.

---

## Quick Start (Local Development)

### Prerequisites

- Node.js 20+
- `pnpm` (v9+)

### Installation & Run

```bash
# 1. Clone repository
git clone https://github.com/your-username/pigeon.git
cd pigeon

# 2. Install dependencies
pnpm install

# 3. Start local development environment
# (Automatically runs D1 migrations, starts Worker on :8787 and Dashboard on :5173)
pnpm dev:local
```

Open your browser to **[http://localhost:5173](http://localhost:5173)**.

### Seeding Test Data (Optional)

To test the UI with realistic jobs, applications, and sample resumes in local dev:

```bash
pnpm seed:local
```

To reset the local database:

```bash
pnpm db:reset:local
```

---

## Useful Commands

```bash
# Quality & Verification
pnpm lint            # Check code style with ESLint (strict TypeScript)
pnpm typecheck       # Typecheck all packages (shared, worker, dashboard)
pnpm test            # Run Vitest test suite
pnpm format:check    # Verify formatting with Prettier
pnpm format          # Auto-format all code

# E2E & Accessibility
pnpm test:e2e        # Run Playwright end-to-end and Axe accessibility tests
```

---

## Project Structure

```
pigeon/
├── apps/
│   ├── worker/       # Cloudflare Workers API (Hono, D1 SQLite, R2 Storage, KV, Queues)
│   └── dashboard/    # Frontend UI (Vite, React 19, Tailwind CSS, Lucide icons)
├── packages/
│   └── shared/       # Shared TypeScript types, schemas (zod), and core business logic
├── docs/             # Technical guides, architecture docs, and configuration inventory
└── scripts/          # Local runner, database seeding, and deployment utilities
```
