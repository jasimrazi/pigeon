#!/usr/bin/env node

/**
 * Re-encrypts all secret rows in app_settings with the active master encryption key.
 * Supports reading the current key from SETTINGS_ENCRYPTION_KEY or GOOGLE_TOKEN_ENCRYPTION_KEY,
 * and optional previous key from PREVIOUS_SETTINGS_ENCRYPTION_KEY.
 *
 * Usage: pnpm settings:rotate [--local]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { rotateAppSettings } from '../packages/shared/src/settings-crypto.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load environment from apps/worker/.dev.vars if present
const devVarsPath = path.join(rootDir, 'apps/worker/.dev.vars');
let devVars = {};
if (fs.existsSync(devVarsPath)) {
  const content = fs.readFileSync(devVarsPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Z0-9_]+)\s*=\s*"?([^"]*)"?$/);
    if (match && match[1]) {
      devVars[match[1]] = match[2];
    }
  }
}

const currentKey =
  process.env.SETTINGS_ENCRYPTION_KEY ||
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY ||
  devVars.SETTINGS_ENCRYPTION_KEY ||
  devVars.GOOGLE_TOKEN_ENCRYPTION_KEY;

const prevKey =
  process.env.PREVIOUS_SETTINGS_ENCRYPTION_KEY || devVars.PREVIOUS_SETTINGS_ENCRYPTION_KEY;

if (!currentKey || currentKey.length < 32) {
  console.error(
    '✖ Error: Missing or invalid master encryption key (must be at least 32 characters). Set SETTINGS_ENCRYPTION_KEY.',
  );
  process.exit(1);
}

const isLocal = process.argv.includes('--local') || process.env.ENV === 'dev' || !process.env.ENV;

console.log(`▶ Starting settings rotation (${isLocal ? 'local D1' : 'remote D1'})...`);

// Query app_settings rows via wrangler d1 execute
const d1Flag = isLocal ? '--local' : '--remote';
try {
  const fetchCmd = `npx wrangler d1 execute pigeon-db ${d1Flag} --json --command "SELECT key, ciphertext, iv, key_version FROM app_settings WHERE is_secret = 1"`;
  const rawOutput = execSync(fetchCmd, {
    cwd: path.join(rootDir, 'apps/worker'),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const parsed = JSON.parse(rawOutput);
  const rows = (parsed[0] && parsed[0].results) || [];

  if (rows.length === 0) {
    console.log('✔ No secret settings found in app_settings table. Nothing to rotate.');
    process.exit(0);
  }

  console.log(`Found ${rows.length} secret setting(s) to re-encrypt...`);

  // Mock DB adaptor that translates rotateAppSettings operations to wrangler d1 commands
  const mockDb = {
    prepare(_query) {
      return {
        bind(...args) {
          return {
            async run() {
              const [newCiphertext, newIv, newKeyVersion, , rowKey] = args;
              const updateSql = `UPDATE app_settings SET ciphertext = '${newCiphertext}', iv = '${newIv}', key_version = ${newKeyVersion}, updated_at = '${new Date().toISOString()}', updated_by = 'rotation' WHERE key = '${rowKey}'`;
              execSync(
                `npx wrangler d1 execute pigeon-db ${d1Flag} --command "${updateSql.replace(/"/g, '\\"')}"`,
                {
                  cwd: path.join(rootDir, 'apps/worker'),
                  stdio: ['pipe', 'pipe', 'pipe'],
                },
              );
              return { success: true };
            },
          };
        },
        async all() {
          return { results: rows };
        },
      };
    },
  };

  const result = await rotateAppSettings(mockDb, currentKey, prevKey);
  console.log(
    `✔ Successfully rotated ${result.rotatedCount} secret setting(s): [${result.keys.join(', ')}]`,
  );
} catch (err) {
  console.error('✖ Rotation failed:', err.message || err);
  process.exit(1);
}
