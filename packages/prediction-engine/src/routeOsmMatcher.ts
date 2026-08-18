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
  matchedSegments: number;
  totalSegments: number;
  meanDistanceMeters: number;
  routeDistanceMeters: number;
};

const DEG_TO_M = 111_320;
const DEFAULT_SEGMENT_TOLERANCE_METERS = 900;

function distanceMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const latScale = Math.cos((a.lat * Math.PI) / 180);
  const dx = (a.lon - b.lon) * DEG_TO_M * latScale;
  const dy = (a.lat - b.lat) * DEG_TO_M;
  return Math.sqrt(dx * dx + dy * dy);
}

function pointToSegmentDistanceMeters(
  point: { lat: number; lon: number },
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
) {
  const latScale = Math.cos((point.lat * Math.PI) / 180);
  const toXY = (value: { lat: number; lon: number }) => ({
    x: value.lon * DEG_TO_M * latScale,
    y: value.lat * DEG_TO_M,
  });

  const p = toXY(point);
  const p1 = toXY(a);
  const p2 = toXY(b);
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;

  if (dx === 0 && dy === 0) return Math.sqrt((p.x - p1.x) ** 2 + (p.y - p1.y) ** 2);

  const t = Math.max(0, Math.min(1, ((p.x - p1.x) * dx + (p.y - p1.y) * dy) / (dx * dx + dy * dy)));
  const projection = { x: p1.x + t * dx, y: p1.y + t * dy };
  return Math.sqrt((p.x - projection.x) ** 2 + (p.y - projection.y) ** 2);
}

function minDistanceToPolyline(
  point: { lat: number; lon: number },
  polyline: Array<{ lat: number; lon: number }>,
) {
  if (!polyline.length) return Infinity;
  if (polyline.length === 1) return distanceMeters(point, polyline[0]);

  let min = Infinity;
  for (let index = 1; index < polyline.length; index += 1) {
    min = Math.min(min, pointToSegmentDistanceMeters(point, polyline[index - 1], polyline[index]));
  }
  return min;
}

function getCoordinateStations(route: RouteStation[]) {
  return route.filter(
    (station): station is RouteStation & { lat: number; lon: number } =>
      station.lat != null && station.lon != null,
  );
}

function segmentMidpoint(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  return { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
}

/**
 * Match a DB route to OSM railway ways using the ordered route geometry.
 *
 * A single shared station is deliberately not enough. The important signal is
 * whether the railway way follows one or more COMPLETE consecutive route
 * segments. This prevents two branches that meet at the same station from
 * both being accepted merely because both are close to that station.
 */
export function matchRouteToOsmWays(
  route: RouteStation[],
  ways: OSMRailWayGeometry[],
  segmentToleranceMeters = DEFAULT_SEGMENT_TOLERANCE_METERS,
): RouteOsmMatch[] {
  const stations = getCoordinateStations(route);
  if (stations.length < 2 || !ways.length) return [];

  const routeSegments = stations.slice(1).map((to, index) => ({
    from: stations[index],
    to,
    midpoint: segmentMidpoint(stations[index], to),
  }));

  return ways
    .map((way) => {
      if (way.geometry.length < 2) {
        return {
          railwayWayId: String(way.osmId),
          ref: way.ref,
          score: 0,
          matchedStations: 0,
          totalStations: stations.length,
          matchedSegments: 0,
          totalSegments: routeSegments.length,
          meanDistanceMeters: Infinity,
          routeDistanceMeters: Infinity,
        };
      }

      const segmentDistances = routeSegments.map((segment) => {
        const fromDistance = minDistanceToPolyline(segment.from, way.geometry);
        const toDistance = minDistanceToPolyline(segment.to, way.geometry);
        const midpointDistance = minDistanceToPolyline(segment.midpoint, way.geometry);
        return (fromDistance + toDistance + midpointDistance) / 3;
      });

      const matchedSegments = segmentDistances.filter((distance) => distance <= segmentToleranceMeters).length;
      const matchedSegmentDistances = segmentDistances.filter((distance) => distance <= segmentToleranceMeters);
      const routeDistanceMeters = segmentDistances.reduce((sum, value) => sum + value, 0) / segmentDistances.length;

      const matchedStations = stations.filter(
        (station) => minDistanceToPolyline(station, way.geometry) <= segmentToleranceMeters,
      );

      if (!matchedSegments) {
        return {
          railwayWayId: String(way.osmId),
          ref: way.ref,
          score: 0,
          matchedStations: 0,
          totalStations: stations.length,
          matchedSegments: 0,
          totalSegments: routeSegments.length,
          meanDistanceMeters: routeDistanceMeters,
          routeDistanceMeters,
        };
      }

      const segmentCoverage = matchedSegments / routeSegments.length;
      const proximity = Math.max(
        0,
        1 - (matchedSegmentDistances.reduce((sum, value) => sum + value, 0) / matchedSegmentDistances.length) / segmentToleranceMeters,
      );
      const stationCoverage = matchedStations.length / stations.length;

      // Segment coverage dominates: a way touching one shared station should
      // score far below a way that actually follows the ordered route.
      const score = segmentCoverage * 0.65 + proximity * 0.25 + stationCoverage * 0.10;

      return {
        railwayWayId: String(way.osmId),
        ref: way.ref,
        score,
        matchedStations: matchedStations.length,
        totalStations: stations.length,
        matchedSegments,
        totalSegments: routeSegments.length,
        meanDistanceMeters: matchedSegmentDistances.reduce((sum, value) => sum + value, 0) / matchedSegmentDistances.length,
        routeDistanceMeters,
      };
    })
    .sort((a, b) => b.score - a.score);
}
