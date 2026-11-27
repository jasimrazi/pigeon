-- Migration 0006: Add bookmarked_at column for manual queue bookmarks
ALTER TABLE applications ADD COLUMN bookmarked_at TEXT;

CREATE INDEX IF NOT EXISTS idx_applications_bookmarked_at ON applications (bookmarked_at);
