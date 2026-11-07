import { describe, it, expect, vi } from 'vitest';
// @ts-expect-error Node fs import in shared package
import fs from 'node:fs';
// @ts-expect-error Node path import in shared package
import path from 'node:path';
import {
  APPLICATION_STATUSES,
  APPLICATION_TRANSITIONS,
  JOB_STATUSES,
  JOB_TRANSITIONS,
  IllegalTransitionError,
  canTransition,
  validateTransition,
  transition,
  type D1LikeDatabase,
  type ApplicationStatus,
  type JobStatus,
} from './state-machine.js';

describe('State Machine - Application Transition Matrix', () => {
  // Independent literal declaration of the 27 expected transitions
  const EXPECTED_APPLICATION_TRANSITIONS: Record<ApplicationStatus, readonly ApplicationStatus[]> =
    {
      draft: ['approved', 'needs_review', 'skipped'],
      needs_review: ['draft', 'approved', 'manual_applied', 'manual_skipped'],
      approved: ['sending', 'draft'],
      sending: ['sent', 'failed', 'approved'],
      failed: ['approved', 'skipped'],
      sent: ['bounced', 'replied'],
      replied: ['interview', 'rejected', 'offer'],
      interview: ['offer', 'rejected'],
      manual_pending: ['manual_applied', 'manual_skipped'],
      manual_applied: ['replied', 'interview', 'rejected', 'offer'],
      skipped: [],
      bounced: [],
      rejected: [],
      offer: [],
      manual_skipped: [],
    };

  const allStatuses = APPLICATION_STATUSES;

  it('declares exactly 27 allowed application transitions in the expected literal', () => {
    const totalAllowed = Object.values(EXPECTED_APPLICATION_TRANSITIONS).reduce(
      (sum, targets) => sum + targets.length,
      0,
    );
    expect(totalAllowed).toBe(27);
  });

  it('APPLICATION_TRANSITIONS matches the independently declared literal exactly', () => {
    expect(APPLICATION_TRANSITIONS).toEqual(EXPECTED_APPLICATION_TRANSITIONS);
  });

  it('validates every pair in the 15x15 matrix against the independent literal (27 allowed, 198 forbidden)', () => {
    let allowedCount = 0;
    let forbiddenCount = 0;

    for (const from of allStatuses) {
      const allowedTargets = EXPECTED_APPLICATION_TRANSITIONS[from];
      for (const to of allStatuses) {
        const isAllowed = allowedTargets.includes(to);

        if (isAllowed) {
          allowedCount++;
          expect(canTransition('application', from, to)).toBe(true);
          const reason = from === 'sending' && to === 'approved' ? 'retry' : undefined;
          expect(() =>
            validateTransition('application', from, to, 'app_test', reason),
          ).not.toThrow();
        } else {
          forbiddenCount++;
          expect(canTransition('application', from, to)).toBe(false);
          expect(() => validateTransition('application', from, to, 'app_test')).toThrowError(
            IllegalTransitionError,
          );
        }
      }
    }

    // Check totals: 27 allowed transitions + 198 forbidden = 225 total
    expect(allowedCount).toBe(27);
    expect(forbiddenCount).toBe(198);
    expect(allowedCount + forbiddenCount).toBe(225);
  });

  it('sending -> approved requires reason retry or auth_pause', () => {
    expect(() =>
      validateTransition('application', 'sending', 'approved', 'app_1', 'retry'),
    ).not.toThrow();
    expect(() =>
      validateTransition('application', 'sending', 'approved', 'app_1', 'auth_pause'),
    ).not.toThrow();
    expect(() => validateTransition('application', 'sending', 'approved', 'app_1')).toThrowError(
      IllegalTransitionError,
    );
    expect(() =>
      validateTransition('application', 'sending', 'approved', 'app_1', 'invalid_reason'),
    ).toThrowError(IllegalTransitionError);
  });
});

