# Pigeon Operations Runbook

This runbook covers operational troubleshooting, safety procedures, secret rotation, and disaster response for Pigeon in production.

---

## 1. Emergency Pause: Halting All Senders

When you need to stop all outgoing emails immediately:

### Option A: Via Owner Dashboard (Recommended)
1. Open the Pigeon Dashboard at your Cloudflare Pages URL.
2. Navigate to **Overview** or **Settings**.
3. Toggle the **KILL SWITCH** to **ON**.
4. Confirm the warning dialog.
5. Senders halt immediately; all pending and scheduled email sends are aborted.

### Option B: Via Wrangler CLI (Emergency Fallback)
If the dashboard is inaccessible, use Wrangler to set the KV flag directly:

```bash
pnpm --filter @pigeon/worker exec wrangler kv:key put --binding=CONFIG kill_switch true --env prod
```

### Verifying Kill Switch State
```bash
pnpm --filter @pigeon/worker exec wrangler kv:key get --binding=CONFIG kill_switch --env prod
# Output should return: "true"
```

---

## 2. Reconnecting Google OAuth After `auth_invalid`

### When This Happens
If a Google API call receives `invalid_grant` (e.g. user revoked permissions or Google invalidated the refresh token), Pigeon automatically:
1. Marks Google Auth Health in KV as `invalid`.
2. Emits a high-priority Telegram alert (`key=auth_invalid`).
3. Pauses the send worker, inbox poller, and Google Sheets sync worker.
4. Leaves the Manual Apply queue and dashboard operational.

### Reconnection Procedure
1. Navigate to the Pigeon Worker authorization URL:
   `https://<your-worker-domain>/auth/google/start`
2. Sign in with the intended Google account and click **Allow** on the consent screen.
3. The callback (`/auth/google/callback`) automatically:
   - Encrypts the fresh refresh token using `GOOGLE_TOKEN_ENCRYPTION_KEY`.
   - Stores it in KV.
   - Sets auth health to `ok` (`{ status: "ok", checked_at: "<ISO_TIMESTAMP>" }`).
   - Automatically unblocks the email send worker, inbox poller, and sheets sync worker.
4. Verify auth health on the Dashboard Overview banner: status should display green `ok`.

---

## 3. Rotating Secrets

Follow this procedure when periodically rotating credentials or when an API key is compromised.

> [!CAUTION]
> Never put secrets in git or build logs. Use `wrangler secret put` exclusively.

### Routine Secret Rotation
```bash
# 1. Update Cloudflare Access credentials if audience or certificates changed
pnpm --filter @pigeon/worker exec wrangler secret put CF_ACCESS_AUD --env prod
pnpm --filter @pigeon/worker exec wrangler secret put CF_ACCESS_TEAM_DOMAIN --env prod

# 2. Update Job Source API keys
pnpm --filter @pigeon/worker exec wrangler secret put ADZUNA_APP_ID --env prod
pnpm --filter @pigeon/worker exec wrangler secret put ADZUNA_APP_KEY --env prod

# 3. Update Telegram Bot credentials
pnpm --filter @pigeon/worker exec wrangler secret put TELEGRAM_BOT_TOKEN --env prod
pnpm --filter @pigeon/worker exec wrangler secret put TELEGRAM_CHAT_ID --env prod

# 4. Update Gemini API Key (if used)
pnpm --filter @pigeon/worker exec wrangler secret put GEMINI_API_KEY --env prod
```

### Rotating `GOOGLE_TOKEN_ENCRYPTION_KEY`
1. Arm the Kill Switch:
   ```bash
   pnpm --filter @pigeon/worker exec wrangler kv:key put --binding=CONFIG kill_switch true --env prod
   ```
2. Generate a new 256-bit key:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
3. Update the secret:
   ```bash
   pnpm --filter @pigeon/worker exec wrangler secret put GOOGLE_TOKEN_ENCRYPTION_KEY --env prod
   ```
4. Re-authenticate via `/auth/google/start` so the refresh token is encrypted with the new key.
5. Disarm the Kill Switch.

---

## 4. Remediation Procedure After a Bad Send

If an incorrect, unintended, or poorly phrased email is sent:

1. **Arm the Kill Switch immediately**:
   Turn on the Kill Switch in the Dashboard or via CLI to prevent any subsequent emails from sending.
2. **Locate the Application and Event Log**:
   - Query the `events` table to pinpoint the exact time, recipient, and message ID:
     ```sql
     SELECT id, entity_id, type, payload, created_at
     FROM events
     WHERE type = 'email_sent'
     ORDER BY created_at DESC
     LIMIT 5;
     ```
   - Fetch application and job details:
     ```sql
     SELECT a.id, a.status, a.subject, a.gmail_message_id, a.gmail_thread_id,
            j.company, j.contact_email
     FROM applications a
     JOIN jobs j ON a.job_id = j.id
     WHERE a.id = '<entity_id>';
     ```
3. **Contact the Recipient (If Remediation is Warranted)**:
   - Log into the Gmail account directly.
   - Reply to the thread to send a clarification or courteous apology if necessary.
