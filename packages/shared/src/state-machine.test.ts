import { describe, it, expect, vi } from 'vitest';
import {
  APPLICATION_STATUSES,
  APPLICATION_TRANSITIONS,
  IllegalTransitionError,
  canTransition,
  validateTransition,
  transition,
  type D1LikeDatabase,
} from './state-machine.js';

describe('State Machine - Application Transition Matrix', () => {
  // Generate the full 15x15 = 225 pairs matrix
  const allStatuses = APPLICATION_STATUSES;

  it('validates every pair in the 15x15 matrix correctly', () => {
    let allowedCount = 0;
    let forbiddenCount = 0;

    for (const from of allStatuses) {
      const allowedTargets = APPLICATION_TRANSITIONS[from];
      for (const to of allStatuses) {
        const isAllowed = allowedTargets.includes(to);

        if (isAllowed) {
          allowedCount++;
          expect(canTransition('application', from, to)).toBe(true);
          expect(() => validateTransition('application', from, to)).not.toThrow();
        } else {
          forbiddenCount++;
          expect(canTransition('application', from, to)).toBe(false);
          expect(() => validateTransition('application', from, to, 'app_test')).toThrowError(
            IllegalTransitionError,
          );
        }
      }
    }

    // Check totals: 26 allowed transitions + 199 forbidden = 225 total
    expect(allowedCount).toBe(26);
    expect(forbiddenCount).toBe(199);
    expect(allowedCount + forbiddenCount).toBe(225);
  });

  it('validates allowed job transitions', () => {
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
