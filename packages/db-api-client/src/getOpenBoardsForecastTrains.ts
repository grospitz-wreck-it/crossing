import type { OpenBoardsStationObservation } from "./openBoardsNormalizer";

function normalize(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/hauptbahnhof|hbf|bahnhof|westf\.?|westfalen/gi, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function lineMatches(line: string, category: string, hints: string[]): boolean {
  if (!hints.length) return true;
  const key = (value: unknown) => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const actualLine = key(line);
  const actualCategory = key(category);
  return hints.some((hint) => {
    const wanted = key(hint);
    return Boolean(wanted && (actualLine === wanted || actualLine.includes(wanted) || actualCategory === wanted));
  });
}

function routeHasStation(observation: OpenBoardsStationObservation, eva: string, name: string): boolean {
  if (observation.routeEvas.includes(eva)) return true;
  const wanted = normalize(name);
  return Boolean(wanted && observation.routeNames.some((value) => {
    const actual = normalize(value);
    return actual && (actual === wanted || actual.includes(wanted) || wanted.includes(actual));
  }));
}


function lineRouteAnchorPairs(crossing: any, line: string): string[][] {
  const key = (value: unknown) => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const wanted = key(line);
  if (!wanted) return [];
  const tracks = Array.isArray(crossing.rules?.selectedOsmTracks)
    ? crossing.rules.selectedOsmTracks
    : [];
  return tracks.flatMap((track: any) =>
    (Array.isArray(track?.lineRelations) ? track.lineRelations : [])
      .filter((relation: any) =>
        String(relation?.routeType || "").toLowerCase() === "train" &&
        key(relation?.ref) === wanted
      )
      .map((relation: any) => [
        String(relation?.from || "").trim(),
        String(relation?.to || "").trim(),
      ])
      .filter((pair: string[]) => pair[0] && pair[1] && normalize(pair[0]) !== normalize(pair[1]))
  );
}
function hasOrderedRouteAnchors(observation: OpenBoardsStationObservation, requiredStops: string[]): boolean {
  const anchors = requiredStops
    .filter((value) => !/^\d{2,7}$/.test(String(value).trim()))
    .map(normalize)
    .filter(Boolean);
  if (anchors.length < 2) return false;
  const route = observation.routeNames.map(normalize);
  const positions = anchors.map((anchor) => route.findIndex((stop) =>
    stop && (stop === anchor || stop.includes(anchor) || anchor.includes(stop))
  ));
  const matched = positions.filter((position) => position >= 0);
  if (matched.length < 2) return false;
  for (let index = 1; index < positions.length; index += 1) {
    if (positions[index - 1] >= 0 && positions[index] >= 0 && positions[index - 1] >= positions[index]) return false;
  }
  return true;
}

/**
 * Build forecast candidates directly from persisted DB OpenBoards board rows.
 * Primary station rows are explicit stop observations. Through rows are only
 * accepted when the configured observation station and ordered route anchors
 * are both present in the partial OpenBoards route context.
 */
export function getOpenBoardsForecastTrains(
  crossing: any,
  observations: OpenBoardsStationObservation[],
  lineHints: string[] = [],
): any[] {
  const now = Date.now();
  const primaryEvas = new Set<string>((crossing.referenceStations || []).map(String));
  const rules = Array.isArray(crossing.throughRules) ? crossing.throughRules : [];
  const candidates: any[] = [];

  for (const observation of observations) {
    const stationNameForEva = (eva?: string) => {
      if (!eva) return undefined;
      const index = observation.routeEvas.indexOf(eva);
      const name = index >= 0 ? observation.routeNames[index] : undefined;
      return name && !/^\\d{6,7}$/.test(name) ? name : eva;
    };
    if (observation.cancelled || !lineMatches(observation.line, observation.category, lineHints)) continue;
    const eventAt = Date.parse(observation.eventTime);
    if (!Number.isFinite(eventAt) || eventAt < now - 60_000 || eventAt > now + 3 * 60 * 60_000) continue;

    if (primaryEvas.has(observation.evaNumber)) {
      const offsetSeconds = observation.evaNumber === String(crossing.eva || "")
        ? 0
        : Math.max(30, Number(rules.find((rule: any) => String(rule.observationEva || "") === observation.evaNumber)?.fallbackOffsetSeconds || 300));
      const crossingTime = new Date(eventAt + offsetSeconds * 1000);
      candidates.push({
        id: `openboards-primary-${observation.journeyId}-${observation.evaNumber}`,
        source: "openboards-primary-stop",
        line: observation.line,
        category: observation.category,
        journeyNumber: observation.journeyNumber,
        journeyRef: observation.journeyId,
        // Via context is useful for shadow matching, but is not treated as a complete route.
        route: observation.routeNames,
        origin: stationNameForEva(observation.originEva),
        destination: stationNameForEva(observation.destinationEva),
        platform: observation.platform,
        isStoppingTrain: true,
        direction: "unknown",
        directionLabel: stationNameForEva(observation.destinationEva) ? `Richtung ${stationNameForEva(observation.destinationEva)}` : null,
        delayMinutes: observation.timeType === "REAL" && observation.scheduledTime
          ? Math.max(0, Math.round((eventAt - Date.parse(observation.scheduledTime)) / 60_000))
          : 0,
        realtimeSource: "DB OpenBoards",
        realtimeTimeType: observation.timeType,
        crossingTime: crossingTime.toISOString(),
        arrival: observation.eventTime,
        etaSeconds: Math.floor((crossingTime.getTime() - now) / 1000),
      });
    }

    for (const rule of rules) {
      const eva = String(rule.observationEva || "").trim();
      if (!eva || observation.evaNumber !== eva) continue;
      if (!lineMatches(observation.line, observation.category, [
        ...(Array.isArray(rule.lineHints) ? rule.lineHints : []),
        ...(Array.isArray(rule.categories) ? rule.categories : []),
        ...lineHints,
      ])) continue;
      if (!routeHasStation(observation, eva, String(rule.observationStation || ""))) continue;
      const configuredAnchors = Array.isArray(crossing.requiredRouteStops) ? crossing.requiredRouteStops : [];\n      const routeAnchors = configuredAnchors.length >= 2 ? configuredAnchors : lineRouteAnchors(crossing, observation.line);\n      if (!hasOrderedRouteAnchors(observation, routeAnchors)) continue;

      const offset = Math.max(30, Number(rule.fallbackOffsetSeconds || 300));
      const crossingTime = new Date(eventAt + offset * 1000);
      candidates.push({
        id: `openboards-through-${observation.journeyId}-${eva}`,
        source: "openboards-through",
        line: observation.line,
        category: observation.category,
        journeyNumber: observation.journeyNumber,
        journeyRef: observation.journeyId,
        // Via context is useful for shadow matching, but is not treated as a complete route.
        route: observation.routeNames,
        origin: observation.originEva,
        destination: observation.destinationEva,
        platform: observation.platform,
        isStoppingTrain: false,
        direction: rule.direction || "unknown",
        directionLabel: "Durchfahrt",
        delayMinutes: observation.timeType === "REAL" && observation.scheduledTime
          ? Math.max(0, Math.round((eventAt - Date.parse(observation.scheduledTime)) / 60_000))
          : 0,
        realtimeSource: "DB OpenBoards",
        realtimeTimeType: observation.timeType,
        crossingTime: crossingTime.toISOString(),
        arrival: observation.eventTime,
        etaSeconds: Math.floor((crossingTime.getTime() - now) / 1000),
      });
    }
  }

  // A journey may be visible on more than one configured board. Prefer the
  // explicit primary stop candidate over a weaker through inference.
  const unique = new Map<string, any>();
  for (const candidate of candidates) {
    const key = candidate.journeyRef || candidate.id;
    const previous = unique.get(key);
    if (!previous || (previous.source !== "openboards-primary-stop" && candidate.source === "openboards-primary-stop")) {
      unique.set(key, candidate);
    }
  }
  return [...unique.values()].sort((a, b) => Date.parse(a.crossingTime) - Date.parse(b.crossingTime));
}
