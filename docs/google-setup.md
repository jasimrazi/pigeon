# Google OAuth & Gmail Setup Guide

This guide walks through configuring Google Cloud OAuth 2.0 credentials and Gmail permissions for Pigeon.

## 1. Create a Google Cloud Project

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Click **Select a project** > **New Project**.
3. Name your project (e.g. `pigeon-job-automation`) and click **Create**.

## 2. Enable Required Google APIs

1. In the sidebar, navigate to **APIs & Services** > **Library**.
2. Search for and enable the following APIs:
   - **Gmail API**
   - **Google Sheets API**

## 3. Configure OAuth Consent Screen

> [!IMPORTANT]
> **Production Status Required:** A refresh token issued under an OAuth app in "Testing" mode expires after **7 days**, which breaks automated sending and inbox syncing. You MUST set the publishing status to **In production**.

1. Go to **APIs & Services** > **OAuth consent screen**.
2. Select **External** user type and click **Create**.
3. Fill in the App Information:
   - **App name**: `Pigeon`
   - **User support email**: Your personal Google account email
   - **Developer contact information**: Your email
4. On the **Scopes** page, click **Add or Remove Scopes** and add:
   - `https://www.googleapis.com/auth/gmail.send` (Send emails on your behalf)
   - `https://www.googleapis.com/auth/gmail.readonly` (Read incoming emails and threads)
   - `https://www.googleapis.com/auth/spreadsheets` (Sync application rows to Google Sheets)
5. On the **OAuth consent screen** summary page, under **Publishing status**, click **Publish App** and confirm to move it to **In production**.
   > [!NOTE]
   > Google will display a note about unverified app warnings when you log in. Because you are the sole personal user of this application, you can bypass the warning by clicking **Advanced > Go to Pigeon (unsafe)** during the initial authorization flow. Verification by Google is not required for personal, single-user projects.

## 4. Create OAuth 2.0 Client Credentials

1. Go to **APIs & Services** > **Credentials**.
2. Click **Create Credentials** > **OAuth client ID**.
3. Set **Application type** to **Web application**.
4. Name: `Pigeon Worker Client`.
5. Under **Authorized redirect URIs**, add:
   - For local development: `http://localhost:8787/auth/google/callback`
   - For production: `https://pigeon-worker.<your-subdomain>.workers.dev/auth/google/callback`
6. Click **Create**. Note down your **Client ID** and **Client Secret**.

## 5. Configure Cloudflare Secrets

Run the following commands using `wrangler` to configure your secrets:

```bash
# 1. Google OAuth Client ID
wrangler secret put GOOGLE_CLIENT_ID

# 2. Google OAuth Client Secret
wrangler secret put GOOGLE_CLIENT_SECRET

# 3. Encryption key for storing the refresh token (32 random hex or base64 characters)
wrangler secret put GOOGLE_TOKEN_ENCRYPTION_KEY
```

> [!TIP]
> You can generate a strong encryption key with:
> `node -e "console.log(crypto.randomBytes(32).toString('hex'))"`

## 6. Authorize Pigeon

1. Navigate to your worker's start URL:
   `http://localhost:8787/auth/google/start` (or your deployed production URL).
2. Log into your Google account and grant the requested permissions.
3. Upon approval, Google redirects to `/auth/google/callback`.
4. Pigeon encrypts the refresh token using AES-256-GCM, stores it securely in Cloudflare KV (`CONFIG`), initializes the access token cache, and sets auth health to `ok`.
