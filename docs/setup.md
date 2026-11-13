# Pigeon Deployment & Setup Guide (Windows)

This document guides a new owner through deploying their own instance of **Pigeon** to Cloudflare on Windows PowerShell, configuring bootstrap secrets, setting up integrations via the web UI, and safely transitioning from simulation to live dispatch.

---

## 1. Architecture & Scope

- **Single Owner**: Pigeon is designed for personal use. A new user deploys their own independent instance within their own Cloudflare account and Google Cloud project.
- **Fail Closed**: Outbound emails are never sent unless `DRY_RUN=false`, the global kill switch is disarmed, Google authentication health is `ok`, and the daily cap has not been exceeded.
- **Minimal Bootstrap**: Only security gate values (Access tags, master encryption key, owner email, Cloudflare bindings) stay in environment configuration. All operational credentials (Google Cloud OAuth, Google Sheets, LLM provider, Telegram, User-Agent identity) are configured and managed directly in the web UI and encrypted at rest with AES-256-GCM.

---

## 2. Prerequisites (Windows)

1. **Operating System**: Windows 10/11 with Windows PowerShell 5.1 or PowerShell 7 (`pwsh`).
2. **Node.js**: v20.x or v22.x LTS ([nodejs.org](https://nodejs.org/)).
3. **pnpm**: v9 or higher (`npm install -g pnpm`).
4. **Cloudflare Account**:
   - **Workers Paid Plan** ($5/month): Required for Cloudflare Queues (`pigeon-jobs`) and scheduled cron triggers.
   - **Cloudflare Zero Trust** (Free up to 50 users): Required for Cloudflare Access protecting `/api/*` and dashboard.
5. **Google Cloud Project**:
   - Google account for job applications (`OWNER_GMAIL`).
   - Enabled APIs: **Gmail API** and **Google Sheets API**.

---

## 3. Owner Admin Password Authentication

Pigeon uses simple, self-contained single-owner Bearer token / admin password authentication, allowing the app to run on a Cloudflare Free account without requiring Cloudflare Zero Trust.

- Your admin password is set via `ADMIN_PASSWORD` Worker secret.
- The dashboard prompts you for this password on initial load, stores it in `localStorage`, and sends `Authorization: Bearer <password>` on all API requests.
- All mutating endpoints enforce strict CORS Origin checks matching your dashboard domain.

---

## 4. Repository Setup & Resource Provisioning

Open Windows PowerShell in your project workspace:

```powershell
# 1. Install dependencies
pnpm install

# 2. Login to Cloudflare Wrangler
pnpm --filter @pigeon/worker exec wrangler login

# 3. Automatically provision Cloudflare resources (D1, KV, R2, Queue)
pnpm setup:cloudflare --env prod
```

### What `pnpm setup:cloudflare` creates:

- **D1 Database**: `pigeon-db-prod` (stores applications, jobs, events, encrypted settings)
- **KV Namespace**: `pigeon-config-prod` (stores cache, kill switch, OAuth state, rate limits)
- **R2 Bucket**: `pigeon-resumes-prod` (stores resume PDFs and automated database backups)
- **Queue**: `pigeon-jobs-prod` (processes async job fetching, LLM scoring, and dispatch)

Resource identifiers are automatically saved to `apps/worker/wrangler.toml.local` (which is git-ignored).

---

## 5. Bootstrap Secrets Configuration

Run the interactive secrets setup script:

```powershell
pnpm setup:secrets --env prod
```

The script will:

1. Automatically generate a cryptographically secure 32-byte master encryption key (`SETTINGS_ENCRYPTION_KEY`) using `WebCrypto/crypto.randomBytes(32)` encoded as base64.
2. Securely prompt for your bootstrap values without echoing sensitive characters:
   - `OWNER_GMAIL`: Your primary Gmail address.
   - `ADMIN_PASSWORD`: Your secret admin password for single-owner dashboard and API access.
3. Safely set each secret in your production worker using `wrangler secret put`.

---

## 6. Validate Bootstrap Configuration

Verify that all bootstrap requirements are satisfied:

```powershell
pnpm check:config
```

The check verifies:

- `ENV` is set to `prod`.
- Master encryption key is present and >= 32 bytes.
- Owner email is valid.
- Cloudflare Access audience and team domain are configured.
- Reports UI-managed settings as `configure in Settings > Integrations` (non-blocking).

---

## 7. Database Migration & Deployment

### Apply D1 Database Migrations

Run database migrations against your remote production D1 database:

```powershell
pnpm --filter @pigeon/worker exec wrangler d1 migrations apply pigeon-db-prod --remote
```

### Deploy the Backend Worker

```powershell
pnpm --filter @pigeon/worker exec wrangler deploy --env prod
```

### Deploy the Frontend Dashboard to Cloudflare Pages

```powershell
# Build dashboard assets
pnpm --filter @pigeon/dashboard build

# Deploy to Cloudflare Pages
pnpm --filter @pigeon/worker exec wrangler pages deploy apps/dashboard/dist --project-name pigeon-dashboard
```

---

## 8. Web UI Setup (`/setup`)

Open your deployed Cloudflare Pages URL in your browser: `https://pigeon-dashboard.pages.dev/setup`.

The **First-Run Setup & Readiness** page displays a complete status checklist:

1. **Candidate Profile**:
   - Navigate to **Settings > Profile**.
   - Enter your Full Name, Email, Skills (grounded in cover letters), Target Job Titles, and Company Blacklist.
2. **Google Cloud Integration**:
   - Navigate to **Settings > Integrations > Google Cloud**.
   - Copy the **Authorized Redirect URI** shown on the page (e.g. `https://pigeon-dashboard.pages.dev/auth/google/callback`).
   - In Google Cloud Console Credentials, paste it into **Authorized redirect URIs**.
   - Enter your **Google Client ID** and **Google Client Secret**, then click **Save Google Credentials**.
   - Click **Connect Google Account** to authorize Gmail and Google Sheets permissions.
   > [!IMPORTANT]
   > In Google Cloud Console > OAuth consent screen, set your publishing status to **In production** (external). If left in **Testing**, Google refresh tokens expire every 7 days, requiring weekly re-authentication.
3. **Google Sheets Tracker**:
   - Create a blank Google Sheet at [sheets.new](https://sheets.new).
   - Paste the spreadsheet URL or ID into **Settings > Integrations > Google Sheets**.
   - Click **Test Sheets Connection** to verify read/write access.
4. **LLM Provider**:
   - Default is **Cloudflare Workers AI** (no API key required).
   - Alternatively select **Google Gemini**, obtain a free key at [Google AI Studio](https://aistudio.google.com/app/apikey), and paste the key.
   - Click **Test LLM Completion** to verify inference.
5. **Telegram Notifications** (Optional):
   - Message `@BotFather` to create a bot token, message `@userinfobot` for your Chat ID, and test notifications.
6. **Sending Identity**:
   - Verify your User-Agent contact email and local timezone.

---

## 9. Running in DRY_RUN Mode

By default, `DRY_RUN=true`:

1. Pigeon fetches jobs from enabled ATS sources (Greenhouse, Lever, Ashby) via scheduled crons.
2. The scoring pipeline evaluates job descriptions against your profile and produces tailored cover letter drafts.
3. Applications appear in **Review Queue** for approval.
4. When approved, dispatch is **simulated**:
   - No emails leave your Gmail account.
   - Application status updates to `sent`.
   - Google Sheet records the simulated application with timestamp and details.

---

## 10. Checklist Before Going Live

When you are ready to transmit real applications:

1. **Verify Kill Switch**:
   - Test activating and deactivating the Kill Switch from the top header chip or Settings.
2. **Verify Google Auth Health**:
   - Confirm header displays green `Google OK`.
3. **Inspect Generated Letters**:
   - Review 3-5 draft cover letters in **Review Queue** to ensure tone, formatting, and skill grounding meet your expectations.
4. **Disarm DRY_RUN**:
   - Navigate to **Settings > Safety**.
   - Click **DRY_RUN: ENABLED**.
   - Review the red confirmation modal warning and click **Switch to LIVE**.
   - The header chip will update to `LIVE`.

To revert to simulation at any time, click **LIVE** in the header or Settings to toggle `DRY_RUN` back on immediately.
