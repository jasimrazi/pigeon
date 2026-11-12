-- 12. Add resume_files table for D1 SQLite storage (replacing R2)
CREATE TABLE IF NOT EXISTS resume_files (
  resume_id TEXT PRIMARY KEY REFERENCES resumes(id) ON DELETE CASCADE,
  mime_type TEXT NOT NULL DEFAULT 'application/pdf',
  file_bytes BLOB NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
