import type { MobilithekTrainEvent } from "@crossing/db-api-client";

export type DemandCrossing = {
  id: string;
  requiredRouteStops: string[];
  categories: string[];
  observationStations: string[];
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

export function filterEventsByDemand(
  events: Array<{ subscriptionId: string; event: MobilithekTrainEvent }>,
  demand: DemandCrossing[],
) {
  if (!demand.length) return [];

  return events.filter(({ event }) => {
    const line = String(event.line || "").toUpperCase();
    const category = String(event.category || "").toUpperCase();
    const route = (event.route || []).map(normalize).filter(Boolean);
    const calls = (event.calls || [])
      .map((call) => normalize(String(call?.name || "")))
      .filter(Boolean);

    return demand.some((crossing) => {
      const categoryMatch =
        crossing.categories.length === 0 ||
        crossing.categories.some((value) => {
          const wanted = String(value).toUpperCase();
          return category === wanted || line.includes(wanted);
        });

      if (!categoryMatch) return false;

      const stations = [
        ...crossing.observationStations,
        ...crossing.requiredRouteStops,
      ]
        .map(normalize)
        .filter(Boolean);

      if (!stations.length) return true;

      // Mobilithek profiling already treats both route stops and calls as
      // station coverage. The snapshot filter must use the same semantics;
      // otherwise a subscription can be selected because a station is present
      // in calls_json and the event is immediately discarded here because that
      // station is missing from route_json.
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
