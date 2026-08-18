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
  routeDistanceMeters: number;
};

const DEG_TO_M = 111_320;

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

/**
 * Builds a coarse geometric corridor from the ordered DB station route.
 * This is deliberately independent of the train's stopping pattern: an ICE
 * that skips the observation station still contributes its surrounding route
 * geometry through the stations before and after the crossing.
 */
function getRoutePolyline(route: RouteStation[]) {
  return getCoordinateStations(route).map((station) => ({
    lat: station.lat,
    lon: station.lon,
  }));
}

/**
 * Scores a DB station route against OSM railway ways.
 *
 * The old implementation only asked whether individual stations happened to
 * be close to a railway way. That can confuse parallel/branching lines at a
 * shared station. The primary signal is now the geometry of the complete,
 * ordered station route: how close the OSM way is to the route corridor.
 *
 * Station coverage remains a secondary signal and helps reject ways that only
 * happen to touch one isolated station.
 */
export function matchRouteToOsmWays(
  route: RouteStation[],
  ways: OSMRailWayGeometry[],
  maxRouteDistanceMeters = 1200,
): RouteOsmMatch[] {
  const stations = getCoordinateStations(route);
  const routePolyline = getRoutePolyline(route);
  if (!stations.length || !ways.length || routePolyline.length < 2) return [];

  return ways
    .map((way) => {
      if (!way.geometry.length) {
        return {
          railwayWayId: String(way.osmId),
          ref: way.ref,
          score: 0,
          matchedStations: 0,
          totalStations: stations.length,
          meanDistanceMeters: Infinity,
          routeDistanceMeters: Infinity,
        };
      }

      const wayDistancesToRoute = way.geometry.map((point) =>
        minDistanceToPolyline(point, routePolyline),
      );
      const routeDistanceMeters =
        wayDistancesToRoute.reduce((sum, value) => sum + value, 0) /
        wayDistancesToRoute.length;

      const matchedStations = stations.filter(
        (station) => minDistanceToPolyline(station, way.geometry) <= maxRouteDistanceMeters,
      );

      if (routeDistanceMeters > maxRouteDistanceMeters && !matchedStations.length) {
        return {
          railwayWayId: String(way.osmId),
          ref: way.ref,
          score: 0,
          matchedStations: 0,
          totalStations: stations.length,
          meanDistanceMeters: Infinity,
          routeDistanceMeters,
        };
      }

      const meanDistanceMeters = matchedStations.length
        ? matchedStations.reduce(
            (sum, station) => sum + minDistanceToPolyline(station, way.geometry),
            0,
          ) / matchedStations.length
        : routeDistanceMeters;

      const routeProximity = Math.max(0, 1 - routeDistanceMeters / maxRouteDistanceMeters);
      const coverage = matchedStations.length / stations.length;
      const score = routeProximity * 0.8 + coverage * 0.2;

      return {
        railwayWayId: String(way.osmId),
        ref: way.ref,
        score,
        matchedStations: matchedStations.length,
        totalStations: stations.length,
        meanDistanceMeters,
        routeDistanceMeters,
      };
    })
    .sort((a, b) => b.score - a.score);
}
