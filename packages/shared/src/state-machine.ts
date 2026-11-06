import type { ApplicationStatus, JobStatus } from './schema.js';

export type { ApplicationStatus, JobStatus };

export const APPLICATION_STATUSES = [
  'draft',
  'needs_review',
  'skipped',
  'approved',
  'sending',
  'sent',
  'failed',
  'bounced',
  'replied',
  'interview',
  'rejected',
  'offer',
  'manual_pending',
  'manual_applied',
  'manual_skipped',
] as const;

export const JOB_STATUSES = ['new', 'filtered_out', 'scored', 'routed', 'skipped'] as const;

export const APPLICATION_TRANSITIONS: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
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

export const JOB_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  new: ['filtered_out', 'scored', 'skipped'],
  scored: ['routed', 'skipped', 'filtered_out'],
  routed: ['skipped'],
  filtered_out: ['new', 'scored', 'skipped'],
  skipped: ['new'],
};

export class IllegalTransitionError extends Error {
  constructor(
    public readonly entity: string,
    public readonly id: string,
    public readonly from: string,
    public readonly to: string,
    message?: string,
  ) {
    super(message || `Illegal transition for ${entity} '${id}' from '${from}' to '${to}'`);
    this.name = 'IllegalTransitionError';
  }
}

export function canTransition(entity: 'job' | 'application', from: string, to: string): boolean {
  if (entity === 'application') {
    const allowed = APPLICATION_TRANSITIONS[from as ApplicationStatus];
    return Boolean(allowed && allowed.includes(to as ApplicationStatus));
  }
  if (entity === 'job') {
    const allowed = JOB_TRANSITIONS[from as JobStatus];
    return Boolean(allowed && allowed.includes(to as JobStatus));
  }
  return false;
}

export function validateTransition(
  entity: 'job' | 'application',
  from: string,
  to: string,
  id = 'unspecified',
  reason?: string | null,
): void {
  if (!canTransition(entity, from, to)) {
    throw new IllegalTransitionError(entity, id, from, to);
  }

  if (entity === 'application' && from === 'sending' && to === 'approved') {
    if (reason !== 'retry' && reason !== 'auth_pause') {
      throw new IllegalTransitionError(
        entity,
        id,
        from,
        to,
        `Transition from sending to approved requires reason to be 'retry' or 'auth_pause' (got '${reason}')`,
      );
    }
  }
}

export interface D1LikeDatabase {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T = unknown>(): Promise<T | null>;
      run(): Promise<unknown>;
      all<T = unknown>(): Promise<{ results: T[] }>;
    };
  };
  batch(statements: unknown[]): Promise<unknown[]>;
}

let defaultDb: D1LikeDatabase | null = null;

export function setDefaultDb(db: D1LikeDatabase | null): void {
  defaultDb = db;
}

export function getDefaultDb(): D1LikeDatabase | null {
  return defaultDb;
}

export interface TransitionResult {
  entity: 'job' | 'application';
  id: string;
  from: string;
  to: string;
  reason: string | null;
  updated_at: string;
  event_id: string;
}

/**
 * Single state-machine transition function.
 * Validates against allowed transitions, writes an events row, and sets updated_at.
 * Throws IllegalTransitionError if transition is not permitted.
 *
 * Calling signatures:
 *   transition(db, entity, id, to, reason)
 *   transition(entity, id, to, reason, db)
 */
export async function transition(
  entity: 'job' | 'application',
  id: string,
  to: string,
  reason?: string,
  db?: D1LikeDatabase,
): Promise<TransitionResult>;
export async function transition(
  db: D1LikeDatabase,
  entity: 'job' | 'application',
  id: string,
  to: string,
  reason?: string,
): Promise<TransitionResult>;
export async function transition(
  arg1: unknown,
  arg2?: unknown,
  arg3?: unknown,
  arg4?: unknown,
  arg5?: unknown,
): Promise<TransitionResult> {
  let db: D1LikeDatabase | null = null;
  let entity: 'job' | 'application';
  let id: string;
  let to: string;
  let reason: string | null = null;

  if (typeof arg1 === 'string') {
    // transition(entity, id, to, reason, db)
    entity = arg1 as 'job' | 'application';
    id = arg2 as string;
    to = arg3 as string;
    reason = (arg4 as string | undefined) ?? null;
    db = (arg5 as D1LikeDatabase | undefined) ?? defaultDb;
  } else {
    // transition(db, entity, id, to, reason)
    db = arg1 as D1LikeDatabase;
    entity = arg2 as 'job' | 'application';
    id = arg3 as string;
    to = arg4 as string;
    reason = (arg5 as string | undefined) ?? null;
  }

  if (!db) {
    throw new Error('Database instance is required for transition()');
  }

  const table = entity === 'application' ? 'applications' : 'jobs';
  const row = await db
    .prepare(`SELECT status FROM ${table} WHERE id = ?`)
    .bind(id)
    .first<{ status: string }>();

  if (!row) {
    throw new Error(`${entity} with id '${id}' not found`);
  }

  const from = row.status;
  validateTransition(entity, from, to, id, reason);

  const now = new Date().toISOString();
  const eventId = crypto.randomUUID();
  const payload = JSON.stringify({
    from,
    to,
    reason: reason ?? null,
  });

  const updateStmt = db
    .prepare(`UPDATE ${table} SET status = ?, updated_at = ? WHERE id = ?`)
    .bind(to, now, id);

  const eventStmt = db
    .prepare(
      `INSERT INTO events (id, entity, entity_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(eventId, entity, id, 'status_change', payload, now);

  await db.batch([updateStmt, eventStmt]);

  return {
    entity,
    id,
    from,
    to,
    reason,
    updated_at: now,
    event_id: eventId,
  };
}
