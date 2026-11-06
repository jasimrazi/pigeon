import { describe, it, expect, vi } from 'vitest';
import {
  checkCircuit,
  recordRunFailure,
  recordRunSuccess,
  fetchWithRetry,
  calculateCooldownMs,
  BASE_COOLDOWN_MS,
} from './circuit-breaker.js';
import type { D1LikeDatabase } from '../state-machine.js';

function createMockSourceStateDb() {
  const sourceStateMap = new Map<
    string,
    {
      circuit_state: 'closed' | 'open' | 'half_open';
      consecutive_failures: number;
      opened_at: string | null;
      last_run_at: string | null;
      last_success_at: string | null;
      last_error: string | null;
    }
  >();

  const events: Array<{ type: string; payload: string }> = [];

  const mockDb: D1LikeDatabase = {
    prepare(query: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first<T = unknown>(): Promise<T | null> {
              if (query.includes('FROM source_state WHERE source = ?')) {
                const source = values[0] as string;
                const state = sourceStateMap.get(source);
                if (!state) return null;
                return { ...state } as unknown as T;
              }
              return null;
            },
            async run() {
              if (query.includes('INSERT INTO source_state')) {
                const [source, failures, state, openedAt, lastRunAt] = values as [
                  string,
                  number,
                  'closed' | 'open' | 'half_open',
                  string | null,
                  string | null,
                ];
                sourceStateMap.set(source, {
                  circuit_state: state,
                  consecutive_failures: failures,
                  opened_at: openedAt,
                  last_run_at: lastRunAt,
                  last_success_at: null,
                  last_error: null,
                });
              } else if (
                query.includes(
                  'UPDATE source_state SET consecutive_failures = 0, last_run_at = ?, last_success_at = ?',
                )
              ) {
                const [lastRunAt, lastSuccessAt, source] = values as [string, string, string];
                const existing = sourceStateMap.get(source) || {
                  circuit_state: 'closed',
                  consecutive_failures: 0,
                  opened_at: null,
                  last_run_at: null,
                  last_success_at: null,
                  last_error: null,
                };
                sourceStateMap.set(source, {
                  ...existing,
                  consecutive_failures: 0,
                  last_run_at: lastRunAt,
                  last_success_at: lastSuccessAt,
                  last_error: null,
                });
              }
              return {};
            },
            async all<T = unknown>() {
              return { results: [] as T[] };
            },
          };
        },
      };
    },
    async batch(statements: unknown[]) {
      // Execute simulated updates in batch
      for (const stmt of statements as Array<{
        execute?: () => Promise<void>;
      }>) {
        if (stmt && typeof stmt.execute === 'function') {
          await stmt.execute();
        }
      }
      return statements;
    },
  };

  return { mockDb, sourceStateMap, events };
}

