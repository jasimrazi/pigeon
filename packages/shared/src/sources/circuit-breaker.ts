import type { D1LikeDatabase } from '../state-machine.js';

export interface CircuitCheckResult {
  canRun: boolean;
  state: 'closed' | 'open' | 'half_open';
  isHalfOpenTrial: boolean;
  reason?: string;
}

export const BASE_COOLDOWN_MS = 6 * 3600 * 1000; // 6 hours
export const MAX_COOLDOWN_MS = 48 * 3600 * 1000; // 48 hours

/**
 * Calculates dynamic cool-down duration in ms.
 * Base 6 hours, doubles on each subsequent trial failure, max 48 hours.
 */
export function calculateCooldownMs(consecutiveFailures: number): number {
  const reopenCount = Math.max(0, consecutiveFailures - 5);
  return Math.min(MAX_COOLDOWN_MS, BASE_COOLDOWN_MS * Math.pow(2, reopenCount));
}

/**
 * Checks if a source can execute based on its circuit breaker state.
 * Transitions to half_open if the cool-down period has expired.
 */
export async function checkCircuit(
  source: string,
  db: D1LikeDatabase,
  currentTimeMs: number = Date.now(),
): Promise<CircuitCheckResult> {
  const row = await db
    .prepare(
      `SELECT circuit_state, consecutive_failures, opened_at FROM source_state WHERE source = ?`,
    )
    .bind(source)
    .first<{
      circuit_state: 'closed' | 'open' | 'half_open';
      consecutive_failures: number;
      opened_at: string | null;
    }>();

  if (!row) {
    // Initialize record
    const nowIso = new Date(currentTimeMs).toISOString();
    await db
      .prepare(
        `INSERT INTO source_state (source, consecutive_failures, circuit_state, opened_at, last_run_at) VALUES (?, 0, 'closed', NULL, ?)`,
      )
      .bind(source, nowIso)
      .run();
    return { canRun: true, state: 'closed', isHalfOpenTrial: false };
  }

  if (row.circuit_state === 'closed') {
    return { canRun: true, state: 'closed', isHalfOpenTrial: false };
  }

  if (row.circuit_state === 'half_open') {
    return { canRun: true, state: 'half_open', isHalfOpenTrial: true };
  }

  // State is 'open' -> check cool-down expiration
  const openedAtMs = row.opened_at ? new Date(row.opened_at).getTime() : 0;
  const cooldownMs = calculateCooldownMs(row.consecutive_failures);
  const elapsed = currentTimeMs - openedAtMs;

  if (elapsed < cooldownMs) {
    return {
      canRun: false,
      state: 'open',
      isHalfOpenTrial: false,
      reason: `Circuit open (cooldown active: ${Math.round((cooldownMs - elapsed) / 60000)}m remaining)`,
    };
  }

  // Cool-down elapsed: enter half_open trial run
  const nowIso = new Date(currentTimeMs).toISOString();
  await db.batch([
    db.prepare(`UPDATE source_state SET circuit_state = 'half_open' WHERE source = ?`).bind(source),
    db
      .prepare(
        `INSERT INTO events (id, entity, entity_id, type, payload, created_at) VALUES (?, 'source', ?, 'circuit_half_open', ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        source,
        JSON.stringify({ source, previousFailures: row.consecutive_failures }),
        nowIso,
      ),
  ]);

  return { canRun: true, state: 'half_open', isHalfOpenTrial: true };
}

/**
 * Records a successful run for a source.
 * If the run was a half_open trial, closes the circuit.
 */
export async function recordRunSuccess(
  source: string,
  db: D1LikeDatabase,
  wasHalfOpen: boolean,
  nowIso: string = new Date().toISOString(),
): Promise<void> {
  if (wasHalfOpen) {
    await db.batch([
      db
        .prepare(
          `UPDATE source_state SET circuit_state = 'closed', consecutive_failures = 0, opened_at = NULL, last_run_at = ?, last_success_at = ?, last_error = NULL WHERE source = ?`,
        )
        .bind(nowIso, nowIso, source),
      db
        .prepare(
          `INSERT INTO events (id, entity, entity_id, type, payload, created_at) VALUES (?, 'source', ?, 'circuit_closed', ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          source,
          JSON.stringify({ source, reason: 'trial_succeeded' }),
          nowIso,
        ),
    ]);
  } else {
    await db
      .prepare(
        `UPDATE source_state SET consecutive_failures = 0, last_run_at = ?, last_success_at = ?, last_error = NULL WHERE source = ?`,
      )
      .bind(nowIso, nowIso, source)
      .run();
  }
}

/**
 * Records a failed run for a source.
 * Trips the circuit open on 5 consecutive failures or reopens on trial failure with doubled cool-down.
 */
