/**
 * WebCrypto AES-GCM (256-bit) encryption and decryption helper.
 * Strictly uses WebCrypto subtle API (compatible with Cloudflare Workers runtime).
 */

async function deriveCryptoKey(secretKey: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  // Hash secretKey using SHA-256 to ensure exact 32 bytes (256 bits) for AES-GCM
  const keyBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(secretKey));
  return crypto.subtle.importKey('raw', keyBuffer, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

/**
 * Encrypts a plaintext refresh token using AES-256-GCM.
 * Prepends a 12-byte random IV and returns a base64url string.
 */
export async function encryptRefreshToken(plaintext: string, secretKey: string): Promise<string> {
  const key = await deriveCryptoKey(secretKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encodedText = new TextEncoder().encode(plaintext);

  const ciphertextBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encodedText);

  const ciphertextArray = new Uint8Array(ciphertextBuffer);
  const combined = new Uint8Array(iv.length + ciphertextArray.length);
  combined.set(iv, 0);
  combined.set(ciphertextArray, iv.length);

  // Convert to base64url string
  let binary = '';
  for (let i = 0; i < combined.length; i++) {
    const byte = combined[i];
    if (byte !== undefined) {
      binary += String.fromCharCode(byte);
    }
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decrypts an encrypted refresh token (IV + ciphertext in base64url).
 */
export async function decryptRefreshToken(
  encryptedData: string,
  secretKey: string,
): Promise<string> {
  const key = await deriveCryptoKey(secretKey);

  // Convert base64url to regular base64
  let base64 = encryptedData.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }

  const binary = atob(base64);
  const combined = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    combined[i] = binary.charCodeAt(i);
  }

  if (combined.length < 13) {
    throw new Error('Invalid encrypted token: data too short.');
  }

  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  const decryptedBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);

  return new TextDecoder().decode(decryptedBuffer);
}
