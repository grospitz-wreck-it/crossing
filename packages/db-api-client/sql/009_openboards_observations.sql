-- OpenBoards observation store.
-- Separate from mobilithek_train_snapshot: this is shadow-mode source data only.

CREATE TABLE IF NOT EXISTS openboards_observations (
  observation_key TEXT PRIMARY KEY,
  journey_id TEXT NOT NULL,
  eva_number TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('arrivals', 'departures')),
  event_time TEXT NOT NULL,
  scheduled_time TEXT,
  time_type TEXT NOT NULL DEFAULT 'UNKNOWN',
  line TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  journey_number INTEGER NOT NULL DEFAULT 0,
  origin_eva TEXT,
  destination_eva TEXT,
  via_evas_json TEXT NOT NULL DEFAULT '[]',
  route_evas_json TEXT NOT NULL DEFAULT '[]',
  route_names_json TEXT NOT NULL DEFAULT '[]',
  platform TEXT,
  cancelled INTEGER NOT NULL DEFAULT 0 CHECK (cancelled IN (0, 1)),
  observed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_openboards_observations_time
  ON openboards_observations(event_time);

CREATE INDEX IF NOT EXISTS idx_openboards_observations_eva_time
  ON openboards_observations(eva_number, direction, event_time);

CREATE INDEX IF NOT EXISTS idx_openboards_observations_journey
  ON openboards_observations(journey_id, event_time);

CREATE TABLE IF NOT EXISTS openboards_refresh_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_key TEXT NOT NULL,
  direction TEXT NOT NULL,
  eva_numbers_json TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL,
  observation_count INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_openboards_refresh_runs_requested
  ON openboards_refresh_runs(requested_at);
