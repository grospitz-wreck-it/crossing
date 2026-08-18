export type RouteStation = {
  name: string;
  lat?: number | null;
  lon?: number | null;
};

export type OSMRailWayGeometry = {
  osmId: string | number;
  ref?: string;
  geometry: Array<{ lat: number; lon: number }>;
};

export type RouteOsmMatch = {
  railwayWayId: string;
  ref?: string;
  score: number;
  matchedStations: number;
  totalStations: number;
  meanDistanceMeters: number;
};

const DEG_TO_M = 111_320;

function distanceMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const latScale = Math.cos((a.lat * Math.PI) / 180);
  const dx = (a.lon - b.lon) * DEG_TO_M * latScale;
  const dy = (a.lat - b.lat) * DEG_TO_M;
  return Math.sqrt(dx * dx + dy * dy);
}

function minDistanceToWay(station: RouteStation, way: OSMRailWayGeometry) {
  if (station.lat == null || station.lon == null || way.geometry.length === 0) return Infinity;
  let min = Infinity;
  for (const point of way.geometry) {
    min = Math.min(min, distanceMeters(station as { lat: number; lon: number }, point));
  }
  return min;
}

/**
 * Scores a DB station route against OSM railway ways.
 *
 * This intentionally uses only station coordinates and OSM geometry. It does
 * not decide whether a train belongs to a crossing; callers can use the score
 * as an infrastructure signal alongside the existing prediction rules.
 */
export function matchRouteToOsmWays(
  route: RouteStation[],
  ways: OSMRailWayGeometry[],
  maxStationDistanceMeters = 1500,
): RouteOsmMatch[] {
  const stations = route.filter((station) => station.lat != null && station.lon != null);
  if (!stations.length || !ways.length) return [];

  return ways
    .map((way) => {
      const distances = stations.map((station) => minDistanceToWay(station, way));
      const matched = distances.filter((distance) => distance <= maxStationDistanceMeters);
      if (!matched.length) {
        return {
          railwayWayId: String(way.osmId),
          ref: way.ref,
          score: 0,
          matchedStations: 0,
          totalStations: stations.length,
          meanDistanceMeters: Infinity,
        };
      }

      const meanDistanceMeters = matched.reduce((sum, value) => sum + value, 0) / matched.length;
      const coverage = matched.length / stations.length;
      const proximity = Math.max(0, 1 - meanDistanceMeters / maxStationDistanceMeters);
      const score = coverage * 0.7 + proximity * 0.3;

      return {
        railwayWayId: String(way.osmId),
        ref: way.ref,
        score,
        matchedStations: matched.length,
        totalStations: stations.length,
        meanDistanceMeters,
      };
    })
    .sort((a, b) => b.score - a.score);
}
