import type { MobilithekTrainEvent } from "./mobilithekTimetable";

export type SecondaryRuleGroup = {
  kind: "through" | "diversion";
  observationStations: string[];
  categories?: string[];
  lineHints?: string[];
  anchorRouteStops?: string[];
  excludedRouteStop?: string;
};

export type DemandCrossing = {
  id: string;
  requiredRouteStops: string[];
  primaryObservationStations: string[];
  primaryObservationEvas: string[];
  secondaryRules: SecondaryRuleGroup[];
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
      if (!wanted) return false;

      // Mobilithek/SIRI feeds are inconsistent: some feeds expose the EVA
      // as a StopPointRef/StopPlaceRef attribute, others expose the same
      // value as the call name. Treat an exact call-name EVA as primary
      // evidence as well, but never use fuzzy station-name matching here.
      return (
        String(call?.stopPointRef || "").trim() === wanted ||
        String(call?.stopPlaceRef || "").trim() === wanted ||
        String(call?.name || "").trim() === wanted
      );
    }),
  );
}

function secondaryRuleMatches(
  event: MobilithekTrainEvent,
  rule: SecondaryRuleGroup,
): boolean {
  const categories = Array.isArray(rule.categories) ? rule.categories : [];
  const lineHints = Array.isArray(rule.lineHints) ? rule.lineHints : [];

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
      const wanted = String(value || "").toUpperCase().replace(/\\s+/g, "");
      return wanted && (normalizedCategory === wanted || normalizedLine === wanted);
    })
  ) {
    return false;
  }

  const stations = Array.isArray(rule.observationStations)
    ? rule.observationStations
    : [];

  return stations.some((station) => stationMatches(event, station));
}

function secondaryMatches(
  event: MobilithekTrainEvent,
  crossing: DemandCrossing,
): boolean {
  const rules = Array.isArray(crossing.secondaryRules)
    ? crossing.secondaryRules
    : [];

  // Rules are OR-connected as complete units. Every configured constraint
  // inside one rule must match the same journey. This prevents unrelated
  // categories and observation stations from different DB rules forming a
  // cross-product.
  return rules.some((rule) => secondaryRuleMatches(event, rule));
}

export type DemandMatch = {
  crossingId: string;
  kind: "primary" | "secondary";
};

export function getDemandMatches(
  event: MobilithekTrainEvent,
  demand: DemandCrossing[],
): DemandMatch[] {
  if (!demand.length) return [];

  return demand.flatMap((crossing): DemandMatch[] => {
    const primaryEvas = Array.isArray(crossing.primaryObservationEvas)
      ? crossing.primaryObservationEvas
      : [];
    const primaryStations = Array.isArray(crossing.primaryObservationStations)
      ? crossing.primaryObservationStations
      : [];
    const primaryMatch = primaryEvas.length
      ? primaryEvaMatches(event, primaryEvas)
      : primaryStations.some((station) => stationMatches(event, station));

    if (primaryMatch) {
      return [{ crossingId: crossing.id, kind: "primary" as const }];
    }

    if (secondaryMatches(event, crossing)) {
      return [{ crossingId: crossing.id, kind: "secondary" as const }];
    }

    return [];
  });
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

  let primaryMatches = 0;
  let secondaryMatchCount = 0;

  const filtered = events.filter(({ event }) => {
    const matches = getDemandMatches(event, demand);
    const matchedPrimary = matches.some((match) => match.kind === "primary");
    const matchedSecondary = matches.some((match) => match.kind === "secondary");

    if (matchedPrimary) primaryMatches++;
    else if (matchedSecondary) secondaryMatchCount++;

    return matches.length > 0;
  });

  console.log("[Mobilithek filter] result", {
    input: events.length,
    output: filtered.length,
    primaryMatches,
    secondaryMatches: secondaryMatchCount,
    rejected: events.length - filtered.length,
  });

  return filtered;
}