describe('State Machine - Job Transition Matrix', () => {
  // Independent literal declaration of the 10 expected job transitions
  const EXPECTED_JOB_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
    new: ['filtered_out', 'scored', 'skipped'],
    scored: ['routed', 'skipped', 'filtered_out'],
    routed: ['skipped'],
    filtered_out: ['new', 'skipped'],
    skipped: ['new'],
  };

  const allJobStatuses = JOB_STATUSES;

  it('declares exactly 10 allowed job transitions in the expected literal (filtered_out -> scored removed)', () => {
    const totalAllowed = Object.values(EXPECTED_JOB_TRANSITIONS).reduce(
      (sum, targets) => sum + targets.length,
      0,
    );
    expect(totalAllowed).toBe(10);
  });

  it('JOB_TRANSITIONS matches the independently declared literal exactly', () => {
    expect(JOB_TRANSITIONS).toEqual(EXPECTED_JOB_TRANSITIONS);
  });

  it('validates every pair in the 5x5 matrix against the independent literal (10 allowed, 15 forbidden)', () => {
    let allowedCount = 0;
    let forbiddenCount = 0;

    for (const from of allJobStatuses) {
      const allowedTargets = EXPECTED_JOB_TRANSITIONS[from];
      for (const to of allJobStatuses) {
        const isAllowed = allowedTargets.includes(to);

        if (isAllowed) {
          allowedCount++;
          expect(canTransition('job', from, to)).toBe(true);
          expect(() => validateTransition('job', from, to, 'job_test')).not.toThrow();
        } else {
          forbiddenCount++;
          expect(canTransition('job', from, to)).toBe(false);
          expect(() => validateTransition('job', from, to, 'job_test')).toThrowError(
            IllegalTransitionError,
          );
        }
      }
    }

    expect(allowedCount).toBe(10);
    expect(forbiddenCount).toBe(15);
    expect(allowedCount + forbiddenCount).toBe(25);
  });

  it('explicitly forbids filtered_out -> scored to prevent skipping rule filters', () => {
    expect(canTransition('job', 'filtered_out', 'scored')).toBe(false);
    expect(() => validateTransition('job', 'filtered_out', 'scored', 'job_f')).toThrowError(
      IllegalTransitionError,
    );
  });

  it('validates allowed job transitions: new -> scored, new -> filtered_out, scored -> routed', () => {
    expect(canTransition('job', 'new', 'scored')).toBe(true);
    expect(canTransition('job', 'new', 'filtered_out')).toBe(true);
    expect(canTransition('job', 'scored', 'routed')).toBe(true);
    expect(canTransition('job', 'routed', 'new')).toBe(false);
    expect(() => validateTransition('job', 'routed', 'new')).toThrowError(IllegalTransitionError);
  });
});

describe('State Machine - transition() execution', () => {
  function createMockDb(initialStatus: string | null) {
    const currentStatus = initialStatus;
    const executedStatements: { sql: string; values: unknown[] }[] = [];

    const mockDb: D1LikeDatabase = {
      prepare(query: string) {
        return {
          bind(...values: unknown[]) {
            return {
              async first<T = unknown>(): Promise<T | null> {
                executedStatements.push({ sql: query, values });
                if (currentStatus === null) return null;
                return { status: currentStatus } as unknown as T;
              },
              async run() {
                executedStatements.push({ sql: query, values });
                return {};
              },
              async all<T = unknown>() {
                executedStatements.push({ sql: query, values });
                return { results: [] as T[] };
              },
            };
          },
        };
      },
      async batch(statements: unknown[]) {
        // In real D1, statements are processed in order
        return statements;
      },
    };

    return { mockDb, executedStatements };
  }

  it('succeeds for an allowed transition and writes exactly one event', async () => {
    const { mockDb } = createMockDb('draft');
    const batchSpy = vi.spyOn(mockDb, 'batch');

    const result = await transition(mockDb, 'application', 'app_123', 'approved', 'looks good');

    expect(result.id).toBe('app_123');
    expect(result.from).toBe('draft');
    expect(result.to).toBe('approved');
    expect(result.reason).toBe('looks good');
    expect(result.event_id).toBeDefined();

    // Verify batch was called with exactly 2 statements: 1 update, 1 event insert
    expect(batchSpy).toHaveBeenCalledTimes(1);
    const statements = batchSpy.mock.calls[0]?.[0];
    expect(Array.isArray(statements)).toBe(true);
    expect(statements).toHaveLength(2);
  });

  it('works with signature transition(entity, id, to, reason, db)', async () => {
    const { mockDb } = createMockDb('needs_review');
    const batchSpy = vi.spyOn(mockDb, 'batch');

    const result = await transition(
      'application',
      'app_456',
      'manual_applied',
      'applied on greenhouse',
      mockDb,
    );

    expect(result.id).toBe('app_456');
    expect(result.from).toBe('needs_review');
    expect(result.to).toBe('manual_applied');
    expect(batchSpy).toHaveBeenCalledTimes(1);
  });

  it('throws IllegalTransitionError on invalid transition without updating DB or writing event', async () => {
    const { mockDb } = createMockDb('sent');
    const batchSpy = vi.spyOn(mockDb, 'batch');

    await expect(
      transition(mockDb, 'application', 'app_123', 'draft', 'should fail'),
    ).rejects.toThrowError(IllegalTransitionError);

    expect(batchSpy).not.toHaveBeenCalled();
  });

  it('throws error if entity is not found in database', async () => {
    const { mockDb } = createMockDb(null);

    await expect(transition(mockDb, 'application', 'app_missing', 'approved')).rejects.toThrow(
      "application with id 'app_missing' not found",
    );
  });
});

