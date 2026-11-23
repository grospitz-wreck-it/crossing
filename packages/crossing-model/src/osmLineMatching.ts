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
  return route.findIndex((item) => {
    const candidate = normalize(item);
    return candidate === target || candidate.includes(target) || target.includes(candidate);
  });
}

/**
 * Assigns a train to one of the OSM tracks explicitly selected for a crossing.
 *
 * This is intentionally conservative: OSM route relations frequently contain
 * several parallel ways. A shared relation is therefore ambiguous, not a
 * reason to guess a physical track. Missing/incomplete metadata stays unknown.
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
  let directionMatchedCount = 0;

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
      const direction = fromIndex < toIndex ? "from-to" : "to-from";
      directionMatchedCount += 1;
      matches.push({
        wayId: String(track.wayId),
        relationId: relation.id,
        lineRef: String(relation.ref || relation.name || ""),
        direction,
      });
    }
  }

  if (!lineRelationCount) {
    return { status: "unknown", reason: "selected-tracks-have-no-line-relations", candidates: [] };
  }
  if (!lineMatchedCount) {
    return { status: "unknown", reason: "no-line-relation-matches-train-line", candidates: [] };
  }
  if (!directionMatchedCount) {
    return { status: "unknown", reason: "route-does-not-contain-relation-endpoints-in-order", candidates: [] };
  }

  const uniqueWays = [...new Set(matches.map((match) => match.wayId))];
  if (uniqueWays.length !== 1) {
    return {
      status: "ambiguous",
      reason: "matching-line-relation-is-present-on-multiple-selected-tracks",
      candidates: matches,
    };
  }

  const uniqueRelations = [...new Set(matches.map((match) => match.relationId).filter((id): id is number => id != null))];
  const directions = [...new Set(matches.map((match) => match.direction))];
  if (uniqueRelations.length > 1 || directions.length > 1) {
    return {
      status: "ambiguous",
      reason: "multiple-matching-relations-or-directions-on-track",
      candidates: matches,
    };
  }

  const match = matches[0];
  return {
    status: "matched",
    wayId: match.wayId,
    relationId: match.relationId,
    lineRef: match.lineRef,
    direction: match.direction,
    reason: "unique-line-relation-and-ordered-route-match",
    candidates: matches,
  };
}
