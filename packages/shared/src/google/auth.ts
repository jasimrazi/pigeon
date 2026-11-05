import type { Notifier } from '../notifier.js';
import { encryptRefreshToken, decryptRefreshToken } from './crypto.js';
import type {
  GoogleOAuthSecrets,
  GoogleTokenResponse,
  GoogleTokenRefreshResponse,
  AuthHealthState,
} from './types.js';

export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export const GOOGLE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/spreadsheets',
].join(' ');

export const KV_KEYS = {
  REFRESH_TOKEN_ENCRYPTED: 'google_refresh_token_encrypted',
  ACCESS_TOKEN: 'google_access_token',
  ACCESS_TOKEN_EXPIRES_AT: 'google_access_token_expires_at',
  AUTH_HEALTH: 'auth_health',
  AUTH_INVALID_NOTIFIED: 'auth_invalid_notified',
  SPREADSHEET_ID: 'google_spreadsheet_id',
} as const;

export class GoogleAuthError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'GoogleAuthError';
  }
}

/**
 * Builds the Google OAuth2 authorization start URL.
 */
export function getGoogleAuthUrl(options: {
  clientId: string;
  redirectUri: string;
  state?: string | undefined;
}): string {
  const params = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    response_type: 'code',
    scope: GOOGLE_OAUTH_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
  });

  if (options.state) {
    params.set('state', options.state);
  }

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Exchanges authorization code for tokens.
 */
export async function exchangeGoogleAuthCode(params: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    code: params.code,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: params.redirectUri,
    grant_type: 'authorization_code',
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const errorJson = (await res.json().catch(() => ({}))) as {
      error?: string;
      error_description?: string;
    };
    throw new GoogleAuthError(
      errorJson.error || 'token_exchange_failed',
      errorJson.error_description || `Failed to exchange auth code (${res.status})`,
      res.status,
    );
  }

  return (await res.json()) as GoogleTokenResponse;
}

/**
 * Refreshes access token using the decrypted refresh token.
 */
export async function refreshGoogleAccessToken(params: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<GoogleTokenRefreshResponse> {
  const body = new URLSearchParams({
    refresh_token: params.refreshToken,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    grant_type: 'refresh_token',
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const errorJson = (await res.json().catch(() => ({}))) as {
      error?: string;
      error_description?: string;
    };
    throw new GoogleAuthError(
      errorJson.error || 'token_refresh_failed',
      errorJson.error_description || `Failed to refresh access token (${res.status})`,
      res.status,
    );
  }

  return (await res.json()) as GoogleTokenRefreshResponse;
}

/**
 * Gets the current auth health state from KV.
 */
export async function getGoogleAuthHealth(config: KVLike): Promise<AuthHealthState> {
  const stored = await config.get(KV_KEYS.AUTH_HEALTH);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as AuthHealthState;
      if (parsed.status === 'ok' || parsed.status === 'invalid') {
        return parsed;
      }
    } catch {
      // Fallback
    }
  }

  return {
    status: 'ok',
    checked_at: new Date().toISOString(),
    reason: null,
  };
}

/**
 * Updates auth health state in KV and notifies exactly once on invalid status.
 */
export async function setGoogleAuthHealth(options: {
  config: KVLike;
  status: 'ok' | 'invalid';
  reason?: string | null;
  notifier?: Notifier | undefined;
}): Promise<void> {
  const { config, status, reason = null, notifier } = options;
  const nowIso = new Date().toISOString();

  const healthState: AuthHealthState = {
    status,
    checked_at: nowIso,
    reason,
  };

  await config.put(KV_KEYS.AUTH_HEALTH, JSON.stringify(healthState));

  if (status === 'invalid') {
    // Notify exactly once
    const alreadyNotified = await config.get(KV_KEYS.AUTH_INVALID_NOTIFIED);
    if (alreadyNotified !== 'true') {
      if (notifier) {
        await notifier.notify({
          key: 'auth_invalid',
          message: `Google OAuth health is invalid: ${reason || 'unauthorized'}. Please re-authenticate at /auth/google/start.`,
          details: { reason, checked_at: nowIso },
        });
      }
      await config.put(KV_KEYS.AUTH_INVALID_NOTIFIED, 'true');
    }
  } else if (status === 'ok') {
    // Reset notification flag when health returns to ok
    await config.delete(KV_KEYS.AUTH_INVALID_NOTIFIED);
  }
}

/**
 * Handles completing the OAuth flow after Google redirects to /auth/google/callback.
 * Encrypts refresh token, stores in KV, resets health to ok, and clears notification flag.
 */
export async function completeGoogleAuthCallback(options: {
  code: string;
  config: KVLike;
  secrets: GoogleOAuthSecrets;
  redirectUri: string;
  notifier?: Notifier | undefined;
}): Promise<{ success: boolean; access_token: string }> {
  const { code, config, secrets, redirectUri, notifier } = options;

  const tokens = await exchangeGoogleAuthCode({
    code,
    clientId: secrets.clientId,
    clientSecret: secrets.clientSecret,
    redirectUri,
  });

  if (tokens.refresh_token) {
    const encrypted = await encryptRefreshToken(tokens.refresh_token, secrets.tokenEncryptionKey);
    await config.put(KV_KEYS.REFRESH_TOKEN_ENCRYPTED, encrypted);
  }

  // Cache access token
  const nowMs = Date.now();
  const expiresAtMs = nowMs + tokens.expires_in * 1000;
  const bufferTtlSeconds = Math.max(60, tokens.expires_in - 300);

  await config.put(KV_KEYS.ACCESS_TOKEN, tokens.access_token, {
    expirationTtl: bufferTtlSeconds,
  });
  await config.put(KV_KEYS.ACCESS_TOKEN_EXPIRES_AT, String(expiresAtMs));

  // Reset health to ok
  await setGoogleAuthHealth({
    config,
    status: 'ok',
    reason: null,
    notifier,
  });

  return { success: true, access_token: tokens.access_token };
}

