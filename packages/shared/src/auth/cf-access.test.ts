import { describe, it, expect, beforeAll } from 'vitest';
import {
  verifyCfAccessJwt,
  bytesToBase64Url,
  type JwkKey,
  type JwksResponse,
} from './cf-access.js';

describe('Cloudflare Access JWT Verification', () => {
  let keyPair: CryptoKeyPair;
  let publicJwk: JwkKey;
  const keyId = 'access-test-key-1';
  const teamDomain = 'my-team.cloudflareaccess.com';
  const audience = 'aud-test-12345';

  beforeAll(async () => {
    keyPair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    );

    const exported = (await crypto.subtle.exportKey('jwk', keyPair.publicKey)) as unknown as JwkKey;
    publicJwk = {
      ...exported,
      kid: keyId,
      alg: 'RS256',
      use: 'sig',
    };
  });

  async function createSignedJwt(
    payloadOverrides: Record<string, unknown> = {},
    keyIdToUse = keyId,
    tamperSignature = false,
  ): Promise<string> {
    const header = {
      alg: 'RS256',
      kid: keyIdToUse,
      typ: 'JWT',
    };

    const nowSec = Math.floor(Date.now() / 1000);
    const payload = {
      iss: `https://${teamDomain}`,
      aud: audience,
      sub: 'alex@example.com',
      email: 'alex@example.com',
      iat: nowSec - 60,
      exp: nowSec + 3600, // 1 hr in future
      ...payloadOverrides,
    };

    const headerB64 = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(header)));
    const payloadB64 = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
    const dataToSign = new TextEncoder().encode(`${headerB64}.${payloadB64}`);

    const signatureBytes = new Uint8Array(
      await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, dataToSign),
    );

    if (tamperSignature && signatureBytes.length > 0) {
      signatureBytes[0] = (signatureBytes[0] ?? 0) ^ 0xff; // corrupt first byte
    }

    const signatureB64 = bytesToBase64Url(signatureBytes);
    return `${headerB64}.${payloadB64}.${signatureB64}`;
  }

  it('rejects an empty or non-string token', async () => {
    const res = await verifyCfAccessJwt('', { teamDomain, audience });
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('Missing token');
  });

  it('rejects a malformed token (not 3 dot-separated parts)', async () => {
    const res = await verifyCfAccessJwt('not.a.valid.jwt.token', { teamDomain, audience });
    expect(res.valid).toBe(false);
    expect(res.reason).toContain('Malformed token');
  });

  it('rejects an expired token', async () => {
    const expiredSec = Math.floor(Date.now() / 1000) - 300;
    const token = await createSignedJwt({ exp: expiredSec });

    const jwks: JwksResponse = { keys: [publicJwk] };
    const res = await verifyCfAccessJwt(token, { teamDomain, audience, jwks });

    expect(res.valid).toBe(false);
    expect(res.reason).toBe('Token expired');
  });

  it('rejects a token with wrong audience', async () => {
    const token = await createSignedJwt({ aud: 'wrong-audience-id' });

    const jwks: JwksResponse = { keys: [publicJwk] };
    const res = await verifyCfAccessJwt(token, { teamDomain, audience, jwks });

    expect(res.valid).toBe(false);
    expect(res.reason).toContain('Invalid audience');
  });

  it('rejects a token with wrong issuer', async () => {
    const token = await createSignedJwt({ iss: 'https://evil.attacker.com' });

    const jwks: JwksResponse = { keys: [publicJwk] };
    const res = await verifyCfAccessJwt(token, { teamDomain, audience, jwks });

    expect(res.valid).toBe(false);
    expect(res.reason).toContain('Invalid issuer');
  });

  it('rejects a token with a bad signature', async () => {
    const token = await createSignedJwt({}, keyId, true /* tamperSignature */);

    const jwks: JwksResponse = { keys: [publicJwk] };
    const res = await verifyCfAccessJwt(token, { teamDomain, audience, jwks });

    expect(res.valid).toBe(false);
    expect(res.reason).toBe('Invalid signature');
  });

  it('rejects a token with an unsupported algorithm (requires alg RS256)', async () => {
    const header = { alg: 'HS256', kid: keyId, typ: 'JWT' };
    const payload = {
      iss: `https://${teamDomain}`,
      aud: audience,
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const headerB64 = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(header)));
    const payloadB64 = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
    const fakeToken = `${headerB64}.${payloadB64}.fakeSignature`;

    const res = await verifyCfAccessJwt(fakeToken, { teamDomain, audience });
    expect(res.valid).toBe(false);
    expect(res.reason).toContain('Unsupported algorithm: expected RS256');
  });

  it('refreshes JWKS once on unknown kid', async () => {
    // Generate a second key pair to simulate a key rotated in
    const keyPair2 = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    );
    const exported2 = (await crypto.subtle.exportKey(
      'jwk',
      keyPair2.publicKey,
    )) as unknown as JwkKey;
    const publicJwk2: JwkKey = {
      ...exported2,
      kid: 'rotated-key-2',
      alg: 'RS256',
      use: 'sig',
    };

    // Sign a token using rotated key 2
    const nowSec = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', kid: 'rotated-key-2', typ: 'JWT' };
    const payload = {
      iss: `https://${teamDomain}`,
      aud: audience,
      sub: 'alex@example.com',
      email: 'alex@example.com',
      exp: nowSec + 3600,
    };
    const headerB64 = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(header)));
    const payloadB64 = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
    const dataToSign = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const signatureBytes = new Uint8Array(
      await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair2.privateKey, dataToSign),
    );
    const rotatedToken = `${headerB64}.${payloadB64}.${bytesToBase64Url(signatureBytes)}`;

    let callCount = 0;
    const mockFetch = async () => {
      callCount++;
      if (callCount === 1) {
        // Initial fetch returns only key 1
        return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 });
      }
      // On refreshed fetch, returns both key 1 and key 2
      return new Response(JSON.stringify({ keys: [publicJwk, publicJwk2] }), { status: 200 });
    };

    const res = await verifyCfAccessJwt(rotatedToken, {
      teamDomain,
      audience,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(res.valid).toBe(true);
    expect(callCount).toBe(2); // 1 initial + 1 refreshed on unknown kid
  });

  it('enforces allowedEmail claim matching CF_ACCESS_ALLOWED_EMAIL', async () => {
    const validToken = await createSignedJwt({ email: 'owner@example.com' });
    const jwks: JwksResponse = { keys: [publicJwk] };

    // 1. Matches allowedEmail -> valid
    const resAllowed = await verifyCfAccessJwt(validToken, {
      teamDomain,
      audience,
      jwks,
      allowedEmail: 'owner@example.com',
    });
    expect(resAllowed.valid).toBe(true);

    // 2. Mismatched allowedEmail -> rejected
    const resDisallowed = await verifyCfAccessJwt(validToken, {
      teamDomain,
      audience,
      jwks,
      allowedEmail: 'other@example.com',
    });
    expect(resDisallowed.valid).toBe(false);
    expect(resDisallowed.reason).toContain('Forbidden email');

    // 3. Token missing email claim -> rejected
    const tokenNoEmail = await createSignedJwt({ email: undefined });
    const resNoEmail = await verifyCfAccessJwt(tokenNoEmail, {
      teamDomain,
      audience,
      jwks,
      allowedEmail: 'owner@example.com',
    });
    expect(resNoEmail.valid).toBe(false);
    expect(resNoEmail.reason).toContain('Forbidden email');
  });

  it('accepts a valid token signed with the team JWKS public key', async () => {
    const token = await createSignedJwt();

    const jwks: JwksResponse = { keys: [publicJwk] };
    const res = await verifyCfAccessJwt(token, { teamDomain, audience, jwks });

    expect(res.valid).toBe(true);
    expect(res.payload?.email).toBe('alex@example.com');
    expect(res.payload?.iss).toBe(`https://${teamDomain}`);
  });
});
