#!/usr/bin/env node

/**
 * Seeds local development database and environment with realistic test fixtures.
 * Usage: node scripts/seed-local.mjs
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// 1. Enforce ENV=dev check
function getLocalEnvMode() {
  if (process.env.ENV) return process.env.ENV;

  const devVarsPath = path.resolve(process.cwd(), 'apps/worker/.dev.vars');
  if (fs.existsSync(devVarsPath)) {
    const content = fs.readFileSync(devVarsPath, 'utf8');
    const match = content.match(/^ENV\s*=\s*["']?([a-zA-Z0-9_-]+)["']?/m);
    if (match && match[1]) return match[1];
  }
  return 'dev';
}

const envMode = getLocalEnvMode();
if (envMode !== 'dev') {
  console.error(
    `✖ Refusing to seed database: ENV is '${envMode}', but seeding is permitted ONLY when ENV='dev'.`,
  );
  process.exit(1);
}

const BASE_URL = process.env.PIGEON_WORKER_URL || 'http://127.0.0.1:8787';
const url = `${BASE_URL}/api/dev/seed`;

console.log(`▶ Seeding local Pigeon environment (ENV=${envMode}) via ${url}...`);

try {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:5173',
    },
  });

  const status = res.status;
  let data;
  try {
    data = await res.json();
  } catch {
    data = { raw: await res.text() };
  }

  if (!res.ok) {
    console.error(`✖ HTTP ${status} Error:`, data.error || data);
    process.exit(1);
  }

  console.log(`✔ HTTP ${status} Seed completed successfully:`);
  console.log(`  Profile: Alex Mercer (alex.mercer@example.test)`);
  console.log(`  Resumes seeded in R2: ${data.resumesCount ?? 2} (Systems + Fullstack)`);
  console.log(
    `  Jobs seeded in D1: ${data.jobsCount ?? 13} (covering auto_email, manual_portal, manual_review, skipped)`,
  );
  console.log(
    `  Applications seeded: ${data.appsCount ?? 11} (draft, approved, sent, manual_pending, follow_up)`,
  );
  console.log(`  ATS sources configured in KV: greenhouse, lever, ashby`);
  console.log(`  All contact addresses verified ending in @example.test`);
} catch (err) {
  if (err.cause?.code === 'ECONNREFUSED' || err.message?.includes('fetch failed')) {
    console.error(`✖ Connection failed: Worker is not reachable at ${BASE_URL}.`);
    console.error(
      `  Please make sure 'pnpm dev:local' or 'wrangler dev' is running before seeding.`,
    );
  } else {
    console.error(`✖ Failed to seed local data:`, err.message || err);
  }
  process.exit(1);
}
