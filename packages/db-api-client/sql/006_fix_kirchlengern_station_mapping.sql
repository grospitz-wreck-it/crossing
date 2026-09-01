-- Fix the station mapping for the current Kirchlengern crossing.
-- Kirchlengern itself is the direct observation station (EVA 8003288).
-- The other stations remain available as context, but must not feed direct
-- timetable candidates for this crossing.

DELETE FROM crossing_station_links
WHERE crossing_id = 'kirchlengern-bahnhof-lubbecker-str-b8095d49';

INSERT INTO crossing_station_links
  (crossing_id, eva, station_name, role, sort_order)
VALUES
  ('kirchlengern-bahnhof-lubbecker-str-b8095d49', '8003288', 'Kirchlengern', 'observation', 0),
  ('kirchlengern-bahnhof-lubbecker-str-b8095d49', '8000059', 'Bünde (Westf)', 'context', 1),
  ('kirchlengern-bahnhof-lubbecker-str-b8095d49', '8000036', 'Bielefeld Hbf', 'context', 2),
  ('kirchlengern-bahnhof-lubbecker-str-b8095d49', '8000152', 'Hannover Hbf', 'context', 3),
  ('kirchlengern-bahnhof-lubbecker-str-b8095d49', '8000294', 'Osnabrück Hbf', 'context', 4);
