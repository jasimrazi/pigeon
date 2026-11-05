# Pigeon: Job Alert Email Setup & Forwarding Guide

Pigeon ingests job opportunities directly from portal alert emails instead of automating or scraping web search results. This strictly adheres to portal terms of service and prevents automated scraping of LinkedIn, Indeed, or Naukri.

---

## 1. Architecture Overview

1. **Email Routing**: Portal alerts sent to your personal email address or dedicated forwarding address are forwarded to Cloudflare Email Routing.
2. **Email Worker**: Cloudflare triggers Pigeon's Email Worker (`apps/worker/src/index.ts` `email` handler).
3. **MIME & Offline Parsing**: `postal-mime` parses the raw MIME stream. Portal-specific parsers extract the job title, company, location, clean apply URL, and salary (if present).
4. **Offline Security Guarantee**: Pigeon **never** performs any outbound network request on links discovered inside alert emails.
5. **Deduplication**: Ingested alert jobs are deduplicated against existing database entries via SHA256 dedupe keys.
6. **Routing**: Portal alert jobs are tagged with `source_kind: "alert_email"`, `contact_source: "none"`, and route to `manual_portal` for human review and application.

---

## 2. Cloudflare Email Routing Setup

1. In the Cloudflare Dashboard, open your domain and navigate to **Email Routing** > **Routing rules**.
2. Click **Create rule**:
   - **Type**: Custom address (e.g. `alerts@yourdomain.com`).
   - **Action**: Send to Worker.
   - **Destination**: `pigeon-worker` (or your configured environment worker).
3. Note your configured forwarding address. Set it in Pigeon:
   - Either via wrangler secret / variable: `ALERT_FORWARDING_ADDRESS = "alerts@yourdomain.com"` (or your forwarding personal email).
   - Or by setting your email in your profile (`profile.email`).

---

## 3. Portal Setup & Forwarding Rules

### A. LinkedIn Job Alerts

1. Log in to **LinkedIn** and search for target job titles (e.g., _Senior Systems Engineer_, _Backend Architect_).
2. Apply your desired filters (e.g., _Location: Remote_, _Date Posted: Past 24 hours_).
3. Toggle the **Set alert** switch to **On**.
4. In **Settings** > **Notifications** > **Searching for a job**, set notification frequency to **Daily digest**.
5. **Forwarding Rule (e.g., Gmail)**:
   - Filter criteria: `from:(jobalerts-noreply@linkedin.com)`
   - Action: `Forward to: alerts@yourdomain.com`

### B. Naukri Job Alerts

1. Log in to **Naukri** and configure a Custom Job Alert (under **My Naukri** > **Job Alerts**).
2. Define keywords, preferred locations (e.g., _Bengaluru_, _Remote_), and experience range.
3. Select **Frequency**: Daily.
4. **Forwarding Rule**:
   - Filter criteria: `from:(@naukri.com)`
   - Action: `Forward to: alerts@yourdomain.com`

### C. Indeed Job Alerts

1. Search for your target role and location on **Indeed**.
2. Click **Get job alerts for this search** and enter your forwarding-enabled email address.
3. Confirm the subscription email from Indeed.
4. **Forwarding Rule**:
   - Filter criteria: `from:(alert@indeed.com OR @indeed.com)`
   - Action: `Forward to: alerts@yourdomain.com`

---

## 4. Security & Validation Rules

Pigeon enforces strict security controls on incoming emails:

1. **Sender Domain Allowlist**:
   Only emails from authorized sender domains (`linkedin.com`, `naukri.com`, `indeed.com`, and their subdomains) are accepted.
   - Emails from unrecognized senders are dropped immediately.
   - A drop event (`type: "email_dropped"`, `reason: "unauthorized_sender"`) is recorded with only envelope metadata. **No email body content or subject is ever logged.**

2. **Forwarding Address Verification**:
   The incoming message's envelope recipient, sender, or header (`To`, `Delivered-To`, `X-Forwarded-For`, `Resent-From`) must match the configured forwarding address.
   - Messages forwarded from or to unauthorized addresses are dropped with `reason: "invalid_forwarding_address"`.

3. **Tracking URL Stripping**:
   All tracking and analytics parameters (`utm_*`, `trk`, `trackingId`, `refId`, `from`, `tk`, `src`, `sid`, `xp`, `px`, etc.) are stripped from apply links while preserving functional identifiers (such as Indeed's `jk` job key).

4. **HTML Content Sanitization**:
   Job titles, companies, locations, and descriptions are rendered as sanitized plain text. HTML tags and escaped entities are completely stripped before storing.

---

## 5. Parser Health & Circuit Monitoring

Pigeon continuously monitors the health of portal HTML parsers:

- **Empty Streak Tracking**: Every incoming digest is tracked in `source_state.parser_empty_streak`.
- **Zero Jobs Detected**: An email that should contain jobs but yields zero increments `parser_empty_streak` and logs a `parser_empty` event.
- **Parser Suspect Alert**:
  - At **3 consecutive empty parses**, Pigeon writes a `parser_suspect` event and triggers `Notifier.notify(key="parser_suspect:<portal>")` **exactly once**.
  - The portal is marked `untrusted = 1` in `source_state`.
  - Any subsequent jobs ingested from this portal receive `untrusted = true` and `route_reason: "untrusted_portal"`, warning you to verify links and details in the Manual Apply queue.
- **Recovery**: A subsequent successful parse with 1 or more jobs automatically resets `parser_empty_streak = 0` and restores trusted status.
