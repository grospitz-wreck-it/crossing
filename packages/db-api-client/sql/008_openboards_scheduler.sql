-- OpenBoards scheduler foundation.
-- Additive only: this does not enable OpenBoards production refreshes.
-- Queue rows represent deduplicated EVA batches and one board direction.

CREATE TABLE IF NOT EXISTS openboards_refresh_jobs (
  job_key TEXT PRIMARY KEY,
  direction TEXT NOT NULL CHECK (direction IN ('arrivals', 'departures')),
  eva_numbers_json TEXT NOT NULL,
  interval_ms INTEGER NOT NULL DEFAULT 60000,
  priority INTEGER NOT NULL DEFAULT 100,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  next_due_at TEXT NOT NULL,
  last_started_at TEXT,
  last_finished_at TEXT,
  last_status TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  lock_token TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_openboards_jobs_due
  ON openboards_refresh_jobs(next_due_at, priority);

CREATE INDEX IF NOT EXISTS idx_openboards_jobs_lock
  ON openboards_refresh_jobs(locked_until);

CREATE TABLE IF NOT EXISTS openboards_scheduler_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  next_request_at_ms INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO openboards_scheduler_state (id, next_request_at_ms)
VALUES (1, 0);
