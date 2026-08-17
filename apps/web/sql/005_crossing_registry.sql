-- Crossings – Migration 005
-- Normalized registry for crossings and observation stations.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS railway_stations (
  eva TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  lat REAL,
  lon REAL,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS crossing_station_links (
  id TEXT PRIMARY KEY,
  crossing_id TEXT NOT NULL,
  eva TEXT NOT NULL,
  station_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'observation'
    CHECK (role IN ('primary','observation','anchor')),
  categories TEXT NOT NULL DEFAULT '[]',
  direction TEXT NOT NULL DEFAULT 'unknown'
    CHECK (direction IN ('eastbound','westbound','unknown')),
  fallback_offset_seconds INTEGER NOT NULL DEFAULT 0,
  track_distance_meters REAL NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (crossing_id) REFERENCES crossings(id) ON DELETE CASCADE,
  FOREIGN KEY (eva) REFERENCES railway_stations(eva) ON DELETE RESTRICT,
  UNIQUE(crossing_id, eva, role)
);

CREATE INDEX IF NOT EXISTS idx_crossing_station_links_crossing
  ON crossing_station_links(crossing_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_crossing_station_links_eva
  ON crossing_station_links(eva);

CREATE INDEX IF NOT EXISTS idx_railway_stations_name
  ON railway_stations(name);

-- Seed the stations already used by the current Kirchlengern configuration.
INSERT OR IGNORE INTO railway_stations (eva, name) VALUES
  ('8003288', 'Kirchlengern'),
  ('8000059', 'Bünde (Westf)'),
  ('8000036', 'Bielefeld Hbf'),
  ('8000152', 'Hannover Hbf'),
  ('8000294', 'Osnabrück Hbf');

INSERT OR IGNORE INTO crossing_station_links
  (id, crossing_id, eva, station_name, role, categories, direction, fallback_offset_seconds, sort_order)
VALUES
  ('kirchlengern-primary', 'kirchlengern', '8003288', 'Kirchlengern', 'primary', '["RB","RE","IC","ICE"]', 'unknown', 0, 0),
  ('kirchlengern-buende', 'kirchlengern', '8000059', 'Bünde (Westf)', 'observation', '["ICE","IC","RE","RB"]', 'westbound', 300, 1),
  ('kirchlengern-bielefeld', 'kirchlengern', '8000036', 'Bielefeld Hbf', 'observation', '["ICE","IC","RE","RB"]', 'unknown', 1200, 2),
  ('kirchlengern-hannover', 'kirchlengern', '8000152', 'Hannover Hbf', 'observation', '["ICE","IC","RE","RB"]', 'eastbound', 2400, 3),
  ('kirchlengern-osnabrueck', 'kirchlengern', '8000294', 'Osnabrück Hbf', 'observation', '["ICE","IC","RE","RB"]', 'westbound', 1500, 4);