describe('Circuit Breaker', () => {
  describe('Cooldown Calculation', () => {
    it('calculates base 6h and doubles on subsequent trial failures up to 48h', () => {
      // 5 failures -> 6h
      expect(calculateCooldownMs(5)).toBe(6 * 3600 * 1000);
      // 6 failures (first trial failure) -> 12h
      expect(calculateCooldownMs(6)).toBe(12 * 3600 * 1000);
      // 7 failures (second trial failure) -> 24h
      expect(calculateCooldownMs(7)).toBe(24 * 3600 * 1000);
      // 8 failures (third trial failure) -> 48h
      expect(calculateCooldownMs(8)).toBe(48 * 3600 * 1000);
      // 9 failures -> capped at 48h
      expect(calculateCooldownMs(9)).toBe(48 * 3600 * 1000);
    });
  });

  describe('Breaker State Lifecycle', () => {
    it('opens after 5 failures, stays closed-skipped during cooldown, allows half-open trial, and closes on trial success', async () => {
      const { mockDb, sourceStateMap } = createMockSourceStateDb();
      const source = 'test_source';
      const baseTime = 1730000000000;

      // 1. Initially closed
      const initial = await checkCircuit(source, mockDb, baseTime);
      expect(initial.canRun).toBe(true);
      expect(initial.state).toBe('closed');

      // 2. Record 4 failures -> breaker still closed
      for (let i = 1; i <= 4; i++) {
        sourceStateMap.set(source, {
          circuit_state: 'closed',
          consecutive_failures: i - 1,
          opened_at: null,
          last_run_at: new Date(baseTime).toISOString(),
          last_success_at: null,
          last_error: null,
        });

        await recordRunFailure(
          source,
          mockDb,
          new Error(`Failure ${i}`),
          false,
          new Date(baseTime).toISOString(),
        );
      }

      // 3. 5th failure -> trips circuit to open
      sourceStateMap.set(source, {
        circuit_state: 'closed',
        consecutive_failures: 4,
        opened_at: null,
        last_run_at: new Date(baseTime).toISOString(),
        last_success_at: null,
        last_error: null,
      });

      await recordRunFailure(
        source,
        mockDb,
        new Error('Failure 5'),
        false,
        new Date(baseTime).toISOString(),
      );

      // Verify opened
      sourceStateMap.set(source, {
        circuit_state: 'open',
        consecutive_failures: 5,
        opened_at: new Date(baseTime).toISOString(),
        last_run_at: new Date(baseTime).toISOString(),
        last_success_at: null,
        last_error: 'Failure 5',
      });

      // 4. During cool-down (e.g. 2 hours later): circuit stays closed-skipped
      const checkDuringCooldown = await checkCircuit(source, mockDb, baseTime + 2 * 3600 * 1000);
      expect(checkDuringCooldown.canRun).toBe(false);
      expect(checkDuringCooldown.state).toBe('open');
      expect(checkDuringCooldown.reason).toContain('cooldown active');

      // 5. After cool-down (6 hours + 1 minute): enters half_open trial
      const checkAfterCooldown = await checkCircuit(
        source,
        mockDb,
        baseTime + BASE_COOLDOWN_MS + 60000,
      );
      expect(checkAfterCooldown.canRun).toBe(true);
      expect(checkAfterCooldown.state).toBe('half_open');
      expect(checkAfterCooldown.isHalfOpenTrial).toBe(true);

      // 6. Trial success closes the circuit
      sourceStateMap.set(source, {
        circuit_state: 'half_open',
        consecutive_failures: 5,
        opened_at: new Date(baseTime).toISOString(),
        last_run_at: new Date(baseTime).toISOString(),
        last_success_at: null,
        last_error: null,
      });

      await recordRunSuccess(
        source,
        mockDb,
        true,
        new Date(baseTime + BASE_COOLDOWN_MS + 60000).toISOString(),
      );

      // Simulated closing state
      sourceStateMap.set(source, {
        circuit_state: 'closed',
        consecutive_failures: 0,
        opened_at: null,
        last_run_at: new Date(baseTime + BASE_COOLDOWN_MS + 60000).toISOString(),
        last_success_at: new Date(baseTime + BASE_COOLDOWN_MS + 60000).toISOString(),
        last_error: null,
      });

      const checkClosed = await checkCircuit(source, mockDb, baseTime + BASE_COOLDOWN_MS + 120000);
      expect(checkClosed.canRun).toBe(true);
      expect(checkClosed.state).toBe('closed');
      expect(checkClosed.isHalfOpenTrial).toBe(false);
    });

    it('circuit breaker recovery test: source circuit opens on consecutive failures and recovers on flakiness in the same test run', async () => {
      const { mockDb, sourceStateMap } = createMockSourceStateDb();
      const source = 'flaky_api_service';
      let currentTime = 1731000000000;

      // 1. Initial check: circuit is closed, can run
      const initial = await checkCircuit(source, mockDb, currentTime);
      expect(initial.canRun).toBe(true);
      expect(initial.state).toBe('closed');

      // 2. Simulate 5 consecutive flakiness failures (HTTP 500 / Network timeout)
      for (let i = 1; i <= 5; i++) {
        currentTime += 60000; // 1 min apart
        const isTrippingFailure = i === 5;
        await recordRunFailure(
          source,
          mockDb,
          new Error(`Flaky gateway timeout attempt ${i}`),
          isTrippingFailure,
          new Date(currentTime).toISOString(),
        );

        // Update map state reflecting database write
        sourceStateMap.set(source, {
          circuit_state: i >= 5 ? 'open' : 'closed',
          consecutive_failures: i,
          opened_at: i >= 5 ? new Date(currentTime).toISOString() : null,
          last_run_at: new Date(currentTime).toISOString(),
          last_success_at: null,
          last_error: `Flaky gateway timeout attempt ${i}`,
        });
      }

      // 3. Immediately after 5th failure: circuit is open, requests are blocked
      const blockedCheck = await checkCircuit(source, mockDb, currentTime + 5000);
      expect(blockedCheck.canRun).toBe(false);
      expect(blockedCheck.state).toBe('open');

      // 4. Advance time past cooldown period (BASE_COOLDOWN_MS = 6 hours)
      currentTime += BASE_COOLDOWN_MS + 10000;

      // 5. Next check enters half_open trial
      const halfOpenCheck = await checkCircuit(source, mockDb, currentTime);
      expect(halfOpenCheck.canRun).toBe(true);
      expect(halfOpenCheck.state).toBe('half_open');
      expect(halfOpenCheck.isHalfOpenTrial).toBe(true);

      // 6. Upstream flakiness resolves! Trial run succeeds
      sourceStateMap.set(source, {
        circuit_state: 'half_open',
        consecutive_failures: 5,
        opened_at: new Date(currentTime - BASE_COOLDOWN_MS).toISOString(),
        last_run_at: new Date(currentTime).toISOString(),
        last_success_at: null,
        last_error: null,
      });

      await recordRunSuccess(source, mockDb, true, new Date(currentTime).toISOString());

      // Update map state to closed
      sourceStateMap.set(source, {
        circuit_state: 'closed',
        consecutive_failures: 0,
        opened_at: null,
        last_run_at: new Date(currentTime).toISOString(),
        last_success_at: new Date(currentTime).toISOString(),
        last_error: null,
      });

      // 7. Verify fully recovered: circuit is closed, subsequent runs proceed normally
      const recoveredCheck = await checkCircuit(source, mockDb, currentTime + 60000);
      expect(recoveredCheck.canRun).toBe(true);
      expect(recoveredCheck.state).toBe('closed');
      expect(recoveredCheck.isHalfOpenTrial).toBe(false);
    });

    it('reopens with doubled cooldown on trial failure', async () => {
      const { mockDb, sourceStateMap } = createMockSourceStateDb();
      const source = 'trial_fail_source';
      const baseTime = 1730000000000;

      // Currently in half_open trial
      sourceStateMap.set(source, {
        circuit_state: 'half_open',
        consecutive_failures: 5,
        opened_at: new Date(baseTime).toISOString(),
        last_run_at: new Date(baseTime).toISOString(),
        last_success_at: null,
        last_error: null,
      });

      // Trial failure
      await recordRunFailure(
        source,
        mockDb,
        new Error('Trial attempt timed out'),
        true,
        new Date(baseTime).toISOString(),
      );

      // Simulate reopen state with 6 failures
      sourceStateMap.set(source, {
        circuit_state: 'open',
        consecutive_failures: 6,
        opened_at: new Date(baseTime).toISOString(),
        last_run_at: new Date(baseTime).toISOString(),
        last_success_at: null,
        last_error: 'Trial attempt timed out',
      });

      // At 8 hours (which is past 6h but within 12h doubled cooldown): still open
      const check8h = await checkCircuit(source, mockDb, baseTime + 8 * 3600 * 1000);
      expect(check8h.canRun).toBe(false);
      expect(check8h.state).toBe('open');

      // At 12 hours + 1 min: elapsed doubled cooldown, enters half_open again
      const check12h = await checkCircuit(source, mockDb, baseTime + 12 * 3600 * 1000 + 60000);
      expect(check12h.canRun).toBe(true);
      expect(check12h.state).toBe('half_open');
    });
  });

  describe('fetchWithRetry & 429 Retry-After', () => {
    it('honours 429 Retry-After header and succeeds on next attempt', async () => {
      let attempts = 0;
      const delaySpy = vi.fn().mockResolvedValue(undefined);

      const mockFetch: typeof fetch = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts === 1) {
          return new Response('Rate limited', {
            status: 429,
            headers: {
              'Retry-After': '2',
            },
          });
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const res = await fetchWithRetry('https://api.example.com/jobs', undefined, {
        maxAttempts: 3,
        fetchFn: mockFetch,
        delayFn: delaySpy,
      });

      expect(res.status).toBe(200);
      expect(attempts).toBe(2);
      expect(delaySpy).toHaveBeenCalledWith(2000); // 2 seconds * 1000 ms
    });

    it('throws error after repeated failures exceed maxAttempts', async () => {
      const mockFetch: typeof fetch = vi.fn().mockImplementation(async () => {
        return new Response('Internal Server Error', { status: 500 });
      });

      await expect(
        fetchWithRetry('https://api.example.com/jobs', undefined, {
          maxAttempts: 3,
          fetchFn: mockFetch,
          delayFn: vi.fn().mockResolvedValue(undefined),
        }),
      ).rejects.toThrow('HTTP 500 from https://api.example.com/jobs');
    });
  });
});
