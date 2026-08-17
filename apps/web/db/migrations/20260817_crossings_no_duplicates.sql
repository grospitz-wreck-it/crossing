-- Crossings: prevent duplicate names and duplicate resolved locations.
-- Run once against the production Turso database.
CREATE UNIQUE INDEX IF NOT EXISTS ux_crossings_name
ON crossings (LOWER(TRIM(name)));

CREATE UNIQUE INDEX IF NOT EXISTS ux_crossings_location
ON crossings (ROUND(lat, 5), ROUND(lon, 5));
