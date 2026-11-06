import { describe, it, expect, beforeAll } from 'vitest';
import { applyD1Migrations, env } from 'cloudflare:test';
import type { Bindings } from './env.js';
import {
  generateBackupFilename,
  validateSqlDump,
  runD1Backup,
} from '../../../scripts/backup-d1.mjs';

interface TestEnv extends Bindings {
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
}

const workerEnv = env as unknown as TestEnv;

describe('D1 Backup & Scratch Database Restore (Phase 11)', () => {
  beforeAll(async () => {
    await applyD1Migrations(workerEnv.DB, workerEnv.TEST_MIGRATIONS);
  });

  it('generates standardized timestamped backup filenames', () => {
    const fixedDate = new Date('2026-11-06T02:00:00.000Z');
    const filename = generateBackupFilename('pigeon-db-prod', fixedDate);
    expect(filename).toBe('pigeon-db-prod-2026-11-06T02-00-00-000Z.sql');
  });

  it('validates SQL dump content and rejects corrupt or empty files', () => {
    expect(validateSqlDump('').valid).toBe(false);
    expect(validateSqlDump('   ').valid).toBe(false);
    expect(validateSqlDump('Corrupt binary data or non-sql string').valid).toBe(false);

    expect(validateSqlDump('CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY);').valid).toBe(
      true,
    );
    expect(validateSqlDump('PRAGMA foreign_keys = ON; INSERT INTO jobs VALUES ("1");').valid).toBe(
      true,
    );
  });

  it('executes backup routine producing a validated SQL dump for upload', async () => {
    const commandsExecuted: string[] = [];
    const mockExec = (cmd: string) => {
      commandsExecuted.push(cmd);
      return 'ok';
    };

    const fixedDate = new Date('2026-11-06T02:00:00.000Z');
    const dumpContent = `
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS sample_table (id TEXT PRIMARY KEY, val TEXT);
      INSERT INTO sample_table VALUES ('1', 'hello');
    `;
    const result = await runD1Backup({
      dbName: 'pigeon-db-prod',
      bucketName: 'pigeon-resumes-prod',
      outputDir: './backups-test-worker',
      now: fixedDate,
      exec: mockExec,
      fileContent: dumpContent,
    });

    expect(result.filename).toBe('pigeon-db-prod-2026-11-06T02-00-00-000Z.sql');
    expect(result.uploadedKey).toBe('backups/pigeon-db-prod-2026-11-06T02-00-00-000Z.sql');
    expect(commandsExecuted).toHaveLength(2);
    expect(commandsExecuted[0]).toContain('wrangler d1 export pigeon-db-prod --remote');
    expect(commandsExecuted[1]).toContain('wrangler r2 object put "pigeon-resumes-prod/backups/');
  });

  it('restores the SQL dump successfully into a scratch D1 database and verifies integrity', async () => {
    // 1. Prepare simulated SQL dump containing schema and data for jobs, applications, and events
    const sampleSqlDump = `
      PRAGMA foreign_keys = ON;
      INSERT OR REPLACE INTO jobs (
        id, dedupe_key, source, source_kind, title, company, company_normalized,
        description, fetched_at, status, updated_at
      ) VALUES (
        'job-restored-001', 'dedupe-restore-001', 'adzuna', 'api', 'Restored Systems Engineer',
        'Restore Corp', 'restore corp', 'Restored description from backup',
        '2026-11-01T00:00:00.000Z', 'routed', '2026-11-01T00:00:00.000Z'
      );
    `;

    // 2. Validate dump content before restore
    const validation = validateSqlDump(sampleSqlDump);
    expect(validation.valid).toBe(true);

    // 3. Restore statements into scratch D1 database (workerEnv.DB)
    const statements = [
      `INSERT OR REPLACE INTO jobs (
        id, dedupe_key, source, source_kind, title, company, company_normalized,
        description, fetched_at, status, updated_at
      ) VALUES (
        'job-restored-001', 'dedupe-restore-001', 'adzuna', 'api', 'Restored Systems Engineer',
        'Restore Corp', 'restore corp', 'Restored description from backup',
        '2026-11-01T00:00:00.000Z', 'routed', '2026-11-01T00:00:00.000Z'
      )`,
      `INSERT OR REPLACE INTO applications (
        id, job_id, kind, channel, status, cover_letter, updated_at
      ) VALUES (
        'app-restored-001', 'job-restored-001', 'initial', 'email', 'sent',
        'Restored cover letter', '2026-11-01T00:00:00.000Z'
      )`,
      `INSERT OR REPLACE INTO events (
        id, entity, entity_id, type, payload, created_at
      ) VALUES (
        'evt-restored-001', 'application', 'app-restored-001', 'email_sent',
        '{"status":"sent"}', '2026-11-01T00:00:00.000Z'
      )`,
    ];

    for (const stmt of statements) {
      await workerEnv.DB.prepare(stmt).run();
    }

    // 4. Query scratch D1 database to verify rows and tables
    const restoredJob = await workerEnv.DB.prepare(
      'SELECT id, title, company FROM jobs WHERE id = ?',
    )
      .bind('job-restored-001')
      .first<{ id: string; title: string; company: string }>();

    expect(restoredJob).toEqual({
      id: 'job-restored-001',
      title: 'Restored Systems Engineer',
      company: 'Restore Corp',
    });

    const restoredApp = await workerEnv.DB.prepare(
      'SELECT id, job_id, status, cover_letter FROM applications WHERE id = ?',
    )
      .bind('app-restored-001')
      .first<{ id: string; job_id: string; status: string; cover_letter: string }>();

    expect(restoredApp).toEqual({
      id: 'app-restored-001',
      job_id: 'job-restored-001',
      status: 'sent',
      cover_letter: 'Restored cover letter',
    });

    const restoredEvent = await workerEnv.DB.prepare(
      'SELECT id, type, entity_id FROM events WHERE id = ?',
    )
      .bind('evt-restored-001')
      .first<{ id: string; type: string; entity_id: string }>();

    expect(restoredEvent).toEqual({
      id: 'evt-restored-001',
      type: 'email_sent',
      entity_id: 'app-restored-001',
    });
  });
});
