#!/usr/bin/env node
/**
 * Configuration validator for Pigeon deployment.
 * Validates bootstrap values and reports UI-managed items as "configure in Settings > Integrations".
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const devVarsPath = path.resolve(rootDir, 'apps/worker/.dev.vars');

function parseDotEnv(content) {
  const result = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }
  return result;
}

function loadEnv() {
  const env = { ...process.env };
  if (fs.existsSync(devVarsPath)) {
    try {
      const parsed = parseDotEnv(fs.readFileSync(devVarsPath, 'utf8'));
      for (const [k, v] of Object.entries(parsed)) {
        if (!env[k]) env[k] = v;
      }
    } catch {
      // Ignore read errors
    }
  }
  return env;
}

export function validateConfig(env = loadEnv()) {
  const errors = [];
  const warnings = [];
  const uiManaged = [
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_SHEET_ID',
    'SHEET_TAB_APPLICATIONS',
    'SHEET_TAB_METRICS',
    'LLM_PROVIDER',
    'LLM_MODEL',
    'GEMINI_API_KEY',
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_CHAT_ID',
    'USER_AGENT_CONTACT_EMAIL',
    'TIMEZONE',
    'ALERT_FORWARDING_ADDRESS',
  ];

  console.log('\n--- Pigeon Deployment Configuration Check ---\n');

  // 1. Target Environment
  const targetEnv = env.ENV || 'dev';
  console.log(`[bootstrap] Target Environment: ${targetEnv}`);
  if (!['dev', 'staging', 'prod'].includes(targetEnv)) {
    errors.push(`Invalid ENV: "${targetEnv}". Must be 'dev', 'staging', or 'prod'.`);
  }

  // 2. Master Encryption Key
  const masterKey = env.SETTINGS_ENCRYPTION_KEY || env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (!masterKey) {
    errors.push('Missing master encryption key: SETTINGS_ENCRYPTION_KEY must be configured.');
  } else {
    try {
      const buf = Buffer.from(masterKey, 'base64');
      if (buf.length >= 32 || masterKey.length >= 32) {
        console.log('[bootstrap] Master Encryption Key: configured (>= 32 bytes)');
      } else {
        errors.push('SETTINGS_ENCRYPTION_KEY is too short (minimum 32 bytes required).');
      }
    } catch {
      if (masterKey.length >= 32) {
        console.log('[bootstrap] Master Encryption Key: configured');
      } else {
        errors.push('SETTINGS_ENCRYPTION_KEY is invalid or shorter than 32 characters.');
      }
    }
  }

  // 3. Owner Gmail
  if (!env.OWNER_GMAIL || !env.OWNER_GMAIL.includes('@')) {
    errors.push('Missing or invalid OWNER_GMAIL bootstrap email.');
  } else {
    console.log(`[bootstrap] Owner Gmail: ${env.OWNER_GMAIL}`);
  }

  // 4. Cloudflare Access (Required for staging and prod)
  if (targetEnv === 'staging' || targetEnv === 'prod') {
    if (!env.CF_ACCESS_AUD) {
      errors.push('CF_ACCESS_AUD is required in staging and prod to secure the API.');
    } else {
      console.log('[bootstrap] Cloudflare Access AUD: configured');
    }

    if (!env.CF_ACCESS_TEAM_DOMAIN) {
      errors.push('CF_ACCESS_TEAM_DOMAIN is required in staging and prod.');
    } else {
      console.log(`[bootstrap] Cloudflare Access Team Domain: ${env.CF_ACCESS_TEAM_DOMAIN}`);
    }

    if (!env.CF_ACCESS_ALLOWED_EMAIL) {
      warnings.push('CF_ACCESS_ALLOWED_EMAIL not set; will fall back to OWNER_GMAIL.');
    }
  } else {
    console.log(
      '[bootstrap] Local Dev Auth: ALLOW_INSECURE_DEV_AUTH=' +
        (env.ALLOW_INSECURE_DEV_AUTH || 'true'),
    );
  }

  // 5. Report UI-Managed Settings
  console.log('\n--- UI-Managed Settings (Non-blocking) ---\n');
  for (const item of uiManaged) {
    if (env[item]) {
      console.log(
        `  [info] ${item}: configured via env fallback -> configure in Settings > Integrations`,
      );
    } else {
      console.log(`  [info] ${item}: unset -> configure in Settings > Integrations`);
    }
  }

  console.log('\n------------------------------------------');

  if (warnings.length > 0) {
    console.log('\nWarnings:');
    for (const w of warnings) console.log(`  ! ${w}`);
  }

  if (errors.length > 0) {
    console.error('\nConfiguration Errors:');
    for (const err of errors) console.error(`  x ${err}`);
    console.error('\nBootstrap validation failed. Please fix the above errors.\n');
    return false;
  }

  console.log('\n[ok] All bootstrap requirements are satisfied.\n');
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const ok = validateConfig();
  process.exit(ok ? 0 : 1);
}
