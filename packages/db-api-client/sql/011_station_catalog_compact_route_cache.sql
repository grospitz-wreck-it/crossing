-- Store the station coordinate lookup as one compact row so cold Vercel
-- functions do not read all 5,700+ railway_station_catalog rows on first use.
CREATE TABLE IF NOT EXISTS railway_station_catalog_route_cache (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  payload_json TEXT NOT NULL,
  station_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR REPLACE INTO railway_station_catalog_route_cache (
  id,
  payload_json,
  station_count,
  updated_at
)
SELECT
  1,
  COALESCE(
    json_group_array(
      json_object(
        'eva', eva,
        'name', name,
        'lat', lat,
        'lon', lon
      )
    ),
    '[]'
  ),
  COUNT(*),
  datetime('now')
FROM railway_station_catalog
WHERE lat IS NOT NULL AND lon IS NOT NULL;
