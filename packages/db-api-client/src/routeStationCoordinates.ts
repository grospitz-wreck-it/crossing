import type { OfficialTrainEvent } from "./parseOfficialTimetable";
import type { RouteStation } from "../../prediction-engine/src/routeOsmMatcher";

export type StationCatalogEntry = {
  eva?: string;
  name: string;
  lat?: number | null;
  lon?: number | null;
};

function normalizeStationName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

/**
 * Converts the station-name route delivered by the DB timetable parser into
 * the coordinate-bearing route consumed by the OSM matcher.
 *
 * Unknown stations are retained without coordinates so callers can measure
 * coverage instead of silently deleting route information.
 */
export function officialTrainEventToRouteStations(
  event: Pick<OfficialTrainEvent, "route">,
  catalog: StationCatalogEntry[],
): RouteStation[] {
  const byName = new Map<string, StationCatalogEntry>();

  for (const entry of catalog) {
    const key = normalizeStationName(entry.name);
    if (key && !byName.has(key)) byName.set(key, entry);
  }

  return event.route.map((name) => {
    const entry = byName.get(normalizeStationName(name));
    return {
      name,
      lat: entry?.lat ?? null,
      lon: entry?.lon ?? null,
    };
  });
}
