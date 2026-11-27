-- Central Tankerkönig station directory and shared price cache.
-- Safe to apply when the pilot tables have already been created manually.

CREATE TABLE IF NOT EXISTS fuel_pilot_areas (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS fuel_stations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT,
  street TEXT,
  house_number TEXT,
  post_code TEXT,
  place TEXT,
  lat REAL,
  lon REAL,
  is_open INTEGER,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS crossing_fuel_stations (
  crossing_id TEXT NOT NULL,
  station_id TEXT NOT NULL,
  distance_m INTEGER,
  direction TEXT,
  discovered_at INTEGER NOT NULL,
  PRIMARY KEY (crossing_id, station_id)
);
CREATE INDEX IF NOT EXISTS idx_crossing_fuel_stations_station
  ON crossing_fuel_stations(station_id);
CREATE INDEX IF NOT EXISTS idx_crossing_fuel_stations_crossing
  ON crossing_fuel_stations(crossing_id);

CREATE TABLE IF NOT EXISTS fuel_pilot_crossings (
  crossing_id TEXT PRIMARY KEY,
  area_code TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS fuel_station_prices (
  station_id TEXT NOT NULL,
  fuel_type TEXT NOT NULL CHECK (fuel_type IN ('e5', 'e10', 'diesel')),
  price REAL NOT NULL,
  observed_at INTEGER NOT NULL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (station_id, fuel_type)
);
CREATE INDEX IF NOT EXISTS idx_fuel_station_prices_fetched
  ON fuel_station_prices(fetched_at);
CREATE INDEX IF NOT EXISTS idx_fuel_station_prices_type_price
  ON fuel_station_prices(fuel_type, price);

CREATE TABLE IF NOT EXISTS fuel_api_control (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_request_at INTEGER NOT NULL DEFAULT 0,
  lock_until INTEGER NOT NULL DEFAULT 0,
  lock_token TEXT,
  updated_at INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO fuel_api_control
  (id, last_request_at, lock_until, lock_token, updated_at)
VALUES (1, 0, 0, NULL, 0);

CREATE TABLE IF NOT EXISTS fuel_refresh_state (
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  last_attempt_at INTEGER,
  last_success_at INTEGER,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  cursor_value TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (scope_type, scope_id)
);
CREATE INDEX IF NOT EXISTS idx_fuel_refresh_state_due
  ON fuel_refresh_state(scope_type, next_attempt_at);

INSERT OR IGNORE INTO fuel_pilot_areas (code, name, enabled, created_at)
VALUES
  ('HERFORD', 'Kreis Herford', 1, unixepoch()),
  ('MI-LUEBBECKE', 'Kreis Minden-Lübbecke', 1, unixepoch());

-- Pilot BÜs confirmed in Turso. Kaarst is deliberately not part of this pilot.
INSERT OR IGNORE INTO fuel_pilot_crossings (crossing_id, area_code, enabled)
VALUES
  ('bruchmuhlen-bruchstra-e-3a0a7ad0', 'HERFORD', 1),
  ('bahnubergang-dd8e7fc5', 'HERFORD', 1),
  ('bahnubergang-4ff18724', 'HERFORD', 1),
  ('kirchlengern-bahnhof-lubbecker-str-b8095d49', 'HERFORD', 1);
