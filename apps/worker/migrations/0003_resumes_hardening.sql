-- 11. Harden resumes table with size_bytes, archived, and partial unique index on default resume
ALTER TABLE resumes ADD COLUMN size_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE resumes ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;

-- Partial unique index: at most one active resume can have is_default = 1
CREATE UNIQUE INDEX IF NOT EXISTS idx_resumes_single_default ON resumes (is_default) WHERE is_default = 1 AND archived = 0;
