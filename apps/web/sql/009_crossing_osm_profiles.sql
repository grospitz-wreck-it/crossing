-- Persist prepared OSM corridor graphs so status matching can reuse them.
-- The profile is built explicitly outside the status request path.
ALTER TABLE crossing_osm_corridors ADD COLUMN profile_json TEXT;
ALTER TABLE crossing_osm_corridors ADD COLUMN profile_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE crossing_osm_corridors ADD COLUMN profile_built_at TEXT;
