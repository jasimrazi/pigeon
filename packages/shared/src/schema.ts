import {
  sqliteTable,
  text,
  integer,
  real,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export type JobSourceKind = 'api' | 'ats' | 'alert_email';
export type JobContactSource = 'posting' | 'finder' | 'guessed' | 'none';
export type JobApplyRoute = 'auto_email' | 'manual_portal' | 'manual_review';
export type JobStatus = 'new' | 'filtered_out' | 'scored' | 'routed' | 'skipped';

export type ApplicationKind = 'initial' | 'follow_up';
export type ApplicationChannel = 'email' | 'manual';
export type ApplicationStatus =
  | 'draft'
  | 'needs_review'
  | 'skipped'
  | 'approved'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'bounced'
  | 'replied'
  | 'interview'
  | 'rejected'
  | 'offer'
  | 'manual_pending'
  | 'manual_applied'
  | 'manual_skipped';

export type CircuitState = 'closed' | 'open' | 'half_open';

// 1. Jobs table
export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    dedupe_key: text('dedupe_key').notNull().unique(),
    source: text('source').notNull(),
    source_kind: text('source_kind').$type<JobSourceKind>().notNull(),
    source_job_id: text('source_job_id'),
    title: text('title').notNull(),
    company: text('company').notNull(),
    company_normalized: text('company_normalized').notNull(),
    location: text('location'),
    remote: integer('remote', { mode: 'boolean' }),
    salary_min: real('salary_min'),
    salary_max: real('salary_max'),
    currency: text('currency'),
    salary_raw: text('salary_raw'),
    description: text('description').notNull(),
    apply_url: text('apply_url'),
    contact_email: text('contact_email'),
    contact_source: text('contact_source').$type<JobContactSource>(),
    posted_at: text('posted_at'),
    fetched_at: text('fetched_at').notNull(),
    status: text('status').$type<JobStatus>().notNull(),
    filter_reason: text('filter_reason'),
    match_score: real('match_score'),
    match_reasons: text('match_reasons'),
    red_flags: text('red_flags'),
    scorer_failed: integer('scorer_failed', { mode: 'boolean' }),
    untrusted: integer('untrusted', { mode: 'boolean' }),
    apply_route: text('apply_route').$type<JobApplyRoute>(),
    route_reason: text('route_reason'),
    updated_at: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_jobs_status').on(table.status),
    index('idx_jobs_company_normalized').on(table.company_normalized),
  ],
);

// 2. Applications table
export const applications = sqliteTable(
  'applications',
  {
    id: text('id').primaryKey(),
    job_id: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<ApplicationKind>().notNull(),
    channel: text('channel').$type<ApplicationChannel>().notNull(),
    resume_id: text('resume_id'),
    cover_letter: text('cover_letter'),
    subject: text('subject'),
    status: text('status').$type<ApplicationStatus>().notNull(),
    scheduled_at: text('scheduled_at'),
    sent_at: text('sent_at'),
    applied_at: text('applied_at'),
    message_id_header: text('message_id_header'),
    gmail_message_id: text('gmail_message_id'),
    gmail_thread_id: text('gmail_thread_id'),
    error: text('error'),
    retry_count: integer('retry_count').notNull().default(0),
    follow_up_count: integer('follow_up_count').notNull().default(0),
    notes: text('notes'),
    validator_errors: text('validator_errors'),
    snoozed_until: text('snoozed_until'),
    synced_at: text('synced_at'),
    updated_at: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_applications_job_initial')
      .on(table.job_id, table.kind)
      .where(sql`kind = 'initial'`),
    index('idx_applications_status').on(table.status),
  ],
);

// 3. Resumes table
export const resumes = sqliteTable('resumes', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  r2_key: text('r2_key').notNull(),
  tags: text('tags').notNull(),
  is_default: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  created_at: text('created_at').notNull(),
});

