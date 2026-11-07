#!/usr/bin/env node

/**
 * Resets local SQLite database by deleting .wrangler/state and re-applying migrations.
 * Usage: node scripts/db-reset-local.mjs
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

export function getLocalEnvMode(rootDir = process.cwd()) {
  if (process.env.ENV) return process.env.ENV;

  const devVarsPath = path.resolve(rootDir, 'apps/worker/.dev.vars');
  if (fs.existsSync(devVarsPath)) {
    const content = fs.readFileSync(devVarsPath, 'utf8');
    const match = content.match(/^ENV\s*=\s*["']?([a-zA-Z0-9_-]+)["']?/m);
    if (match && match[1]) return match[1];
  }
  return 'dev';
}

export function resetLocalDb(options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const envMode = options.env || getLocalEnvMode(rootDir);

  if (envMode !== 'dev') {
    throw new Error(
      `Refusing to reset database: ENV is '${envMode}', but reset is permitted ONLY when ENV='dev'.`,
    );
  }

  const targetDirs = [
    path.resolve(rootDir, 'apps/worker/.wrangler/state'),
    path.resolve(rootDir, '.wrangler/state'),
  ];

  const removed = [];

  for (const dir of targetDirs) {
    if (fs.existsSync(dir)) {
      if (!options.dryRun) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
      removed.push(dir);
    }
  }

  if (options.dryRun) {
    return { success: true, removed, appliedMigrations: false };
  }

  // Re-apply D1 migrations locally
  console.log('Applying D1 migrations to local database...');
  const workerDir = path.resolve(rootDir, 'apps/worker');
  execSync('npx wrangler d1 migrations apply pigeon-db --local', {
    cwd: workerDir,
    stdio: 'inherit',
  });

  return { success: true, removed, appliedMigrations: true };
}

// Direct CLI execution
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  try {
    const envMode = getLocalEnvMode();
    console.log(`▶ Initiating local database reset (ENV=${envMode})...`);
    const res = resetLocalDb({ env: envMode });

    console.log(`✔ Local database reset completed:`);
    if (res.removed.length > 0) {
      console.log(`  Removed state directories:`);
      for (const r of res.removed) {
        console.log(`    - ${r}`);
      }
    } else {
      console.log(`  No existing .wrangler/state directories were found.`);
    }
    console.log(`  Local D1 migrations re-applied successfully.`);
  } catch (err) {
    console.error(`✖ ${err.message || err}`);
    process.exit(1);
  }
}