export async function recordRunFailure(
  source: string,
  db: D1LikeDatabase,
  error: Error,
  wasHalfOpen: boolean,
  nowIso: string = new Date().toISOString(),
): Promise<void> {
  const row = await db
    .prepare(`SELECT consecutive_failures, circuit_state FROM source_state WHERE source = ?`)
    .bind(source)
    .first<{ consecutive_failures: number; circuit_state: string }>();

  const failures = (row?.consecutive_failures ?? 0) + 1;

  if (wasHalfOpen) {
    // Trial failed -> reopen with doubled cooldown
    const cooldownMs = calculateCooldownMs(failures);
    const cooldownHours = cooldownMs / (3600 * 1000);

    await db.batch([
      db
        .prepare(
          `UPDATE source_state SET circuit_state = 'open', opened_at = ?, consecutive_failures = ?, last_run_at = ?, last_error = ? WHERE source = ?`,
        )
        .bind(nowIso, failures, nowIso, error.message, source),
      db
        .prepare(
          `INSERT INTO events (id, entity, entity_id, type, payload, created_at) VALUES (?, 'source', ?, 'circuit_reopened', ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          source,
          JSON.stringify({
            source,
            failures,
            cooldown_hours: cooldownHours,
            error: error.message,
          }),
          nowIso,
        ),
    ]);
  } else if (failures >= 5) {
    // 5 consecutive failures -> trip open for 6 hours
    await db.batch([
      db
        .prepare(
          `UPDATE source_state SET circuit_state = 'open', opened_at = ?, consecutive_failures = ?, last_run_at = ?, last_error = ? WHERE source = ?`,
        )
        .bind(nowIso, failures, nowIso, error.message, source),
      db
        .prepare(
          `INSERT INTO events (id, entity, entity_id, type, payload, created_at) VALUES (?, 'source', ?, 'circuit_opened', ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          source,
          JSON.stringify({
            source,
            failures,
            cooldown_hours: 6,
            error: error.message,
          }),
          nowIso,
        ),
    ]);
  } else {
    // Increment failures
    await db.batch([
      db
        .prepare(
          `UPDATE source_state SET consecutive_failures = ?, last_run_at = ?, last_error = ? WHERE source = ?`,
        )
        .bind(failures, nowIso, error.message, source),
      db
        .prepare(
          `INSERT INTO events (id, entity, entity_id, type, payload, created_at) VALUES (?, 'source', ?, 'source_failure', ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          source,
          JSON.stringify({
            source,
            failures,
            error: error.message,
          }),
          nowIso,
        ),
    ]);
  }
}

export interface FetchWithRetryOptions {
  maxAttempts?: number | undefined;
  fetchFn?: typeof fetch | undefined;
  delayFn?: ((ms: number) => Promise<void>) | undefined;
}

/**
 * Fetch with retry logic:
 * - 429 honours Retry-After header
 * - Exponential backoff with jitter on 5xx errors
 * - Maximum 3 attempts per run
 */
export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  options?: FetchWithRetryOptions | undefined,
): Promise<Response> {
  const maxAttempts = options?.maxAttempts ?? 3;
  const doFetch = options?.fetchFn ?? fetch;
  const delay =
    options?.delayFn ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  let lastResponse: Response | null = null;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await doFetch(url, init);
      lastResponse = response;

      if (response.ok) {
        return response;
      }

      // 429 Rate Limit
      if (response.status === 429) {
        if (attempt === maxAttempts) {
          throw new Error(`HTTP 429: Too Many Requests from ${url}`);
        }
        const retryAfterHeader = response.headers.get('retry-after');
        let delayMs = 1000;
        if (retryAfterHeader) {
          const parsedSeconds = parseInt(retryAfterHeader, 10);
          if (!isNaN(parsedSeconds)) {
            delayMs = parsedSeconds * 1000;
          } else {
            const parsedDate = new Date(retryAfterHeader).getTime();
            if (!isNaN(parsedDate)) {
              delayMs = Math.max(0, parsedDate - Date.now());
            }
          }
        }
        await delay(delayMs);
        continue;
      }

      // 5xx Server Errors
      if (response.status >= 500 && response.status < 600) {
        if (attempt === maxAttempts) {
          throw new Error(`HTTP ${response.status} from ${url}`);
        }
        const backoffMs = Math.min(3000, 200 * Math.pow(2, attempt) + Math.random() * 50);
        await delay(backoffMs);
        continue;
      }

      // For 4xx (except 429), do not retry
      return response;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === maxAttempts) {
        throw lastError;
      }
      const backoffMs = Math.min(3000, 200 * Math.pow(2, attempt) + Math.random() * 50);
      await delay(backoffMs);
    }
  }

  if (lastResponse) return lastResponse;
  throw lastError ?? new Error(`Failed to fetch ${url} after ${maxAttempts} attempts`);
}
