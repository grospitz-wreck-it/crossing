export type OSMLineRelation = {
  id?: number;
  ref?: string;
  name?: string;
  from?: string;
  to?: string;
  routeType?: string;
};

export type OSMSelectedTrack = {
  wayId: number | string;
  lineRelations?: OSMLineRelation[];
};

export type OSMLineAssignment = {
  status: "matched" | "ambiguous" | "unknown";
  wayId?: string;
  relationId?: number;
  lineRef?: string;
  direction?: "from-to" | "to-from";
  reason: string;
  candidates: Array<{
    wayId: string;
    relationId?: number;
    lineRef: string;
    direction: "from-to" | "to-from";
  }>;
};

function normalize(value: unknown): string {
  return String(value ?? "")
    .toLocaleLowerCase("de")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/hauptbahnhof|bahnhof|westf\.?|westfalen|hbf/gi, " ")
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeLine(value: unknown): string {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function stationIndex(route: string[], station: string): number {
  const target = normalize(station);
  if (!target) return -1;

  const normalizedRoute = route.map(normalize);
  const exact = normalizedizedIndex(normalizedRoute, target);
  if (exact >= 0) return exact;

  // OSM and timetable station labels occasionally differ by a qualifier.
  // Permit a conservative substring fallback only for sufficiently specific
  // names and only when it identifies exactly one route stop.
  if (target.length < 6) return -1;
  const candidates = normalizedRoute
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => candidate.length >= 6 &&
      (candidate.includes(target) || target.includes(candidate)));
  return candidates.length === 1 ? candidates[0].index : -1;
}

function normalizedizedIndex(values: string[], target: string): number {
  return values.findIndex((value) => value === target);
}

/**
 * Assigns a train to one of the OSM tracks explicitly selected for a crossing.
 *
 * OSM route relations are directional: their from/to tags describe the
 * relation's nominal direction. A train whose ordered route traverses those
 * endpoints from-to is consistent with that relation; to-from is the
 * opposing-direction relation and must not be treated as a second track
 * candidate. Assignment is still ambiguous if more than one physical way has
 * a forward relation match.
 *
 * This relies on OSM from/to being populated consistently. Incomplete or
 * conflicting metadata stays unknown/ambiguous and never changes live
 * filtering by itself.
 */
export function assignTrainToOsmTrack(input: {
  line?: string;
  category?: string;
  route?: string[];
  selectedTracks?: OSMSelectedTrack[];
}): OSMLineAssignment {
  const route = (input.route ?? []).map(String).filter(Boolean);
  const tracks = input.selectedTracks ?? [];
  if (route.length < 2 || !tracks.length) {
    return { status: "unknown", reason: "route-or-track-selection-missing", candidates: [] };
  }

  const trainLine = normalizeLine(input.line);
  const trainCategory = normalizeLine(input.category);
  if (!trainLine && !trainCategory) {
    return { status: "unknown", reason: "train-line-missing", candidates: [] };
  }

  const matches: OSMLineAssignment["candidates"] = [];
  let lineRelationCount = 0;
  let lineMatchedCount = 0;

  for (const track of tracks) {
    for (const relation of track.lineRelations ?? []) {
      lineRelationCount += 1;
      const relationRef = normalizeLine(relation.ref);
      const relationName = normalizeLine(relation.name);
      const lineMatches = Boolean(
        (relationRef && (relationRef === trainLine || relationRef === trainCategory)) ||
        (relationName && (relationName === trainLine || relationName === trainCategory))
      );
      if (!lineMatches) continue;
      lineMatchedCount += 1;

      const fromIndex = stationIndex(route, String(relation.from ?? ""));
      const toIndex = stationIndex(route, String(relation.to ?? ""));
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) continue;
      matches.push({
        wayId: String(track.wayId),
        relationId: relation.id,
        lineRef: String(relation.ref || relation.name || ""),
        direction: fromIndex < toIndex ? "from-to" : "to-from",
      });
    }
  }

  if (!lineRelationCount) {
    return { status: "unknown", reason: "selected-tracks-have-no-line-relations", candidates: [] };
  }
  if (!lineMatchedCount) {
    return { status: "unknown", reason: "no-line-relation-matches-train-line", candidates: [] };
  }
  if (!matches.length) {
    return { status: "unknown", reason: "route-does-not-contain-relation-endpoints", candidates: [] };
  }

  const forwardMatches = matches.filter((match) => match.direction === "from-to");
  if (!forwardMatches.length) {
    return {
      status: "unknown",
      reason: "only-opposite-direction-relations-match",
      candidates: matches,
    };
  }

  const uniqueWays = [...new Set(forwardMatches.map((match) => match.wayId))];
  if (uniqueWays.length !== 1) {
    return {
      status: "ambiguous",
      reason: "forward-line-relation-matches-multiple-selected-tracks",
      candidates: matches,
    };
  }

  const selectedWayMatches = forwardMatches.filter((match) => match.wayId === uniqueWays[0]);
  const uniqueRelations = [...new Set(selectedWayMatches
    .map((match) => match.relationId)
    .filter((id): id is number => id != null))];
  const uniqueLineRefs = [...new Set(selectedWayMatches.map((match) => match.lineRef))];

  return {
    status: "matched",
    wayId: uniqueWays[0],
    relationId: uniqueRelations.length === 1 ? uniqueRelations[0] : undefined,
    lineRef: uniqueLineRefs.length === 1 ? uniqueLineRefs[0] : undefined,
    direction: "from-to",
    reason: "unique-forward-line-relation-match",
    candidates: matches,
  };
}
