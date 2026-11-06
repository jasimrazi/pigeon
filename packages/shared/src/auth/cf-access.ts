export interface JwkKey {
  kid: string;
  kty: string;
  alg: string;
  use: string;
  n: string;
  e: string;
}

export interface JwksResponse {
  keys: JwkKey[];
}

export interface VerifyJwtOptions {
  teamDomain: string;
  audience: string;
  jwks?: JwksResponse | undefined;
  fetchFn?: typeof fetch | undefined;
  nowMs?: number | undefined;
}

export interface VerifyJwtResult {
  valid: boolean;
  reason?: string | undefined;
  payload?: Record<string, unknown> | undefined;
}

function base64UrlToBytes(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (base64.length % 4)) % 4;
  const padded = base64 + '='.repeat(padLen);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// In-memory cache for JWKS per team domain
const jwksCache = new Map<string, { keys: JwkKey[]; fetchedAt: number }>();

export function clearJwksCache(): void {
  jwksCache.clear();
}

/**
 * Fetches and caches the Cloudflare Access JWKS public keys.
 */
export async function getTeamJwks(
  teamDomain: string,
  fetchFn: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<JwksResponse> {
  const cached = jwksCache.get(teamDomain);
  const now = Date.now();
  if (cached && typeof cached.fetchedAt === 'number' && now - cached.fetchedAt < 60 * 60 * 1000) {
    return { keys: cached.keys };
  }

  const normalizedDomain = teamDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const certsUrl = `https://${normalizedDomain}/cdn-cgi/access/certs`;

  const res = await fetchFn(certsUrl);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch Cloudflare Access certs from ${certsUrl}: status ${res.status}`,
    );
  }

  const jwks = (await res.json()) as JwksResponse;
  jwksCache.set(teamDomain, { keys: jwks.keys || [], fetchedAt: now });
  return jwks;
}

/**
 * Verifies a Cloudflare Access JWT assertion token.
 * Validates header (RS256, kid), signature against JWKS, issuer, audience, and expiry.
 */
export async function verifyCfAccessJwt(
  token: string,
  options: VerifyJwtOptions,
): Promise<VerifyJwtResult> {
  if (!token || typeof token !== 'string') {
    return { valid: false, reason: 'Missing token' };
  }

  const parts = token.trim().split('.');
  if (parts.length !== 3) {
    return { valid: false, reason: 'Malformed token: expected 3 parts' };
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  if (!headerB64 || !payloadB64 || !signatureB64) {
    return { valid: false, reason: 'Malformed token: expected 3 non-empty parts' };
  }

  // 1. Parse header
  let header: { alg?: string; kid?: string };
  try {
    const headerJson = new TextDecoder().decode(base64UrlToBytes(headerB64));
    header = JSON.parse(headerJson);
  } catch {
    return { valid: false, reason: 'Invalid token header' };
  }

  if (header.alg !== 'RS256') {
    return { valid: false, reason: `Unsupported algorithm: expected RS256, got ${header.alg}` };
  }
  if (!header.kid) {
    return { valid: false, reason: 'Missing kid in token header' };
  }

  // 2. Parse payload
  let payload: Record<string, unknown>;
  try {
    const payloadJson = new TextDecoder().decode(base64UrlToBytes(payloadB64));
    payload = JSON.parse(payloadJson);
  } catch {
    return { valid: false, reason: 'Invalid token payload' };
  }

  const nowSec = Math.floor((options.nowMs ?? Date.now()) / 1000);

  // 3. Validate Expiry (exp)
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) {
    return { valid: false, reason: 'Token expired', payload };
  }

  // 4. Validate Issuer (iss)
  const normalizedDomain = options.teamDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const expectedIssuer = `https://${normalizedDomain}`;
  if (payload.iss !== expectedIssuer) {
    return {
      valid: false,
      reason: `Invalid issuer: expected ${expectedIssuer}, got ${payload.iss}`,
      payload,
    };
  }

  // 5. Validate Audience (aud)
  const aud = payload.aud;
  const expectedAud = options.audience;
  const audValid = Array.isArray(aud) ? aud.includes(expectedAud) : aud === expectedAud;
  if (!audValid) {
    return {
      valid: false,
      reason: `Invalid audience: expected ${expectedAud}, got ${JSON.stringify(aud)}`,
      payload,
    };
  }

  // 6. Find JWK
  let jwks = options.jwks;
  if (!jwks) {
    try {
      jwks = await getTeamJwks(options.teamDomain, options.fetchFn);
    } catch (err) {
      return { valid: false, reason: `Failed to retrieve JWKS: ${(err as Error).message}` };
    }
  }

  const matchingKey = jwks.keys.find((k) => k.kid === header.kid);
  if (!matchingKey) {
    return { valid: false, reason: `Public key with kid '${header.kid}' not found in JWKS` };
  }

  // 7. Verify Signature with WebCrypto
  try {
    const cryptoKey = await crypto.subtle.importKey(
      'jwk',
      matchingKey,
      {
        name: 'RSASSA-PKCS1-v1_5',
        hash: 'SHA-256',
      },
      false,
      ['verify'],
    );

    const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const signatureBytes = base64UrlToBytes(signatureB64);

    const verified = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      signatureBytes as unknown as BufferSource,
      signedData as unknown as BufferSource,
    );

    if (!verified) {
      return { valid: false, reason: 'Invalid signature', payload };
    }

    return { valid: true, payload };
  } catch (err) {
    return { valid: false, reason: `Signature verification error: ${(err as Error).message}` };
  }
}
