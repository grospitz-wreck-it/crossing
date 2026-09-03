-- Restore the DB observation stations for the Kaarst / Strecke 2530 crossing.
-- These are the rail stations on the Regiobahn west branch used to observe
-- S28 movements around the Siemensstraße / Neersener Straße crossing.

INSERT OR IGNORE INTO railway_stations (eva, name, source)
VALUES
  ('8000430', 'Kaarster See', 'catalog'),
  ('8003141', 'Kaarster Bahnhof', 'catalog'),
  ('8000432', 'Kaarst Mitte/Holzbüttgen', 'catalog'),
  ('8000438', 'Kaarst IKEA', 'catalog');

DELETE FROM crossing_station_links
WHERE crossing_id = 'bahnubergang-strecke-2530-61cb37f1';

INSERT INTO crossing_station_links
  (id, crossing_id, eva, station_name, role, categories, direction, fallback_offset_seconds, track_distance_meters, sort_order)
VALUES
  ('bahnubergang-strecke-2530-61cb37f1-8000430-0', 'bahnubergang-strecke-2530-61cb37f1', '8000430', 'Kaarster See', 'observation', '["S","S28"]', 'unknown', 300, 0, 0),
  ('bahnubergang-strecke-2530-61cb37f1-8003141-1', 'bahnubergang-strecke-2530-61cb37f1', '8003141', 'Kaarster Bahnhof', 'observation', '["S","S28"]', 'unknown', 240, 0, 1),
  ('bahnubergang-strecke-2530-61cb37f1-8000432-2', 'bahnubergang-strecke-2530-61cb37f1', '8000432', 'Kaarst Mitte/Holzbüttgen', 'observation', '["S","S28"]', 'unknown', 180, 0, 2),
  ('bahnubergang-strecke-2530-61cb37f1-8000438-3', 'bahnubergang-strecke-2530-61cb37f1', '8000438', 'Kaarst IKEA', 'observation', '["S","S28"]', 'unknown', 120, 0, 3);

UPDATE crossings
SET
  observation_evas = '["8000430","8003141","8000432","8000438"]',
  through_rules = '[{"observationEva":"8000430","observationStation":"Kaarster See","categories":["S","S28"],"trackDistanceMeters":0,"fallbackOffsetSeconds":300,"direction":"unknown"},{"observationEva":"8003141","observationStation":"Kaarster Bahnhof","categories":["S","S28"],"trackDistanceMeters":0,"fallbackOffsetSeconds":240,"direction":"unknown"},{"observationEva":"8000432","observationStation":"Kaarst Mitte/Holzbüttgen","categories":["S","S28"],"trackDistanceMeters":0,"fallbackOffsetSeconds":180,"direction":"unknown"},{"observationEva":"8000438","observationStation":"Kaarst IKEA","categories":["S","S28"],"trackDistanceMeters":0,"fallbackOffsetSeconds":120,"direction":"unknown"}]',
  updated_at = datetime('now')
WHERE id = 'bahnubergang-strecke-2530-61cb37f1';
