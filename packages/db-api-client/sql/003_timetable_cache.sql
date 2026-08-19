CREATE TABLE IF NOT EXISTS db_timetable_cache (
  cache_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  eva TEXT NOT NULL,
  slot TEXT NOT NULL,
  payload TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_db_timetable_cache_expiry
  ON db_timetable_cache(expires_at);

CREATE INDEX IF NOT EXISTS idx_db_timetable_cache_eva
  ON db_timetable_cache(eva, kind, slot);
