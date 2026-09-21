import type { MobilithekTrainEvent } from "./mobilithekTimetable";

export type DemandCrossing = {
  id: string;
  requiredRouteStops: string[];
  primaryObservationStations: string[];
  primaryObservationEvas: string[];
  secondaryObservationStations: string[];
  secondaryCategories: string[];
  secondaryLineHints: string[];
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

function stationMatches(event: MobilithekTrainEvent, station: string): boolean {
  const wanted = normalize(station);
  if (!wanted) return false;

  return (
    (event.route || []).some((stop) => {
      const value = normalize(stop);
      return value === wanted || value.includes(wanted) || wanted.includes(value);
    }) ||
    (event.calls || []).some((call) => {
      const value = normalize(String(call?.name || ""));
      return value === wanted || value.includes(wanted) || wanted.includes(value);
    })
  );
}

function primaryEvaMatches(event: MobilithekTrainEvent, evas: string[]): boolean {
  if (!evas.length) return false;
  return (event.calls || []).some((call: any) =>
    evas.some((eva) => {
      const wanted = String(eva || "").trim();
      return wanted && (
        String(call?.stopPointRef || "").trim() === wanted ||
        String(call?.stopPlaceRef || "").trim() === wanted
      );
    }),
  );
}

function secondaryMatches(
  event: MobilithekTrainEvent,
  crossing: DemandCrossing,
): boolean {
  const categories = Array.isArray(crossing.secondaryCategories)
    ? crossing.secondaryCategories
    : [];
  const lineHints = Array.isArray(crossing.secondaryLineHints)
    ? crossing.secondaryLineHints
    : [];

  const line = String(event.line || "").toUpperCase();
  const category = String(event.category || "").toUpperCase();
  const normalizedLine = line.replace(/\s+/g, "");
  const normalizedCategory = category.replace(/\s+/g, "");

  if (lineHints.length) {
    const match = lineHints.some((hint) => {
      const wanted = String(hint || "").toUpperCase().replace(/\s+/g, "");
      return wanted && (
        normalizedLine === wanted ||
        normalizedLine.includes(wanted) ||
        wanted.includes(normalizedLine) ||
        normalizedCategory === wanted
      );
    });
    if (!match) return false;
  }

  if (
    categories.length &&
    !categories.some((value) => {
      const wanted = String(value).toUpperCase();
      return category === wanted || line.includes(wanted);
    })
  ) {
    return false;
  }

  return crossing.secondaryObservationStations.some((station) =>
    stationMatches(event, station),
  );
}

export function filterEventsByDemand(
  events: Array<{ subscriptionId: string; event: MobilithekTrainEvent }>,
  demand: DemandCrossing[],
) {
  if (!demand.length) return [];

  const targetHits = events
    .filter(({ event }) => {
      const serialized = JSON.stringify(event);
      return /RB\\s*61|RE\\s*60|8003288|Kirchlengern/i.test(serialized);
    })
    .slice(0, 5)
    .map(({ subscriptionId, event }) => ({
      subscriptionId,
      line: event.line,
      category: event.category,
      journeyRef: event.journeyRef,
      hasRB61: /RB\\s*61/i.test(JSON.stringify(event)),
      hasRE60: /RE\\s*60/i.test(JSON.stringify(event)),
      has8003288: /8003288/.test(JSON.stringify(event)),
      hasKirchlengern: /Kirchlengern/i.test(JSON.stringify(event)),
      calls: (event.calls || []).map((call) => ({
        name: call.name,
        stopPointRef: call.stopPointRef,
        stopPlaceRef: call.stopPlaceRef,
      })),
    }));

  console.log("[Mobilithek filter] input", {
    events: events.length,
    demand: demand.length,
    firstDemand: demand[0],
    targetHits,
  });

  return events.filter(({ event }) =>
    demand.some((crossing) => {
      // PRIMARY: retain every Mobilithek event that actually contains a
      // configured primary observation station. No category or line filter.
      const primaryMatch =
        primaryEvaMatches(event, crossing.primaryObservationEvas || []) ||
        crossing.primaryObservationStations.some((station) =>
          stationMatches(event, station),
        );
      if (primaryMatch) return true;

      // SECONDARY: retain only events anchored at an explicitly configured
      // secondary observation station and matching its optional constraints.
      return secondaryMatches(event, crossing);
    }),
  );
}
