import type { CrossingOSMMapping } from "../../crossing-model/src/osm";
import { matchRouteToOsmWays, type OSMRailWayGeometry, type RouteStation } from "./routeOsmMatcher";

export type CrossingOsmCandidate = {
  crossingId: string;
  osmNodeId: string;
  railwayWayId: string;
  ref?: string;
  routeScore: number;
  crossingConfidence: number;
  score: number;
};

/**
 * Scores a train route against one or more OSM-mapped crossings.
 * This is diagnostic infrastructure matching only; callers decide whether to
 * use it as a hard filter for predictions.
 */
export function matchRouteToCrossings(
  route: RouteStation[],
  mappings: CrossingOSMMapping[],
  ways: OSMRailWayGeometry[],
): CrossingOsmCandidate[] {
  const usableMappings = mappings.filter(
    (mapping) => mapping.confidence >= 0.8 && mapping.tracks.length > 0,
  );
  const wayMatches = matchRouteToOsmWays(route, ways);
  const byWay = new Map(wayMatches.map((match) => [match.railwayWayId, match]));

  return usableMappings
    .flatMap((mapping) =>
      mapping.tracks.map((track) => {
        const match = byWay.get(String(track.railwayWayId));
        if (!match || match.score <= 0) return null;

        return {
          crossingId: mapping.crossingId,
          osmNodeId: mapping.osmNodeId,
          railwayWayId: String(track.railwayWayId),
          ref: match.ref,
          routeScore: match.score,
          crossingConfidence: mapping.confidence,
          score: match.score * mapping.confidence,
        } satisfies CrossingOsmCandidate;
      }),
    )
    .filter((candidate): candidate is CrossingOsmCandidate => candidate !== null)
    .sort((a, b) => b.score - a.score);
}

export function getUniqueCrossingOsmMatch(
  candidates: CrossingOsmCandidate[],
  minimumScore = 0.65,
  minimumMargin = 0.12,
): CrossingOsmCandidate | null {
  if (!candidates.length || candidates[0].score < minimumScore) return null;
  if (candidates.length > 1 && candidates[0].score - candidates[1].score < minimumMargin) return null;
  return candidates[0];
}
