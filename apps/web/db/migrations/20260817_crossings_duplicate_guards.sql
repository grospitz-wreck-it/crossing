-- Hard database guards for crossings.
-- These run before INSERT so duplicate creation is blocked even on double-clicks/races.
CREATE TRIGGER IF NOT EXISTS crossings_duplicate_name_guard
BEFORE INSERT ON crossings
WHEN EXISTS (
  SELECT 1 FROM crossings
  WHERE LOWER(TRIM(name)) = LOWER(TRIM(NEW.name))
)
BEGIN
  SELECT RAISE(ABORT, 'DUPLICATE_NAME: Dieser Name wird bereits verwendet.');
END;

CREATE TRIGGER IF NOT EXISTS crossings_duplicate_location_guard
BEFORE INSERT ON crossings
WHEN EXISTS (
  SELECT 1 FROM crossings
  WHERE ROUND(lat, 5) = ROUND(NEW.lat, 5)
    AND ROUND(lon, 5) = ROUND(NEW.lon, 5)
)
BEGIN
  SELECT RAISE(ABORT, 'DUPLICATE_LOCATION: An diesem Standort existiert bereits ein Bahnübergang.');
END;
