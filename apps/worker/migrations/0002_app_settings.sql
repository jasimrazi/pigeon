-- 10. App Settings table
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  ciphertext TEXT,
  iv TEXT,
  key_version INTEGER NOT NULL DEFAULT 1,
  is_secret INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT 'system',
  CHECK (
    (is_secret = 0 AND value IS NOT NULL AND ciphertext IS NULL AND iv IS NULL) OR
    (is_secret = 1 AND value IS NULL AND ciphertext IS NOT NULL AND iv IS NOT NULL)
  )
);
