#!/usr/bin/env node

/**
 * Feeds a raw .eml file to the local Pigeon Worker's email handler.
 * Usage: node scripts/feed-eml.mjs <path-to-.eml>
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const filePath = process.argv[2];

if (!filePath) {
  console.error('Usage: node scripts/feed-eml.mjs <path-to-.eml>');
  console.error(
    'Example: node scripts/feed-eml.mjs packages/shared/fixtures/alerts/linkedin-alert.eml',
  );
  process.exit(1);
}

const resolvedPath = path.resolve(process.cwd(), filePath);

if (!fs.existsSync(resolvedPath)) {
  console.error(`✖ File not found: ${resolvedPath}`);
  process.exit(1);
}

const rawEml = fs.readFileSync(resolvedPath, 'utf8');
const BASE_URL = process.env.PIGEON_WORKER_URL || 'http://127.0.0.1:8787';
const url = `${BASE_URL}/api/dev/feed-eml`;

console.log(
  `▶ Feeding ${path.basename(resolvedPath)} (${Buffer.byteLength(rawEml, 'utf8')} bytes) -> ${url}...`,
);

try {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'message/rfc822',
      Origin: 'http://localhost:5173',
    },
    body: rawEml,
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

  console.log(`✔ HTTP ${status} OK`);
  console.log(`  Portal detected: ${data.portal || 'unknown'}`);
  console.log(`  Jobs found in digest: ${data.jobsFound ?? 0}`);
  console.log(`  New jobs ingested into D1: ${data.newJobs ?? 0}`);
  console.log(`  Duplicates skipped: ${data.duplicates ?? 0}`);
  if (data.dropped) {
    console.warn(`  Alert email was dropped. Reason: ${data.dropReason}`);
  }
} catch (err) {
  if (err.cause?.code === 'ECONNREFUSED' || err.message?.includes('fetch failed')) {
    console.error(`✖ Connection failed: Worker is not reachable at ${BASE_URL}.`);
    console.error(`  Please make sure 'pnpm dev:local' or 'wrangler dev' is running.`);
  } else {
    console.error(`✖ Failed to feed .eml file:`, err.message || err);
  }
  process.exit(1);
}
