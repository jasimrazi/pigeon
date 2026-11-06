# Secrets Checklist and Configuration Guide

This guide details all required secrets and configuration variables for Pigeon across Staging and Production environments.

> [!IMPORTANT]
> **Zero Credential Commits**: Never commit credentials, API keys, or encryption keys to version control. All secrets must be provisioned securely via `wrangler secret put`.

---

## 1. Secrets Reference

| Secret Name | Required By | Description | Example / Format |
| :--- | :--- | :--- | :--- |
| `GOOGLE_CLIENT_ID` | Google OAuth (Gmail & Sheets) | Client ID generated in Google Cloud Console | `12345-abc.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | Google OAuth (Gmail & Sheets) | Client Secret paired with Client ID | `GOCSPX-xxxxxxxxxxxxxx` |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | Google Token Storage | 256-bit key for WebCrypto AES-GCM encryption of refresh tokens | 64-char hex string or 32-byte Base64 string |
| `GEMINI_API_KEY` | LLM Scoring / Letters | Gemini API Key (when `LLM_PROVIDER="gemini"`) | `AIzaSy...` |
| `ADZUNA_APP_ID` | Adzuna Job Source | Adzuna Developer Application ID | `a1b2c3d4` |
| `ADZUNA_APP_KEY` | Adzuna Job Source | Adzuna Developer Application Key | `9f8e7d6c5b4a3...` |
| `TELEGRAM_BOT_TOKEN` | Alert Notifier | Telegram Bot Token obtained from `@BotFather` | `123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ` |
| `TELEGRAM_CHAT_ID` | Alert Notifier | Telegram Chat ID of owner to receive notifications | `987654321` |
| `CF_ACCESS_AUD` | Cloudflare Access Auth | Expected Audience (`aud`) tag from Access Application | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `CF_ACCESS_TEAM_DOMAIN` | Cloudflare Access Auth | Team domain hosting the Access authentication certs | `https://my-team.cloudflareaccess.com` |
| `CF_ACCESS_ALLOWED_EMAIL` | Cloudflare Access Auth | Owner email claim required on incoming Access JWTs | `owner@example.com` |

---

## 2. Environment Variables vs Secrets

Non-sensitive configuration is set directly in `apps/worker/wrangler.toml` under `[vars]` or environment sections:

| Variable | Staging | Production | Purpose |
| :--- | :--- | :--- | :--- |
| `ENV` | `staging` | `prod` | Runtime environment name |
| `DRY_RUN` | `"true"` | `"true"` (default) | Safe mode toggle. Must be set to `"false"` only after soak |
| `LLM_PROVIDER` | `workers-ai` | `workers-ai` | Default LLM engine (`workers-ai` or `gemini`) |
| `DASHBOARD_ORIGIN` | `https://pigeon-staging.pages.dev` | `https://pigeon.pages.dev` | Allowed CORS / CSRF origin |
| `ALERT_FORWARDING_ADDRESS` | `alerts-staging@domain.com` | `alerts@domain.com` | Expected envelope sender for ingested job alerts |
| `GOOGLE_SHEET_ID` | `<staging-sheet-id>` | `<prod-sheet-id>` | Target Google Sheet ID for one-way sync |

---

## 3. Generating Secure Encryption Keys

Generate a cryptographically secure 256-bit key for `GOOGLE_TOKEN_ENCRYPTION_KEY`:

```bash
# Using Node.js crypto
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Or using OpenSSL
openssl rand -hex 32
```

---

## 4. Provisioning Secrets via Wrangler CLI

Run these commands from the `apps/worker` directory (or use `--cwd apps/worker`):

### Staging Environment (`--env staging`)

```bash
# Google OAuth
pnpm --filter @pigeon/worker exec wrangler secret put GOOGLE_CLIENT_ID --env staging
pnpm --filter @pigeon/worker exec wrangler secret put GOOGLE_CLIENT_SECRET --env staging
pnpm --filter @pigeon/worker exec wrangler secret put GOOGLE_TOKEN_ENCRYPTION_KEY --env staging

# Job Sources
pnpm --filter @pigeon/worker exec wrangler secret put ADZUNA_APP_ID --env staging
pnpm --filter @pigeon/worker exec wrangler secret put ADZUNA_APP_KEY --env staging

# Telegram Notifier
pnpm --filter @pigeon/worker exec wrangler secret put TELEGRAM_BOT_TOKEN --env staging
pnpm --filter @pigeon/worker exec wrangler secret put TELEGRAM_CHAT_ID --env staging

# Cloudflare Access
pnpm --filter @pigeon/worker exec wrangler secret put CF_ACCESS_AUD --env staging
pnpm --filter @pigeon/worker exec wrangler secret put CF_ACCESS_TEAM_DOMAIN --env staging
pnpm --filter @pigeon/worker exec wrangler secret put CF_ACCESS_ALLOWED_EMAIL --env staging

# Optional LLM
pnpm --filter @pigeon/worker exec wrangler secret put GEMINI_API_KEY --env staging
```

### Production Environment (`--env prod`)

```bash
# Google OAuth
pnpm --filter @pigeon/worker exec wrangler secret put GOOGLE_CLIENT_ID --env prod
pnpm --filter @pigeon/worker exec wrangler secret put GOOGLE_CLIENT_SECRET --env prod
pnpm --filter @pigeon/worker exec wrangler secret put GOOGLE_TOKEN_ENCRYPTION_KEY --env prod

# Job Sources
pnpm --filter @pigeon/worker exec wrangler secret put ADZUNA_APP_ID --env prod
pnpm --filter @pigeon/worker exec wrangler secret put ADZUNA_APP_KEY --env prod

# Telegram Notifier
pnpm --filter @pigeon/worker exec wrangler secret put TELEGRAM_BOT_TOKEN --env prod
pnpm --filter @pigeon/worker exec wrangler secret put TELEGRAM_CHAT_ID --env prod

# Cloudflare Access
pnpm --filter @pigeon/worker exec wrangler secret put CF_ACCESS_AUD --env prod
pnpm --filter @pigeon/worker exec wrangler secret put CF_ACCESS_TEAM_DOMAIN --env prod
pnpm --filter @pigeon/worker exec wrangler secret put CF_ACCESS_ALLOWED_EMAIL --env prod

# Optional LLM
pnpm --filter @pigeon/worker exec wrangler secret put GEMINI_API_KEY --env prod
```

---

## 5. Verification Checklist

Before starting Pigeon in Staging or Production:
1. Verify secret list in Cloudflare Dashboard:
   `Workers & Pages -> pigeon-worker-staging / pigeon-worker-prod -> Settings -> Variables -> Secrets`.
2. Confirm all 10 core secrets are present and encrypted.
3. Verify that `DRY_RUN` is set to `"true"` on initial deployment.
4. Verify `DASHBOARD_ORIGIN` matches the exact URL of the deployed Cloudflare Pages dashboard.
