-- Crossings – Migration 006
-- Local railway station master catalog.
-- Separate from railway_stations because crossing_station_links references that table.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS railway_station_catalog (
  eva TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  lat REAL,
  lon REAL,
  ibnr TEXT,
  ril100 TEXT,
  plc_code TEXT,
  station_type TEXT,
  operating_status TEXT,
  state TEXT,
  district TEXT,
  source TEXT NOT NULL DEFAULT 'DB source files'
);

CREATE INDEX IF NOT EXISTS idx_station_catalog_geo ON railway_station_catalog(lat, lon);
CREATE INDEX IF NOT EXISTS idx_station_catalog_name ON railway_station_catalog(name);
CREATE INDEX IF NOT EXISTS idx_station_catalog_ril100 ON railway_station_catalog(ril100);
