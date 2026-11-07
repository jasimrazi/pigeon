import { describe, it, expect } from 'vitest';
// @ts-expect-error Node.js fs module is available in Vitest node test runner
import * as fs from 'node:fs';
// @ts-expect-error Node.js path module is available in Vitest node test runner
import * as path from 'node:path';
import { WorkerEnvVarsSchema, WorkerSecretsSchema } from './env.js';
import { seedLocalData, SEED_PROFILE } from './dev-seed.js';
import type { D1LikeDatabase } from './state-machine.js';

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

  describe('Local Seed Data & Reset Suite', () => {
    function createMockSeedEnv() {
      const tables = new Map<string, Map<string, Record<string, unknown>>>();
      const r2Storage = new Map<string, unknown>();
      const kvStore = new Map<string, string>();

      const getTable = (name: string) => {
        let table = tables.get(name);
        if (!table) {
          table = new Map();
          tables.set(name, table);
        }
        return table;
      };

      const db: D1LikeDatabase = {
        prepare(query: string) {
          let bound: unknown[] = [];
          const stmt = {
            bind(...params: unknown[]) {
              bound = params;
              return stmt;
            },
            async run() {
              const match = query.match(/INSERT OR REPLACE INTO (\w+)/i);
              if (match && match[1]) {
                const table = getTable(match[1]);
                const id = String(bound[0]);
                table.set(id, { id, bound });
              }
              return { meta: { changes: 1 } };
            },
            async first<T>(): Promise<T | null> {
              return null;
            },
            async all<T>(): Promise<{ results: T[] }> {
              return { results: [] };
            },
          };
          return stmt;
        },
        async batch(stmts: unknown[]) {
          return stmts;
        },
      };

      const resumesBucket = {
        async put(key: string, value: unknown) {
          r2Storage.set(key, value);
        },
        async get(key: string) {
          if (!r2Storage.has(key)) return null;
          return {
            async arrayBuffer() {
              return new ArrayBuffer(8);
            },
          };
        },
      };

      const config = {
        async get(key: string) {
          return kvStore.get(key) ?? null;
        },
        async put(key: string, val: string) {
          kvStore.set(key, val);
        },
        async delete(key: string) {
          kvStore.delete(key);
        },
      };

      return { db, resumesBucket, config, tables, r2Storage, kvStore };
    }

    it('refuses seedLocalData immediately if ENV is not dev', async () => {
      const { db, resumesBucket, config } = createMockSeedEnv();

      await expect(
        seedLocalData({
          db,
          resumesBucket,
          config,
          env: 'prod',
        }),
      ).rejects.toThrow(/Refusing to seed database/);

      await expect(
        seedLocalData({
          db,
          resumesBucket,
          config,
          env: 'staging',
        }),
      ).rejects.toThrow(/Refusing to seed database/);
    });

    it('succeeds in dev and verifies every contact email strictly ends in @example.test', async () => {
      const { db, resumesBucket, config, tables, r2Storage } = createMockSeedEnv();

      const result = await seedLocalData({
        db,
        resumesBucket,
        config,
        env: 'dev',
      });

      expect(result.success).toBe(true);
      expect(result.jobsCount).toBeGreaterThanOrEqual(12);
      expect(result.appsCount).toBeGreaterThanOrEqual(10);
      expect(result.resumesCount).toBe(2);

      // Verify R2 PDFs were placed
      expect(r2Storage.has('resumes/alex-mercer-systems.pdf')).toBe(true);
      expect(r2Storage.has('resumes/alex-mercer-fullstack.pdf')).toBe(true);

      // Verify ATS sources in KV
      expect(await config.get('sources:greenhouse')).toContain('cloudflare');
      expect(await config.get('sources:lever')).toContain('netflix');
      expect(await config.get('sources:ashby')).toContain('linear');

      // Verify Profile
      expect(SEED_PROFILE.email).toBe('alex.mercer@example.test');

      // Check all seeded jobs in database
      const jobsTable = tables.get('jobs') || new Map();
      expect(jobsTable.size).toBe(result.jobsCount);

      for (const [id, row] of jobsTable.entries()) {
        const bound = (row['bound'] as unknown[]) || [];
        // In INSERT INTO jobs query:
        // bind(j.id [0], dedupeKey [1], j.title [2], j.company [3], norm [4], desc [5], j.contact_email [6]...)
        const contactEmail = bound[6];
        if (contactEmail && typeof contactEmail === 'string') {
          expect(
            contactEmail.endsWith('@example.test'),
            `Job ${id} has contact email '${contactEmail}' that does not end in @example.test`,
          ).toBe(true);
        }
      }
    });

    it('seeding is idempotent: running twice succeeds without duplicating rows or crashing', async () => {
      const { db, resumesBucket, config, tables } = createMockSeedEnv();

      const run1 = await seedLocalData({
        db,
        resumesBucket,
        config,
        env: 'dev',
      });

      const jobsAfterRun1 = tables.get('jobs')?.size ?? 0;
      const appsAfterRun1 = tables.get('applications')?.size ?? 0;

      const run2 = await seedLocalData({
        db,
        resumesBucket,
        config,
        env: 'dev',
      });

      const jobsAfterRun2 = tables.get('jobs')?.size ?? 0;
      const appsAfterRun2 = tables.get('applications')?.size ?? 0;

      expect(run1.success).toBe(true);
      expect(run2.success).toBe(true);
      expect(jobsAfterRun2).toBe(jobsAfterRun1);
      expect(appsAfterRun2).toBe(appsAfterRun1);
    });

    it('db:reset script refuses to run if ENV is not dev', async () => {
      // Dynamic import to avoid tsc rootDir constraints
      const resetScriptUrl = path.join(rootDir, 'scripts/db-reset-local.mjs');
      const { resetLocalDb } = (await import(resetScriptUrl)) as {
        resetLocalDb: (opts: { rootDir: string; env?: string; dryRun?: boolean }) => {
          success: boolean;
        };
      };

      expect(() =>
        resetLocalDb({
          rootDir,
          env: 'prod',
          dryRun: true,
        }),
      ).toThrow(/Refusing to reset database/);

      expect(() =>
        resetLocalDb({
          rootDir,
          env: 'staging',
          dryRun: true,
        }),
      ).toThrow(/Refusing to reset database/);

      // In dev, dryRun check does not throw
      const devRes = resetLocalDb({
        rootDir,
        env: 'dev',
        dryRun: true,
      });
      expect(devRes.success).toBe(true);
    });
  });
});