// 4. Companies contacted table
export const companiesContacted = sqliteTable('companies_contacted', {
  company_normalized: text('company_normalized').primaryKey(),
  last_contacted_at: text('last_contacted_at').notNull(),
  last_channel: text('last_channel').$type<ApplicationChannel>().notNull(),
});

// 5. Do not contact table
export const doNotContact = sqliteTable('do_not_contact', {
  value: text('value').primaryKey(),
  reason: text('reason').notNull(),
  created_at: text('created_at').notNull(),
});

// 6. Source state table
export const sourceState = sqliteTable('source_state', {
  source: text('source').primaryKey(),
  consecutive_failures: integer('consecutive_failures').notNull().default(0),
  circuit_state: text('circuit_state').$type<CircuitState>().notNull().default('closed'),
  opened_at: text('opened_at'),
  last_run_at: text('last_run_at'),
  last_success_at: text('last_success_at'),
  last_error: text('last_error'),
  parser_empty_streak: integer('parser_empty_streak').notNull().default(0),
  untrusted: integer('untrusted', { mode: 'boolean' }).notNull().default(false),
});

// 7. Daily counters table
export const dailyCounters = sqliteTable('daily_counters', {
  date: text('date').primaryKey(),
  sends: integer('sends').notNull().default(0),
  bounces: integer('bounces').notNull().default(0),
});

// 8. Events table
export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(),
    entity: text('entity').notNull(),
    entity_id: text('entity_id').notNull(),
    type: text('type').notNull(),
    payload: text('payload').notNull(),
    created_at: text('created_at').notNull(),
  },
  (table) => [
    index('idx_events_entity').on(table.entity, table.entity_id),
    index('idx_events_type').on(table.type),
    index('idx_events_created_at').on(table.created_at),
  ],
);

// 9. Profile table (single row, validated by zod)
export const profile = sqliteTable('profile', {
  id: text('id').primaryKey().default('default'),
  data: text('data').notNull(),
  updated_at: text('updated_at').notNull(),
});

// 10. App Settings table
export const appSettings = sqliteTable(
  'app_settings',
  {
    key: text('key').primaryKey(),
    value: text('value'),
    ciphertext: text('ciphertext'),
    iv: text('iv'),
    key_version: integer('key_version').notNull().default(1),
    is_secret: integer('is_secret', { mode: 'boolean' }).notNull().default(false),
    updated_at: text('updated_at').notNull(),
    updated_by: text('updated_by').notNull().default('system'),
  },
  (table) => [
    check(
      'check_setting_value_or_ciphertext',
      sql`(${table.is_secret} = 0 AND ${table.value} IS NOT NULL AND ${table.ciphertext} IS NULL AND ${table.iv} IS NULL) OR (${table.is_secret} = 1 AND ${table.value} IS NULL AND ${table.ciphertext} IS NOT NULL AND ${table.iv} IS NOT NULL)`,
    ),
  ],
);

// Inferred Types
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;

export type Application = typeof applications.$inferSelect;
export type NewApplication = typeof applications.$inferInsert;

export type Resume = typeof resumes.$inferSelect;
export type NewResume = typeof resumes.$inferInsert;

export type CompanyContacted = typeof companiesContacted.$inferSelect;
export type NewCompanyContacted = typeof companiesContacted.$inferInsert;

export type DoNotContact = typeof doNotContact.$inferSelect;
export type NewDoNotContact = typeof doNotContact.$inferInsert;

export type SourceState = typeof sourceState.$inferSelect;
export type NewSourceState = typeof sourceState.$inferInsert;

export type DailyCounter = typeof dailyCounters.$inferSelect;
export type NewDailyCounter = typeof dailyCounters.$inferInsert;

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;

export type ProfileRow = typeof profile.$inferSelect;
export type NewProfileRow = typeof profile.$inferInsert;

export type AppSetting = typeof appSettings.$inferSelect;
export type NewAppSetting = typeof appSettings.$inferInsert;
