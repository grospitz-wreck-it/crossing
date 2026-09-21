import type { MobilithekTrainEvent } from "./mobilithekTimetable";

export type DemandCrossing = {
  id: string;
  requiredRouteStops: string[];
  categories: string[];
  observationStations: string[];
  primaryObservationEvas: string[];
};

function normalizeEva(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const match = raw.match(/(?:^|[^0-9])(\d{7})(?:$|[^0-9])/);
  return match?.[1] || raw;
}

function evaMatches(value: unknown, target: string): boolean {
  const wanted = normalizeEva(target);
  if (!wanted) return false;
  return normalizeEva(value) === wanted;
}

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

  return events.filter(({ event }) => {
    const line = String(event.line || "").toUpperCase();
    const category = String(event.category || "").toUpperCase();
    const route = (event.route || []).map(normalize).filter(Boolean);
    const calls = (event.calls || [])
      .map((call) => normalize(String(call?.name || "")))
      .filter(Boolean);

    return demand.some((crossing) => {
      const primaryObservationEvas = Array.isArray(crossing.primaryObservationEvas)
        ? crossing.primaryObservationEvas.map((value: unknown) => String(value).trim()).filter(Boolean)
        : [];

      const categories = Array.isArray(crossing.categories)
        ? crossing.categories
        : [];

      const categoryMatch =
        categories.length === 0 ||
        categories.some((value) => {
          const wanted = String(value).toUpperCase();
          return category === wanted || line.includes(wanted);
        });

      const primaryEvaMatch = primaryObservationEvas.length > 0 &&
        (event.calls || []).some((call) =>
          primaryObservationEvas.some((eva) =>
            evaMatches(call?.stopPointRef, eva) ||
            evaMatches(call?.stopPlaceRef, eva),
          ),
        );

      if (primaryEvaMatch) return true;
      if (!categoryMatch) return false;

      const observationStations = Array.isArray(crossing.observationStations)
        ? crossing.observationStations
        : [];

      const requiredRouteStops = Array.isArray(crossing.requiredRouteStops)
        ? crossing.requiredRouteStops
        : [];

      const stations = [
        ...observationStations,
        ...requiredRouteStops,
      ]
        .map(normalize)
        .filter(Boolean);

      if (!stations.length) return true;

      return stations.some((station) =>
        route.some(
          (stop) =>
            stop === station ||
            stop.includes(station) ||
            station.includes(stop),
        ) ||
        calls.some(
          (call) =>
            call === station ||
            call.includes(station) ||
            station.includes(call),
        ),
      );
    });
  });
}