/**
 * Retrieves a valid Google access token, using KV cache or refreshing if needed.
 * Marks health invalid on invalid_grant or persistent 401.
 */
export async function getValidAccessToken(options: {
  config: KVLike;
  secrets: GoogleOAuthSecrets;
  notifier?: Notifier | undefined;
  nowMs?: number | undefined;
}): Promise<string> {
  const { config, secrets, notifier, nowMs = Date.now() } = options;

  // 1. Check health
  const health = await getGoogleAuthHealth(config);
  if (health.status === 'invalid') {
    throw new GoogleAuthError('auth_invalid', `Google auth is invalid: ${health.reason}`);
  }

  // 2. Check cached access token in KV
  const cachedToken = await config.get(KV_KEYS.ACCESS_TOKEN);
  const cachedExpiresAtStr = await config.get(KV_KEYS.ACCESS_TOKEN_EXPIRES_AT);

  if (cachedToken && cachedExpiresAtStr) {
    const expiresAtMs = Number(cachedExpiresAtStr);
    // Keep 5 minute buffer (300,000 ms)
    if (expiresAtMs - nowMs > 300_000) {
      return cachedToken;
    }
  }

  // 3. Needs refresh: fetch and decrypt refresh token
  const encryptedRefreshToken = await config.get(KV_KEYS.REFRESH_TOKEN_ENCRYPTED);
  if (!encryptedRefreshToken) {
    await setGoogleAuthHealth({
      config,
      status: 'invalid',
      reason: 'No refresh token stored',
      notifier,
    });
    throw new GoogleAuthError(
      'no_refresh_token',
      'No Google refresh token found. Please authenticate.',
    );
  }

  let decryptedRefreshToken: string;
  try {
    decryptedRefreshToken = await decryptRefreshToken(
      encryptedRefreshToken,
      secrets.tokenEncryptionKey,
    );
  } catch (err) {
    await setGoogleAuthHealth({
      config,
      status: 'invalid',
      reason: 'Failed to decrypt refresh token',
      notifier,
    });
    throw new GoogleAuthError(
      'token_decryption_failed',
      `Failed to decrypt refresh token: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 4. Request refreshed token from Google
  try {
    const refreshRes = await refreshGoogleAccessToken({
      refreshToken: decryptedRefreshToken,
      clientId: secrets.clientId,
      clientSecret: secrets.clientSecret,
    });

    const newExpiresAtMs = nowMs + refreshRes.expires_in * 1000;
    const bufferTtlSeconds = Math.max(60, refreshRes.expires_in - 300);

    await config.put(KV_KEYS.ACCESS_TOKEN, refreshRes.access_token, {
      expirationTtl: bufferTtlSeconds,
    });
    await config.put(KV_KEYS.ACCESS_TOKEN_EXPIRES_AT, String(newExpiresAtMs));

    return refreshRes.access_token;
  } catch (err) {
    if (err instanceof GoogleAuthError && (err.code === 'invalid_grant' || err.status === 401)) {
      await setGoogleAuthHealth({
        config,
        status: 'invalid',
        reason: err.code === 'invalid_grant' ? 'invalid_grant' : 'unauthorized_refresh',
        notifier,
      });
    }
    throw err;
  }
}

/**
 * Daily health ping to users.getProfile.
 * Verifies credentials, refreshes on 401 once, and marks health invalid on failure.
 */
export async function pingGoogleAuthHealth(options: {
  config: KVLike;
  secrets: GoogleOAuthSecrets;
  notifier?: Notifier | undefined;
}): Promise<AuthHealthState> {
  const { config, secrets, notifier } = options;

  let token: string;
  try {
    token = await getValidAccessToken({ config, secrets, notifier });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { status: 'invalid', checked_at: new Date().toISOString(), reason };
  }

  // 1. Initial attempt
  let profileRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${token}` },
  });

  // 2. If 401, force clear cached token and refresh once
  if (profileRes.status === 401) {
    await config.delete(KV_KEYS.ACCESS_TOKEN);
    await config.delete(KV_KEYS.ACCESS_TOKEN_EXPIRES_AT);

    try {
      token = await getValidAccessToken({ config, secrets, notifier });
      profileRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await setGoogleAuthHealth({ config, status: 'invalid', reason, notifier });
      return { status: 'invalid', checked_at: new Date().toISOString(), reason };
    }
  }

  if (profileRes.ok) {
    await setGoogleAuthHealth({ config, status: 'ok', reason: null, notifier });
    return { status: 'ok', checked_at: new Date().toISOString(), reason: null };
  } else {
    const reason = `users.getProfile returned status ${profileRes.status}`;
    await setGoogleAuthHealth({ config, status: 'invalid', reason, notifier });
    return { status: 'invalid', checked_at: new Date().toISOString(), reason };
  }
}
