import type { CrossingOSMMapping } from "../../crossing-model/src/osm";
import { getUniqueCrossingOsmMatch, matchRouteToCrossings, type CrossingOsmCandidate } from "./crossingOsmMatcher";
import type { OSMRailWayGeometry, RouteStation } from "./routeOsmMatcher";

export type TrainUsesCrossingResult = {
  usesCrossing: boolean;
  crossingId: string;
  match: CrossingOsmCandidate | null;
  candidates: CrossingOsmCandidate[];
};

/**
 * Generic infrastructure check for every train line.
 *
 * A train is associated with a crossing only when its ordered route matches
 * one of the OSM railway ways explicitly linked to that crossing. Station
 * observation is not used as proof of crossing usage.
 */
export function trainUsesCrossing(
  route: RouteStation[],
  crossingId: string,
  mappings: CrossingOSMMapping[],
  ways: OSMRailWayGeometry[],
  minimumScore = 0.65,
): TrainUsesCrossingResult {
  const candidates = matchRouteToCrossings(route, mappings, ways).filter(
    (candidate) => candidate.crossingId === crossingId,
  );

  const match = getUniqueCrossingOsmMatch(candidates, minimumScore, 0);

  return {
    usesCrossing: Boolean(match),
    crossingId,
    match,
    candidates,
  };
}
