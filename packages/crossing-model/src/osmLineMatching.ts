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
    direction?: "from-to" | "to-from";
    from?: string;
    to?: string;
    fromIndex?: number;
    toIndex?: number;
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
  const exact = exactIndex(normalizedRoute, target);
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

function exactIndex(values: string[], target: string): number {
  return values.findIndex((value) => value === target);
}

/**
 * Assigns a train to one of the OSM tracks explicitly selected for a crossing.
 *
 * OSM route relations are directional, but both travel directions use
 * the same physical railway way. The train's ordered route may therefore
 * traverse the relation endpoints from-to OR to-from. Direction is retained
 * as metadata; physical assignment is based on the unique way ID.
 *
 * Assignment is ambiguous if matching relations point to more than one
 * selected physical way. Incomplete or conflicting metadata stays unknown.
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
        from: String(relation.from ?? ""),
        to: String(relation.to ?? ""),
        fromIndex,
        toIndex,
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
    // OpenBoards/Mobilithek may provide only a partial stop sequence for a
    // through service. One relation endpoint can still identify the selected
    // physical way. When that endpoint is at the beginning or end of the
    // ordered observed route, its position also establishes relation direction.
    // An endpoint in the middle of a partial route is not enough to infer
    // direction and remains unknown.
    const partialMatches: OSMLineAssignment["candidates"] = [];
    for (const track of tracks) {
      for (const relation of track.lineRelations ?? []) {
        const relationRef = normalizeLine(relation.ref);
        const relationName = normalizeLine(relation.name);
        const lineMatches = Boolean(
          (relationRef && (relationRef === trainLine || relationRef === trainCategory)) ||
          (relationName && (relationName === trainLine || relationName === trainCategory))
        );
        if (!lineMatches) continue;
        const fromIndex = stationIndex(route, String(relation.from ?? ""));
        const toIndex = stationIndex(route, String(relation.to ?? ""));
        if ((fromIndex < 0) === (toIndex < 0)) continue;

        let direction: "from-to" | "to-from" | undefined;
        if (fromIndex >= 0) {
          if (fromIndex === 0) direction = "from-to";
          else if (fromIndex === route.length - 1) direction = "to-from";
        } else if (toIndex >= 0) {
          if (toIndex === route.length - 1) direction = "from-to";
          else if (toIndex === 0) direction = "to-from";
        }

        partialMatches.push({
          wayId: String(track.wayId),
          relationId: relation.id,
          lineRef: String(relation.ref || relation.name || ""),
          from: String(relation.from ?? ""),
          to: String(relation.to ?? ""),
          ...(direction ? { direction } : {}),
          ...(fromIndex >= 0 ? { fromIndex } : {}),
          ...(toIndex >= 0 ? { toIndex } : {}),
        });
      }
    }

    const partialWays = [...new Set(partialMatches.map((match) => match.wayId))];
    if (partialWays.length === 1) {
      const wayMatches = partialMatches.filter((match) => match.wayId === partialWays[0]);
      const directions = [...new Set(wayMatches.map((match) => match.direction).filter(
        (direction): direction is "from-to" | "to-from" => direction != null,
      ))];
      const relationIds = [...new Set(wayMatches.map((match) => match.relationId).filter((id): id is number => id != null))];
      const lineRefs = [...new Set(wayMatches.map((match) => match.lineRef))];
      return {
        status: "matched",
        wayId: partialWays[0],
        relationId: relationIds.length === 1 ? relationIds[0] : undefined,
        lineRef: lineRefs.length === 1 ? lineRefs[0] : undefined,
        direction: directions.length === 1 ? directions[0] : undefined,
        reason: directions.length === 1
          ? "unique-selected-way-line-relation-partial-route"
          : "unique-selected-way-line-relation-partial-route-direction-unknown",
        candidates: partialMatches,
      };
    }

    if (partialWays.length > 1) {
      // Prefer the unique selected way whose relation direction agrees with
      // the observed route order. This is what distinguishes opposite S28
      // directions when the only shared endpoint is Kaarster See.
      const forwardMatches = partialMatches.filter((match) => match.direction === "from-to");
      const forwardWays = [...new Set(forwardMatches.map((match) => match.wayId))];
      if (forwardWays.length === 1) {
        const selectedMatches = forwardMatches.filter((match) => match.wayId === forwardWays[0]);
        const relationIds = [...new Set(selectedMatches.map((match) => match.relationId).filter((id): id is number => id != null))];
        const lineRefs = [...new Set(selectedMatches.map((match) => match.lineRef))];
        return {
          status: "matched",
          wayId: forwardWays[0],
          relationId: relationIds.length === 1 ? relationIds[0] : undefined,
          lineRef: lineRefs.length === 1 ? lineRefs[0] : undefined,
          direction: "from-to",
          reason: "unique-forward-selected-way-line-relation-partial-route",
          candidates: partialMatches,
        };
      }
      return {
        status: "ambiguous",
        reason: forwardWays.length > 1
          ? "multiple-tracks-match-partial-route-direction"
          : "no-unique-track-matches-partial-route-direction",
        candidates: partialMatches,
      };
    }

    return { status: "unknown", reason: "route-does-not-contain-relation-endpoints", candidates: [] };
  }

  // First prefer relations whose OSM from/to order agrees with the train's
  // ordered route. At a station, opposite-direction services can be mapped to
  // different physical tracks; treating every endpoint match equally makes
  // both tracks look valid for the same train.
  //
  // This is only a directional discriminator when several physical ways
  // match. A single physical way remains valid in either travel direction.
  const uniqueWays = [...new Set(matches.map((match) => match.wayId))];
  let assignedWayId: string;
  if (uniqueWays.length === 1) {
    assignedWayId = uniqueWays[0];
  } else {
    const forwardWays = [...new Set(
      matches.filter((match) => match.direction === "from-to").map((match) => match.wayId)
    )];
    if (forwardWays.length !== 1) {
      return {
        status: "ambiguous",
        reason: forwardWays.length > 1
          ? "multiple-tracks-match-train-direction"
          : "no-unique-track-matches-train-direction",
        candidates: matches,
      };
    }
    assignedWayId = forwardWays[0];
  }

  const selectedWayMatches = matches.filter((match) => match.wayId === assignedWayId);
  const directions = [...new Set(selectedWayMatches.map((match) => match.direction))];
  const direction = directions.length === 1 ? directions[0] : undefined;
  const uniqueRelations = [...new Set(selectedWayMatches
    .map((match) => match.relationId)
    .filter((id): id is number => id != null))];
  const uniqueLineRefs = [...new Set(selectedWayMatches.map((match) => match.lineRef))];

  return {
    status: "matched",
    wayId: assignedWayId,
    relationId: uniqueRelations.length === 1 ? uniqueRelations[0] : undefined,
    lineRef: uniqueLineRefs.length === 1 ? uniqueLineRefs[0] : undefined,
    direction,
    reason: uniqueWays.length === 1
      ? "unique-physical-way-line-relation-match"
      : "unique-forward-physical-way-line-relation-match",
    candidates: matches,
  };
}
