#!/usr/bin/env node
/**
 * Synchronizes package versions and generates packages/shared/src/version.ts
 * with semantic version, git commit count (build counter), and short commit SHA.
 *
 * Usage:
 *   node scripts/sync-version.mjs
 *   node scripts/sync-version.mjs --bump patch|minor|major
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

const packagePaths = [
  resolve(rootDir, 'package.json'),
  resolve(rootDir, 'packages/shared/package.json'),
  resolve(rootDir, 'apps/worker/package.json'),
  resolve(rootDir, 'apps/dashboard/package.json'),
];

function bumpSemver(version, kind) {
  const parts = version.split('.').map((n) => Number.parseInt(n, 10));
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    throw new Error(`Invalid semver: ${version}`);
  }
  const [major, minor, patch] = parts;
  if (kind === 'major') return `${major + 1}.0.0`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  if (kind === 'patch') return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Unknown bump kind: ${kind}`);
}

const args = process.argv.slice(2);
const bumpIdx = args.indexOf('--bump');
const bumpKind = bumpIdx !== -1 ? args[bumpIdx + 1] || 'patch' : null;

const rootPkg = JSON.parse(readFileSync(packagePaths[0], 'utf8'));
let nextVersion = rootPkg.version || '0.2.0';
if (bumpKind) {
  nextVersion = bumpSemver(nextVersion, bumpKind);
}

for (const pkgPath of packagePaths) {
  const raw = JSON.parse(readFileSync(pkgPath, 'utf8'));
  raw.version = nextVersion;
  writeFileSync(pkgPath, JSON.stringify(raw, null, 2) + '\n', 'utf8');
}

let buildNumber = 1;
let gitCommit = 'dev';
try {
  const countStr = execSync('git rev-list --count HEAD', { cwd: rootDir, encoding: 'utf8' }).trim();
  const parsed = Number.parseInt(countStr, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    buildNumber = parsed;
  }
  gitCommit = execSync('git rev-parse --short HEAD', { cwd: rootDir, encoding: 'utf8' }).trim() || 'dev';
} catch {
  // Keep fallback when git metadata is unavailable
}

const versionTs = `export interface AppVersionInfo {
  version: string;
  build: number;
  commit: string;
  label: string;
}

export const APP_VERSION = '${nextVersion}';
export const BUILD_NUMBER = ${buildNumber};
export const GIT_COMMIT = '${gitCommit}';

export function getAppVersionInfo(): AppVersionInfo {
  return {
    version: APP_VERSION,
    build: BUILD_NUMBER,
    commit: GIT_COMMIT,
    label: \`v\${APP_VERSION} #\${BUILD_NUMBER} (\${GIT_COMMIT})\`,
  };
}
`;

writeFileSync(resolve(rootDir, 'packages/shared/src/version.ts'), versionTs, 'utf8');
console.log(`Synced Pigeon version: v${nextVersion} #${buildNumber} (${gitCommit})`);