4. **Prevent Recurrence**:
   - Add the company or domain to `do_not_contact` or your profile blacklist:
     ```sql
     INSERT INTO do_not_contact (email_or_domain, reason, added_at)
     VALUES ('unwanted-domain.com', 'Sent in error', datetime('now'));
     ```
   - Adjust keyword filters or scoring weights in Profile Settings.
5. **Resume Normal Operations**:
   - Disarm the Kill Switch when safe.

---

## 5. Handling a `parser_suspect` Alert

### Why It Triggers
When an alert email parser (e.g. LinkedIn, Indeed, Naukri) records **3 consecutive email deliveries that yield 0 parsed jobs**, the portal is flagged as `parser_suspect`.
- An alert is sent to Telegram.
- All future jobs from this portal are marked `untrusted = true`.
- The Manual Apply kit displays a warning banner instructing you to verify links and company info before applying.

### Resolution Steps
1. **Download a Sample `.eml`**:
   - Check the forwarded alert email in your inbox that failed parsing.
   - Save the raw `.eml` file to `fixtures/alerts/<portal>/<test-name>.eml`.
2. **Inspect the Email Structure**:
   - Run the parser debug script:
     ```bash
     pnpm parse-eml fixtures/alerts/<portal>/<test-name>.eml
     ```
   - Check if the job portal changed its layout, tracking links, or container tags.
3. **Update the Parser**:
   - Update `packages/shared/src/alerts/parsers/<portal>.ts`.
   - Ensure cleanTrackingUrl keeps the allowed parameters (`jk` for Indeed, `currentJobId` for LinkedIn).
4. **Verify with Tests**:
   ```bash
   pnpm test
   ```
5. **Deploy the Fix**:
   - Merge to `main` to trigger staging deployment, then deploy to prod.
6. **Reset Parser Health**:
   - When a successful email alert parse occurs, Pigeon automatically resets the consecutive empty streak to 0 and clears the portal's `parser_suspect` and `untrusted` flags.

---

## 6. Re-Enabling a Tripped Circuit Breaker

### Why It Trips
If an external API (such as Adzuna) fails 5 consecutive times (HTTP 5xx, timeouts, or network errors), the circuit breaker opens to prevent flooding the upstream service.

### Inspection
1. View the **Sources** tab in the Dashboard.
2. The affected source will display state: `OPEN` along with the last error timestamp.

### Recovery Procedure
1. Check external API status and credentials (e.g. verify Adzuna API quota).
2. Reset the circuit breaker state:
   - The circuit breaker automatically transitions to `half_open` after its reset timeout (default: 15 minutes).
   - Alternatively, reset the source state in D1:
     ```sql
     UPDATE source_state
     SET circuit_state = 'closed', consecutive_failures = 0, last_error = NULL
     WHERE source = 'adzuna';
     ```
3. Trigger an ingestion run via Dashboard or wait for the next scheduled cron run.

---

## 7. Staging Soak Checklist

Before setting `DRY_RUN=false` in Production, complete this full verification soak in Staging:

- [ ] **1. Fresh Deployment**: Staging worker and dashboard deployed cleanly (`pnpm --filter @pigeon/worker exec wrangler deploy --env staging`).
- [ ] **2. Default Safe Mode**: Confirm `DRY_RUN="true"` is active in staging variables and KV.
- [ ] **3. Ingestion Verification**:
  - Ingest jobs from API sources (e.g. Adzuna).
  - Ingest an alert email via Cloudflare Email Routing to staging address.
  - Verify deduplication works across consecutive runs.
- [ ] **4. Scoring & Filtering**:
  - Verify blacklisted companies and keyword filters reject matching jobs (`filtered_out`).
  - Verify fitting jobs are scored correctly ($>0$) by the LLM client.
  - Verify jobs without email are routed to `manual_portal`.
  - Verify jobs with red flags or scam signs route to `manual_review`.
- [ ] **5. Cover Letter Generation**:
  - Verify cover letters are concise (150–250 words), grounded in profile skills, and free of placeholders (`[Name]`, `{{company}}`).
  - Verify resume selector picks the best match.
- [ ] **6. Manual Apply Flow**:
  - Verify the Manual Apply queue lists items ordered by score.
  - Test the kit display: clean tracking URLs, skills match/missing, and resume preview.
  - Mark one job as applied; verify status transitions to `manual_applied`.
- [ ] **7. Google OAuth & Health Check**:
  - Connect Google OAuth via `/auth/google/start`.
  - Verify health ping returns `ok`.
  - Verify Google Sheet sync creates headers and upserts application rows with plain-text formula protection.
- [ ] **8. Kill Switch & Dry-Run Enforcement**:
  - Test approving a job in `DRY_RUN=true`: confirm email is logged as simulated and not sent to recipient.
  - Turn Kill Switch `ON`: confirm sending is immediately blocked.
- [ ] **9. Soak Duration**:
  - Run staging for **48 continuous hours** with scheduled crons enabled.
  - Verify zero uncaught exceptions in Cloudflare Workers observability.
  - Check Telegram alerts for unexpected error notifications.
- [ ] **10. Production Authorization**:
  - Only after all 9 checks pass, proceed to enable `DRY_RUN=false` in Production using the confirmation modal.
