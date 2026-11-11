import { ConfigError } from './env.js';
import type { D1LikeDatabase } from './state-machine.js';

export const HKDF_SETTINGS_INFO = new TextEncoder().encode('pigeon:app_settings:aes-256-gcm:v1');
export const HKDF_SALT = new Uint8Array(32); // Fixed 32-byte zero salt

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b !== undefined) {
      binary += String.fromCharCode(b);
    }
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  try {
    const binary = atob(base64.trim());
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch (err) {
    throw new ConfigError(
      `Invalid base64 payload: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Validates master key presence and minimum 32-character length.
 */
export function validateMasterKey(masterKey?: string | null): string {
  if (!masterKey || typeof masterKey !== 'string') {
    throw new ConfigError(
      'Master encryption key is missing. Configure SETTINGS_ENCRYPTION_KEY or GOOGLE_TOKEN_ENCRYPTION_KEY.',
    );
  }
  const trimmed = masterKey.trim();
  if (trimmed.length < 32) {
    throw new ConfigError(
      'Master encryption key is invalid: must be at least 32 characters in length.',
    );
  }
  return trimmed;
}

/**
 * Derives a distinct AES-256-GCM key from masterKey using HKDF-SHA-256.
 */
export async function deriveSettingsKey(masterKey: string): Promise<CryptoKey> {
  const validKey = validateMasterKey(masterKey);
  const rawMasterKey = new TextEncoder().encode(validKey);

  const hkdfKey = await crypto.subtle.importKey('raw', rawMasterKey, { name: 'HKDF' }, false, [
    'deriveBits',
    'deriveKey',
  ]);

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: HKDF_SALT,
      info: HKDF_SETTINGS_INFO,
    },
    hkdfKey,
    256,
  );

  return crypto.subtle.importKey('raw', derivedBits, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export interface EncryptedSettingResult {
  ciphertext: string;
  iv: string;
  keyVersion: number;
}

/**
 * Encrypts a secret setting value with AES-256-GCM.
 * Uses a fresh 12-byte IV and sets the setting key as AAD.
 */
export async function encryptSetting(
  keyName: string,
  plaintext: string,
  masterKey?: string | null,
  keyVersion = 1,
): Promise<EncryptedSettingResult> {
  if (!keyName || typeof keyName !== 'string') {
    throw new ConfigError('Cannot encrypt setting: key name must be a non-empty string.');
  }
  const validKey = validateMasterKey(masterKey);
  const derivedKey = await deriveSettingsKey(validKey);

  const ivBytes = crypto.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode(keyName);
  const plaintextBytes = new TextEncoder().encode(plaintext);

  const ciphertextBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: ivBytes,
      additionalData: aad,
    },
    derivedKey,
    plaintextBytes,
  );

  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertextBuffer)),
    iv: bytesToBase64(ivBytes),
    keyVersion,
  };
}

/**
 * Decrypts an encrypted setting value with AES-256-GCM.
 * Validates AAD against keyName. Supports optional previous key for rotation.
 */
export async function decryptSetting(
  keyName: string,
  ciphertextB64: string,
  ivB64: string,
  masterKey?: string | null,
  previousMasterKey?: string | null,
): Promise<string> {
  if (!keyName || typeof keyName !== 'string') {
    throw new ConfigError('Cannot decrypt setting: key name must be a non-empty string.');
  }
  const validKey = validateMasterKey(masterKey);
  const aad = new TextEncoder().encode(keyName);
  const ciphertextBytes = base64ToBytes(ciphertextB64);
  const ivBytes = base64ToBytes(ivB64);

  // 1. Try current master key
  try {
    const derivedKey = await deriveSettingsKey(validKey);
    const decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: ivBytes as unknown as BufferSource,
        additionalData: aad,
      },
      derivedKey,
      ciphertextBytes as unknown as BufferSource,
    );
    return new TextDecoder().decode(decryptedBuffer);
  } catch {
    // 2. Try previous master key if configured
    if (
      previousMasterKey &&
      typeof previousMasterKey === 'string' &&
      previousMasterKey.trim().length >= 32
    ) {
      try {
        const prevDerivedKey = await deriveSettingsKey(previousMasterKey);
        const prevDecryptedBuffer = await crypto.subtle.decrypt(
          {
            name: 'AES-GCM',
            iv: ivBytes as unknown as BufferSource,
            additionalData: aad,
          },
          prevDerivedKey,
          ciphertextBytes as unknown as BufferSource,
        );
        return new TextDecoder().decode(prevDecryptedBuffer);
      } catch {
        // Fall through
      }
    }
    throw new ConfigError(
      `Decryption failed for setting '${keyName}': invalid key, tampered ciphertext, or mismatched AAD.`,
    );
  }
}

/**
 * Re-encrypts all secret rows in app_settings with the current masterKey.
 * Decrypts using currentMasterKey or previousMasterKey, generates fresh IVs,
 * increments key_version, and marks updated_by as 'rotation'.
 */
export async function rotateAppSettings(
  db: D1LikeDatabase,
  currentMasterKey?: string | null,
  previousMasterKey?: string | null,
): Promise<{ rotatedCount: number; keys: string[] }> {
  const validCurrentKey = validateMasterKey(currentMasterKey);
  const rows = await db
    .prepare('SELECT key, ciphertext, iv, key_version FROM app_settings WHERE is_secret = 1')
    .bind()
    .all<{ key: string; ciphertext: string; iv: string; key_version: number }>();

  const results = rows.results || [];
  const keys: string[] = [];

  for (const row of results) {
    if (!row.ciphertext || !row.iv) continue;
    const decrypted = await decryptSetting(
      row.key,
      row.ciphertext,
      row.iv,
      validCurrentKey,
      previousMasterKey,
    );

    const newEncrypted = await encryptSetting(
      row.key,
      decrypted,
      validCurrentKey,
      (row.key_version ?? 1) + 1,
    );

    const nowIso = new Date().toISOString();
    await db
      .prepare(
        `UPDATE app_settings
         SET ciphertext = ?, iv = ?, key_version = ?, updated_at = ?, updated_by = 'rotation'
         WHERE key = ?`,
      )
      .bind(newEncrypted.ciphertext, newEncrypted.iv, newEncrypted.keyVersion, nowIso, row.key)
      .run();

    keys.push(row.key);
  }

  return { rotatedCount: keys.length, keys };
}
