import type { MobilithekTrainEvent } from "./mobilithekTimetable";
import { getRailCorridor, matchesRailCorridor } from "./railCorridors";

export type DemandCrossing = {
  id: string;
  requiredRouteStops: string[];
  categories: string[];
  observationStations: string[];
  corridorId?: string;
  corridorLines?: string[];
};

function normalize(value: string): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/hauptbahnhof|hbf|bahnhof|westf\.?|westfalen/gi, " ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function normalizeLine(value: string): string {
  return String(value || "").toUpperCase().replace(/[\s-]+/g, "");
}

function matchesCategory(event: MobilithekTrainEvent, categories: string[]) {
  if (!categories.length) return true;
  const line = normalizeLine(event.line);
  const category = normalizeLine(event.category);
  return categories.some((value) => {
    const wanted = normalizeLine(value);
    return category === wanted || line === wanted || line.includes(wanted) || wanted.includes(line);
  });
}

function matchesStations(event: MobilithekTrainEvent, stations: string[]) {
  if (!stations.length) return true;
  const route = (event.route || []).map(normalize).filter(Boolean);
  const calls = (event.calls || []).map((call) => normalize(String(call?.name || ""))).filter(Boolean);
  return stations.map(normalize).filter(Boolean).some((station) =>
    route.some((stop) => stop === station || stop.includes(station) || station.includes(stop)) ||
    calls.some((call) => call === station || call.includes(station) || station.includes(call)),
  );
}

export function filterEventsByDemand(
  events: Array<{ subscriptionId: string; event: MobilithekTrainEvent }>,
  demand: DemandCrossing[],
) {
  if (!demand.length) return [];

  console.log("[Mobilithek filter] input", {
    events: events.length,
    demand: demand.length,
    firstDemand: demand[0],
  });

  return events.filter(({ event }) => demand.some((crossing) => {
    const corridor = crossing.corridorId ? getRailCorridor(crossing.id) : null;

    if (corridor) {
      return matchesRailCorridor(event, corridor);
    }

    if (!matchesCategory(event, crossing.categories || [])) return false;

    return matchesStations(event, [
      ...(crossing.observationStations || []),
      ...(crossing.requiredRouteStops || []),
    ]);
  }));
}
