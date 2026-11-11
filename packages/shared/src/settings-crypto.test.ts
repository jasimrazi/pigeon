import { describe, it, expect } from 'vitest';
import {
  encryptSetting,
  decryptSetting,
  bytesToBase64,
  base64ToBytes,
  rotateAppSettings,
} from './settings-crypto.js';
import { ConfigError } from './env.js';
import type { D1LikeDatabase } from './state-machine.js';

describe('Settings Storage Crypto (AES-256-GCM + HKDF)', () => {
  const masterKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const previousKey = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
  const wrongKey = 'wrongkeywrongkeywrongkeywrongkeywrongkeywrongkey12345678';

  it('successfully encrypts and decrypts a secret value (round trip)', async () => {
    const keyName = 'GOOGLE_CLIENT_SECRET';
    const secretValue = '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4567890';

    const encrypted = await encryptSetting(keyName, secretValue, masterKey);
    expect(encrypted.ciphertext).toBeDefined();
    expect(encrypted.iv).toBeDefined();
    expect(encrypted.keyVersion).toBe(1);

    const decrypted = await decryptSetting(keyName, encrypted.ciphertext, encrypted.iv, masterKey);
    expect(decrypted).toBe(secretValue);
  });

  it('fails decryption if ciphertext is tampered with', async () => {
    const keyName = 'GEMINI_API_KEY';
    const secretValue = 'AIzaSy1234567890abcdefghijklmnopqrstuv';

    const encrypted = await encryptSetting(keyName, secretValue, masterKey);
    const bytes = base64ToBytes(encrypted.ciphertext);
    // Tamper with the last byte
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff;
    const tamperedCiphertext = bytesToBase64(bytes);

    await expect(
      decryptSetting(keyName, tamperedCiphertext, encrypted.iv, masterKey),
    ).rejects.toThrow(ConfigError);
  });

  it('fails decryption if wrong AAD (different setting key name) is used', async () => {
    const keyName1 = 'GOOGLE_CLIENT_ID';
    const keyName2 = 'TELEGRAM_BOT_TOKEN';
    const secretValue = '123456789-client-id.apps.googleusercontent.com';

    const encrypted = await encryptSetting(keyName1, secretValue, masterKey);

    // Attempt to decrypt with keyName2 (simulating row swap attack)
    await expect(
      decryptSetting(keyName2, encrypted.ciphertext, encrypted.iv, masterKey),
    ).rejects.toThrow(ConfigError);
  });

  it('fails decryption if decrypted with wrong key', async () => {
    const keyName = 'TELEGRAM_BOT_TOKEN';
    const secretValue = '123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ';

    const encrypted = await encryptSetting(keyName, secretValue, masterKey);

    await expect(
      decryptSetting(keyName, encrypted.ciphertext, encrypted.iv, wrongKey),
    ).rejects.toThrow(ConfigError);
  });

  it('decrypts with previousMasterKey when encrypted with previous key', async () => {
    const keyName = 'GEMINI_API_KEY';
    const secretValue = 'AIzaSyOldSecretRotatedKey987654321';

    // Encrypted with previous key
    const encrypted = await encryptSetting(keyName, secretValue, previousKey);

    // Decrypting with only masterKey fails
    await expect(
      decryptSetting(keyName, encrypted.ciphertext, encrypted.iv, masterKey),
    ).rejects.toThrow(ConfigError);

    // Decrypting with masterKey AND previousMasterKey succeeds
    const decrypted = await decryptSetting(
      keyName,
      encrypted.ciphertext,
      encrypted.iv,
      masterKey,
      previousKey,
    );
    expect(decrypted).toBe(secretValue);
  });

  it('generates a unique 12-byte IV on every write', async () => {
    const keyName = 'GOOGLE_CLIENT_SECRET';
    const secretValue = 'same-secret-value-multiple-writes';

    const enc1 = await encryptSetting(keyName, secretValue, masterKey);
    const enc2 = await encryptSetting(keyName, secretValue, masterKey);
    const enc3 = await encryptSetting(keyName, secretValue, masterKey);

    expect(enc1.iv).not.toBe(enc2.iv);
    expect(enc2.iv).not.toBe(enc3.iv);
    expect(enc1.iv).not.toBe(enc3.iv);

    const iv1Bytes = base64ToBytes(enc1.iv);
    expect(iv1Bytes.length).toBe(12);
  });

  it('throws ConfigError when master key is missing or invalid (<32 chars)', async () => {
    const keyName = 'GOOGLE_CLIENT_SECRET';
    const secretValue = 'secret';

    // Missing key (undefined / null / empty)
    await expect(encryptSetting(keyName, secretValue, undefined)).rejects.toThrow(ConfigError);
    await expect(encryptSetting(keyName, secretValue, '')).rejects.toThrow(ConfigError);
    await expect(decryptSetting(keyName, 'AAAA', 'AAAA', undefined)).rejects.toThrow(ConfigError);

    // Short key (<32 characters)
    await expect(encryptSetting(keyName, secretValue, 'short-key-123')).rejects.toThrow(
      ConfigError,
    );
    await expect(decryptSetting(keyName, 'AAAA', 'AAAA', 'short-key-123')).rejects.toThrow(
      ConfigError,
    );
  });

  it('rotateAppSettings re-encrypts all secret rows with the new key', async () => {
    // Row encrypted with previous key
    const secret1 = 'secret-one-value-123';
    const enc1 = await encryptSetting('KEY_ONE', secret1, previousKey, 1);

    // Row encrypted with current key
    const secret2 = 'secret-two-value-456';
    const enc2 = await encryptSetting('KEY_TWO', secret2, masterKey, 1);

    interface SettingRow {
      key: string;
      ciphertext: string;
      iv: string;
      key_version: number;
      is_secret: number;
    }

    const dbRows: SettingRow[] = [
      {
        key: 'KEY_ONE',
        ciphertext: enc1.ciphertext,
        iv: enc1.iv,
        key_version: 1,
        is_secret: 1,
      },
      {
        key: 'KEY_TWO',
        ciphertext: enc2.ciphertext,
        iv: enc2.iv,
        key_version: 1,
        is_secret: 1,
      },
    ];

    const mockDb: D1LikeDatabase = {
      prepare(query: string) {
        return {
          bind(...args: unknown[]) {
            return {
              async run() {
                if (query.includes('UPDATE app_settings')) {
                  const [newCiphertext, newIv, newKeyVersion, , rowKey] = args as [
                    string,
                    string,
                    number,
                    string,
                    string,
                  ];
                  const row = dbRows.find((r) => r.key === rowKey);
                  if (row) {
                    row.ciphertext = newCiphertext;
                    row.iv = newIv;
                    row.key_version = newKeyVersion;
                  }
                }
                return { success: true };
              },
              async first<T = unknown>(): Promise<T | null> {
                return null;
              },
              async all<T = unknown>(): Promise<{ results: T[] }> {
                if (query.includes('FROM app_settings WHERE is_secret = 1')) {
                  return { results: dbRows as unknown as T[] };
                }
                return { results: [] };
              },
            };
          },
        };
      },
      async batch() {
        return [];
      },
    };

    const result = await rotateAppSettings(mockDb, masterKey, previousKey);
    expect(result.rotatedCount).toBe(2);
    expect(result.keys).toEqual(['KEY_ONE', 'KEY_TWO']);

    // Assert that row 1 was re-encrypted with masterKey and can now be decrypted without previousKey
    const row1 = dbRows.find((r) => r.key === 'KEY_ONE');
    expect(row1).toBeDefined();
    if (row1) {
      expect(row1.key_version).toBe(2);
      expect(row1.iv).not.toBe(enc1.iv); // fresh IV
      const decrypted1 = await decryptSetting('KEY_ONE', row1.ciphertext, row1.iv, masterKey);
      expect(decrypted1).toBe(secret1);
    }

    // Assert row 2 was also re-encrypted
    const row2 = dbRows.find((r) => r.key === 'KEY_TWO');
    expect(row2).toBeDefined();
    if (row2) {
      expect(row2.key_version).toBe(2);
      expect(row2.iv).not.toBe(enc2.iv); // fresh IV
      const decrypted2 = await decryptSetting('KEY_TWO', row2.ciphertext, row2.iv, masterKey);
      expect(decrypted2).toBe(secret2);
    }
  });
});
