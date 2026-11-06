import { describe, it, expect, beforeEach } from 'vitest';
import type { D1LikeDatabase } from '../state-machine.js';
import {
  purgeExpiredJobDescriptions,
  PURGED_DESCRIPTION_PLACEHOLDER,
} from './retention.js';

class MockD1PreparedStatement {
  private query: string;
  private params: unknown[] = [];
  private db: MockD1Database;

  constructor(query: string, db: MockD1Database) {
    this.query = query;
    this.db = db;
  }

  bind(...params: unknown[]): MockD1PreparedStatement {
    this.params = params;
    return this;
  }

  async run(): Promise<{ meta: { changes: number } }> {
    return this.db.executeRun(this.query, this.params);
  }

  async first<T = unknown>(): Promise<T | null> {
    const rows = await this.db.executeQuery(this.query, this.params);
    return (rows[0] as T) || null;
  }

  async all<T = unknown>(): Promise<{ results: T[] }> {
    const results = (await this.db.executeQuery(this.query, this.params)) as T[];
    return { results };
  }
}

class MockD1Database {
  public jobs: Array<{
    id: string;
    title: string;
    company: string;
    description: string;
    fetched_at: string;
    updated_at: string;
  }> = [];

  public applications: Array<{
    id: string;
    job_id: string;
    status: string;
    cover_letter: string;
  }> = [];

  public events: Array<{
    id: string;
    entity: string;
    entity_id: string;
    type: string;
    payload: string;
    created_at: string;
  }> = [];

  prepare(query: string): MockD1PreparedStatement {
    return new MockD1PreparedStatement(query, this);
  }

  async executeRun(query: string, params: unknown[]): Promise<{ meta: { changes: number } }> {
    if (query.includes('UPDATE jobs')) {
      const newDesc = String(params[0]);
      const nowIso = String(params[1]);
      const cutoffIso = String(params[2]);
      const placeholder = String(params[3]);

      const appliedJobIds = new Set(this.applications.map((a) => a.job_id));
      let changes = 0;

      for (const job of this.jobs) {
        if (
          job.fetched_at < cutoffIso &&
          !appliedJobIds.has(job.id) &&
          job.description !== placeholder
        ) {
          job.description = newDesc;
          job.updated_at = nowIso;
          changes++;
        }
      }
      return { meta: { changes } };
    }

    if (query.includes('INSERT INTO events')) {
      const [id, payload, created_at] = params as [string, string, string];
      this.events.push({
        id,
        entity: 'retention',
        entity_id: 'jobs',
        type: 'retention_purged',
        payload,
        created_at,
      });
      return { meta: { changes: 1 } };
    }

    return { meta: { changes: 0 } };
  }

  async executeQuery(query: string, _params: unknown[]): Promise<unknown[]> {
    if (query.includes('FROM jobs')) {
      return this.jobs;
    }
    if (query.includes('FROM applications')) {
      return this.applications;
    }
    if (query.includes('FROM events')) {
      return this.events;
    }
    return [];
  }
}

describe('Retention Policy: Job Description Purge', () => {
  let db: MockD1Database;
  const now = new Date('2026-11-06T12:00:00.000Z');

  beforeEach(() => {
    db = new MockD1Database();

    // 100 days old, unapplied
    db.jobs.push({
      id: 'job-old-unapplied',
      title: 'Old Unapplied Dev',
      company: 'Ancient Corp',
      description: 'Detailed job requirements for 100-day old job',
      fetched_at: new Date('2026-07-20T12:00:00.000Z').toISOString(),
      updated_at: new Date('2026-07-20T12:00:00.000Z').toISOString(),
    });

    // 95 days old, applied to
    db.jobs.push({
      id: 'job-old-applied',
      title: 'Old Applied Architect',
      company: 'Tech Corp',
      description: 'Preserved requirements for old applied job',
      fetched_at: new Date('2026-07-25T12:00:00.000Z').toISOString(),
      updated_at: new Date('2026-07-25T12:00:00.000Z').toISOString(),
    });
    db.applications.push({
      id: 'app-old-applied',
      job_id: 'job-old-applied',
      status: 'sent',
      cover_letter: 'Dear Tech Corp, here is my cover letter.',
    });

    // 30 days old, unapplied
    db.jobs.push({
      id: 'job-recent-unapplied',
      title: 'Recent Job',
      company: 'Fresh Corp',
      description: 'Recent requirements',
      fetched_at: new Date('2026-10-07T12:00:00.000Z').toISOString(),
      updated_at: new Date('2026-10-07T12:00:00.000Z').toISOString(),
    });

    // 10 days old, applied
    db.jobs.push({
      id: 'job-recent-applied',
      title: 'Active Job',
      company: 'Modern Corp',
      description: 'Active requirements',
      fetched_at: new Date('2026-10-27T12:00:00.000Z').toISOString(),
      updated_at: new Date('2026-10-27T12:00:00.000Z').toISOString(),
    });
    db.applications.push({
      id: 'app-recent-applied',
      job_id: 'job-recent-applied',
      status: 'approved',
      cover_letter: 'Dear Modern Corp, here is my application.',
    });
  });

  it('deletes only expired descriptions of unapplied jobs (>90 days old) and keeps applied ones', async () => {
    const result = await purgeExpiredJobDescriptions({
      db: db as unknown as D1LikeDatabase,
      cutoffDays: 90,
      now,
    });

    expect(result.purgedCount).toBe(1);

    // Old unapplied job description must be purged
    const oldUnapplied = db.jobs.find((j) => j.id === 'job-old-unapplied');
    expect(oldUnapplied?.description).toBe(PURGED_DESCRIPTION_PLACEHOLDER);
    expect(oldUnapplied?.updated_at).toBe(now.toISOString());

    // Old APPLIED job description must be preserved!
    const oldApplied = db.jobs.find((j) => j.id === 'job-old-applied');
    expect(oldApplied?.description).toBe('Preserved requirements for old applied job');

    // Recent jobs must be untouched
    const recentUnapplied = db.jobs.find((j) => j.id === 'job-recent-unapplied');
    expect(recentUnapplied?.description).toBe('Recent requirements');

    const recentApplied = db.jobs.find((j) => j.id === 'job-recent-applied');
    expect(recentApplied?.description).toBe('Active requirements');

    // Application records, cover letters, and notes must remain intact
    const appOld = db.applications.find((a) => a.id === 'app-old-applied');
    expect(appOld?.cover_letter).toBe('Dear Tech Corp, here is my cover letter.');

    // Event must be logged
    expect(db.events).toHaveLength(1);
    expect(db.events[0]?.type).toBe('retention_purged');
    const payload = JSON.parse(db.events[0]?.payload || '{}');
    expect(payload.purged_count).toBe(1);
    expect(payload.cutoff_days).toBe(90);
  });

  it('is idempotent when run multiple times consecutively', async () => {
    const firstRun = await purgeExpiredJobDescriptions({
      db: db as unknown as D1LikeDatabase,
      cutoffDays: 90,
      now,
    });
    expect(firstRun.purgedCount).toBe(1);

    const secondRun = await purgeExpiredJobDescriptions({
      db: db as unknown as D1LikeDatabase,
      cutoffDays: 90,
      now,
    });
    expect(secondRun.purgedCount).toBe(0);
    // No new events added
    expect(db.events).toHaveLength(1);
  });
});
