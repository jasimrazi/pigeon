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

  it('accepts a valid token signed with the team JWKS public key', async () => {
    const token = await createSignedJwt();

    const jwks: JwksResponse = { keys: [publicJwk] };
    const res = await verifyCfAccessJwt(token, { teamDomain, audience, jwks });

    expect(res.valid).toBe(true);
    expect(res.payload?.email).toBe('alex@example.com');
    expect(res.payload?.iss).toBe(`https://${teamDomain}`);
  });
});
