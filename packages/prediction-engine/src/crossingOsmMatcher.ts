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
 *
 * Each crossing can have multiple railway ways/tracks. We therefore first
 * choose the strongest matching track for each crossing and only then compare
 * different crossings. Otherwise two tracks belonging to the same crossing
 * could incorrectly cancel out the uniqueness margin.
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

  const bestByCrossing = new Map<string, CrossingOsmCandidate>();

  for (const mapping of usableMappings) {
    for (const track of mapping.tracks) {
      const match = byWay.get(String(track.railwayWayId));
      if (!match || match.score <= 0) continue;

      const candidate = {
        crossingId: mapping.crossingId,
        osmNodeId: mapping.osmNodeId,
        railwayWayId: String(track.railwayWayId),
        ref: match.ref,
        routeScore: match.score,
        crossingConfidence: mapping.confidence,
        score: match.score * mapping.confidence,
      } satisfies CrossingOsmCandidate;

      const previous = bestByCrossing.get(mapping.crossingId);
      if (!previous || candidate.score > previous.score) {
        bestByCrossing.set(mapping.crossingId, candidate);
      }
    }
  }

  return [...bestByCrossing.values()].sort((a, b) => b.score - a.score);
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
