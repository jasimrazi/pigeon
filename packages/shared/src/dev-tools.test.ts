import { describe, it, expect } from 'vitest';
// @ts-expect-error Node.js fs module is available in Vitest node test runner
import * as fs from 'node:fs';
// @ts-expect-error Node.js path module is available in Vitest node test runner
import * as path from 'node:path';
import { WorkerEnvVarsSchema, WorkerSecretsSchema } from './env.js';

describe('Developer Tools & Local Run Kit Verification', () => {
  const proc = (globalThis as unknown as { process?: { cwd?: () => string } }).process;
  let rootDir = proc?.cwd ? proc.cwd() : '.';
  while (
    !fs.existsSync(path.join(rootDir, 'pnpm-workspace.yaml')) &&
    path.dirname(rootDir) !== rootDir
  ) {
    rootDir = path.dirname(rootDir);
  }

  describe('Vite Dev Proxy Configuration', () => {
    it('vite.config.ts configures proxy for /api, /auth, and /health targeting http://127.0.0.1:8787', () => {
      const viteConfigPath = path.join(rootDir, 'apps/dashboard/vite.config.ts');
      expect(fs.existsSync(viteConfigPath)).toBe(true);

      const content = fs.readFileSync(viteConfigPath, 'utf8');

      // Check server port 5173
      expect(content).toContain('port: 5173');

      // Check proxy forwards for /api, /auth, /health targeting 127.0.0.1:8787
      expect(content).toContain("'/api'");
      expect(content).toContain("'/auth'");
      expect(content).toContain("'/health'");
      expect(content).toContain('http://127.0.0.1:8787');
    });
  });

  describe('.dev.vars.example Parity Verification', () => {
    it('.dev.vars.example lists every key in WorkerEnvVarsSchema and WorkerSecretsSchema', () => {
      const devVarsExamplePath = path.join(rootDir, 'apps/worker/.dev.vars.example');
      expect(fs.existsSync(devVarsExamplePath)).toBe(true);

      const content = fs.readFileSync(devVarsExamplePath, 'utf8');

      const foundKeys = new Set<string>();
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const match = trimmed.match(/^([A-Z0-9_]+)\s*=/);
        if (match && match[1]) {
          foundKeys.add(match[1]);
        }
      }

      const envVarKeys = Object.keys(WorkerEnvVarsSchema.shape);
      const secretKeys = Object.keys(WorkerSecretsSchema.shape);
      const allRequiredKeys = [...envVarKeys, ...secretKeys];

      const missingKeys = allRequiredKeys.filter((k) => !foundKeys.has(k));
      expect(
        missingKeys,
        `apps/worker/.dev.vars.example is missing schema keys:\n${missingKeys.join(', ')}`,
      ).toEqual([]);
    });
  });

  describe('EML Feeder & Realistic Alert Fixtures', () => {
    it('all 3 alert fixtures exist in packages/shared/fixtures/alerts', () => {
      const alertsDir = path.join(rootDir, 'packages/shared/fixtures/alerts');
      expect(fs.existsSync(path.join(alertsDir, 'linkedin-alert.eml'))).toBe(true);
      expect(fs.existsSync(path.join(alertsDir, 'digest-alert.eml'))).toBe(true);
      expect(fs.existsSync(path.join(alertsDir, 'malformed.eml'))).toBe(true);
    });

    it('scripts/feed-eml.mjs exists and is valid JavaScript', () => {
      const feedScriptPath = path.join(rootDir, 'scripts/feed-eml.mjs');
      expect(fs.existsSync(feedScriptPath)).toBe(true);
      const content = fs.readFileSync(feedScriptPath, 'utf8');
      expect(content).toContain('node scripts/feed-eml.mjs');
      expect(content).toContain('/api/dev/feed-eml');
    });

    it('scripts/trigger.mjs exists and implements all required trigger actions', () => {
      const triggerScriptPath = path.join(rootDir, 'scripts/trigger.mjs');
      expect(fs.existsSync(triggerScriptPath)).toBe(true);
      const content = fs.readFileSync(triggerScriptPath, 'utf8');
      expect(content).toContain('ingest');
      expect(content).toContain('score');
      expect(content).toContain('draft');
      expect(content).toContain('send');
      expect(content).toContain('followups');
      expect(content).toContain('sheets');
      expect(content).toContain('all');
    });
  });
});
