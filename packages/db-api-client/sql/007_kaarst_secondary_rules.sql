-- Keep Kaarst secondary demand scoped to the four DB observation stations
-- that were restored for the Strecke 2530 / S28 crossing.
-- Do not use distant interchange stations as generic observations.

UPDATE crossings
SET
  through_rules = '[{"observationEva":"8000430","observationStation":"Kaarster See","categories":["S","S28"],"trackDistanceMeters":0,"fallbackOffsetSeconds":300,"direction":"unknown"},{"observationEva":"8003141","observationStation":"Kaarster Bahnhof","categories":["S","S28"],"trackDistanceMeters":0,"fallbackOffsetSeconds":240,"direction":"unknown"},{"observationEva":"8000432","observationStation":"Kaarst Mitte/Holzbüttgen","categories":["S","S28"],"trackDistanceMeters":0,"fallbackOffsetSeconds":180,"direction":"unknown"},{"observationEva":"8000438","observationStation":"Kaarst IKEA","categories":["S","S28"],"trackDistanceMeters":0,"fallbackOffsetSeconds":120,"direction":"unknown"}]',
  diversion_rules = '[]',
  reroute_watch_rules = '[]',
  updated_at = datetime('now')
WHERE id = 'bahnubergang-strecke-2530-61cb37f1';
