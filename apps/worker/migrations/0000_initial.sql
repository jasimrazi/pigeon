-- Pigeon D1 Initial Schema Migration

-- 1. Jobs table
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_job_id TEXT,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  company_normalized TEXT NOT NULL,
  location TEXT,
  remote INTEGER,
  salary_min REAL,
  salary_max REAL,
  currency TEXT,
  salary_raw TEXT,
  description TEXT NOT NULL,
  apply_url TEXT,
  contact_email TEXT,
  contact_source TEXT,
  posted_at TEXT,
  fetched_at TEXT NOT NULL,
  status TEXT NOT NULL,
  filter_reason TEXT,
  match_score REAL,
  match_reasons TEXT,
  red_flags TEXT,
  scorer_failed INTEGER,
  untrusted INTEGER,
  apply_route TEXT,
  route_reason TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status);
CREATE INDEX IF NOT EXISTS idx_jobs_company_normalized ON jobs (company_normalized);

-- 2. Applications table
CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  channel TEXT NOT NULL,
  resume_id TEXT,
  cover_letter TEXT,
  subject TEXT,
  status TEXT NOT NULL,
  scheduled_at TEXT,
  sent_at TEXT,
  applied_at TEXT,
  message_id_header TEXT,
  gmail_message_id TEXT,
  gmail_thread_id TEXT,
  error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  follow_up_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  validator_errors TEXT,
  snoozed_until TEXT,
  synced_at TEXT,
  updated_at TEXT NOT NULL
);

-- UNIQUE(job_id, kind) for kind = 'initial'
CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_job_initial ON applications (job_id, kind) WHERE kind = 'initial';
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications (status);

-- 3. Resumes table
CREATE TABLE IF NOT EXISTS resumes (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  tags TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- 4. Companies contacted table
CREATE TABLE IF NOT EXISTS companies_contacted (
  company_normalized TEXT PRIMARY KEY,
  last_contacted_at TEXT NOT NULL,
  last_channel TEXT NOT NULL
);

-- 5. Do not contact table
CREATE TABLE IF NOT EXISTS do_not_contact (
  value TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 6. Source state table
CREATE TABLE IF NOT EXISTS source_state (
  source TEXT PRIMARY KEY,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  circuit_state TEXT NOT NULL DEFAULT 'closed',
  opened_at TEXT,
  last_run_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  parser_empty_streak INTEGER NOT NULL DEFAULT 0
);

-- 7. Daily counters table
CREATE TABLE IF NOT EXISTS daily_counters (
  date TEXT PRIMARY KEY,
  sends INTEGER NOT NULL DEFAULT 0,
  bounces INTEGER NOT NULL DEFAULT 0
);

-- 8. Events table
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_entity ON events (entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events (type);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events (created_at);

-- 9. Profile table (single row, validated by zod)
CREATE TABLE IF NOT EXISTS profile (
  id TEXT PRIMARY KEY DEFAULT 'default',
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
