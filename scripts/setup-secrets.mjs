#!/usr/bin/env node
/**
 * Interactive Bootstrap Secrets Setup for Pigeon
 * Generates 32-byte master encryption key and sets bootstrap secrets via wrangler secret put
 * without echoing sensitive inputs.
 */

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const workerDir = path.resolve(rootDir, 'apps/worker');
const devVarsPath = path.resolve(workerDir, '.dev.vars');

function getArg(name, def = null) {
  const idx = process.argv.indexOf(name);
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return def;
}

const envName = getArg('--env', 'prod');
const isDryRun = process.argv.includes('--dry-run');

function promptHidden(query) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const stdin = process.stdin;
    process.stdout.write(query);

    // Mute input echo
    const onData = (char) => {
      char = char.toString();
      switch (char) {
        case '\n':
        case '\r':
        case '\u0004':
          break;
        default:
          // Mask character
          process.stdout.write('*');
          break;
      }
    };

    if (stdin.isTTY) {
      stdin.on('data', onData);
    }

    rl.question('', (answer) => {
      if (stdin.isTTY) {
        stdin.removeListener('data', onData);
      }
      process.stdout.write('\n');
      rl.close();
      resolve(answer.trim());
    });
  });
}

function promptVisible(query, defaultValue = '') {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const promptText = defaultValue ? `${query} [${defaultValue}]: ` : `${query}: `;
    rl.question(promptText, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue);
    });
  });
}

async function putSecretWrangler(key, value, env) {
  if (isDryRun) {
    console.log(`[dry-run] Would execute: wrangler secret put ${key} --env ${env}`);
    return;
  }

  return new Promise((resolve, reject) => {
    console.log(`Setting Cloudflare secret: ${key}...`);
    const args = ['wrangler', 'secret', 'put', key];
    if (env && env !== 'dev') {
      args.push('--env', env);
    }

    const child = spawn('npx', args, {
      cwd: workerDir,
      stdio: ['pipe', 'inherit', 'inherit'],
      shell: process.platform === 'win32',
    });

    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) {
        console.log(`  [ok] ${key} saved successfully.`);
        resolve();
      } else {
        reject(new Error(`wrangler secret put exited with code ${code}`));
      }
    });

    child.stdin.write(value + '\n');
    child.stdin.end();
  });
}

function updateDevVars(secrets) {
  let content = '';
  if (fs.existsSync(devVarsPath)) {
    content = fs.readFileSync(devVarsPath, 'utf8');
  }

  for (const [k, v] of Object.entries(secrets)) {
    const pattern = new RegExp(`^${k}=.*$`, 'm');
    const line = `${k}="${v}"`;
    if (pattern.test(content)) {
      content = content.replace(pattern, line);
    } else {
      content += `\n${line}`;
    }
  }

  fs.writeFileSync(devVarsPath, content.trim() + '\n', 'utf8');
  console.log(`[ok] Updated local development secrets in ${path.relative(rootDir, devVarsPath)}`);
}

async function run() {
  console.log(`\n=== Pigeon Bootstrap Secrets Setup (Environment: ${envName}) ===\n`);

  // 1. Generate master encryption key (32 bytes base64)
  const masterKey = crypto.randomBytes(32).toString('base64');
  console.log('Generated cryptographically secure 32-byte master encryption key:');
  console.log(`  SETTINGS_ENCRYPTION_KEY: ${masterKey}\n`);

  // 2. Prompt for Owner Gmail
  let ownerGmail = process.env.OWNER_GMAIL || '';
  if (!ownerGmail) {
    ownerGmail = await promptVisible('Enter your Google Account email (OWNER_GMAIL)');
  }
  if (!ownerGmail || !ownerGmail.includes('@')) {
    console.error('[error] A valid OWNER_GMAIL address is required.');
    process.exit(1);
  }

  // 3. Prompt for Admin Password
  let adminPassword = process.env.ADMIN_PASSWORD || '';
  if (!adminPassword) {
    if (envName === 'dev') {
      const generated = crypto.randomBytes(16).toString('hex');
      adminPassword = await promptVisible(
        'Enter ADMIN_PASSWORD (or press Enter to use generated password)',
        generated,
      );
    } else {
      adminPassword = await promptHidden(
        'Enter ADMIN_PASSWORD (minimum 8 characters for dashboard login)',
      );
    }
  }

  const secrets = {
    SETTINGS_ENCRYPTION_KEY: masterKey,
    OWNER_GMAIL: ownerGmail,
    ADMIN_PASSWORD: adminPassword,
  };

  if (envName === 'dev') {
    updateDevVars(secrets);
  } else {
    for (const [key, value] of Object.entries(secrets)) {
      await putSecretWrangler(key, value, envName);
    }
  }

  console.log('\n=== Bootstrap Secrets Setup Complete ===');
  console.log('Summary:');
  console.log('  - Master encryption key generated and stored.');
  console.log(`  - Owner Gmail configured: ${ownerGmail}`);
  console.log('  - Admin password configured for dashboard access.');
  console.log('\nRun `pnpm check:config` to verify readiness.\n');
}

run().catch((err) => {
  console.error('[error] Setup failed:', err);
  process.exit(1);
});
