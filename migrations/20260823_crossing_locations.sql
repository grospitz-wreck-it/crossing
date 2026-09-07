CREATE TABLE IF NOT EXISTS crossing_locations (
  crossing_id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  city TEXT NOT NULL,
  postal_code TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (crossing_id) REFERENCES crossings(id)
);

CREATE INDEX IF NOT EXISTS idx_crossing_locations_state_city
  ON crossing_locations(state, city);

CREATE INDEX IF NOT EXISTS idx_crossing_locations_city
  ON crossing_locations(city);