describe('State Machine - Static Enforcement against Status Bypass', () => {
  function scanDirForStatusUpdates(dir: string): string[] {
    const violations: string[] = [];
    if (!fs.existsSync(dir)) return violations;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        violations.push(...scanDirForStatusUpdates(fullPath));
      } else if (
        entry.isFile() &&
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.test.ts') &&
        !entry.name.endsWith('.spec.ts') &&
        !entry.name.endsWith('state-machine.ts')
      ) {
        const content = String(fs.readFileSync(fullPath, 'utf8'));

        // Check 1: Multi-line SQL UPDATE ... SET ... status for applications or jobs
        const sqlRegex =
          /\bUPDATE\s+(?:jobs|applications)\b(?:(?!WHERE)[\s\S])*?\bSET\b(?:(?!WHERE)[\s\S])*?\bstatus\s*=/gi;
        let match;
        while ((match = sqlRegex.exec(content)) !== null) {
          const upToMatch = content.slice(0, match.index);
          const lineNum = upToMatch.split('\n').length;
          violations.push(
            `${fullPath}:${lineNum} -> Direct SQL status update: ${match[0].replace(/\s+/g, ' ')}`,
          );
        }

        // Check 2: Drizzle ORM .update(jobs|applications).set({ status })
        const drizzleRegex =
          /\.update\s*\(\s*(?:jobs|applications)\s*\)[\s\S]*?\.set\s*\(\s*\{[\s\S]*?\bstatus\b/gi;
        while ((match = drizzleRegex.exec(content)) !== null) {
          const upToMatch = content.slice(0, match.index);
          const lineNum = upToMatch.split('\n').length;
          violations.push(
            `${fullPath}:${lineNum} -> Drizzle .update().set({ status }): ${match[0].replace(/\s+/g, ' ')}`,
          );
        }
      }
    }
    return violations;
  }

  it('no SQL UPDATE or Drizzle .update() sets status on jobs or applications outside state-machine.ts', () => {
    const proc = (globalThis as unknown as { process?: { cwd?: () => string } }).process;
    const rootDir = proc?.cwd ? proc.cwd() : '.';
    const workerSrc = path.join(rootDir, 'apps/worker/src');
    const sharedSrc = path.join(rootDir, 'packages/shared/src');

    const violations = [
      ...scanDirForStatusUpdates(workerSrc),
      ...scanDirForStatusUpdates(sharedSrc),
    ];

    expect(
      violations,
      `Found status bypasses outside state-machine.ts:\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('verifies that the status bypass detector catches direct SQL and Drizzle updates', () => {
    const testCases = [
      "UPDATE jobs SET status = 'filtered_out', filter_reason = 'X'",
      "UPDATE jobs\n SET\n apply_route = 'manual',\n status = 'routed'\n WHERE id = '1'",
      "UPDATE applications SET status = 'sent', updated_at = 'now' WHERE id = '2'",
      "await db.update(jobs).set({ status: 'scored', updated_at: now })",
      "await db.update(applications).set({\n  status: 'approved'\n})",
    ];

    const sqlRegex =
      /\bUPDATE\s+(?:jobs|applications)\b(?:(?!WHERE)[\s\S])*?\bSET\b(?:(?!WHERE)[\s\S])*?\bstatus\s*=/i;
    const drizzleRegex =
      /\.update\s*\(\s*(?:jobs|applications)\s*\)[\s\S]*?\.set\s*\(\s*\{[\s\S]*?\bstatus\b/i;

    for (const testCase of testCases) {
      const caught = sqlRegex.test(testCase) || drizzleRegex.test(testCase);
      expect(caught, `Failed to catch status bypass in: ${testCase}`).toBe(true);
    }
  });
});
