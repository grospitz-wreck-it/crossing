import type { RouteStation } from "../../../../packages/prediction-engine/src/routeOsmMatcher";

const MAX_ROUTE_PROXIMITY_KM = 8;

function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const r = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function pointToSegmentDistanceKm(
  point: { lat: number; lon: number },
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
) {
  const latScale = 111.32;
  const lonScale = 111.32 * Math.cos((point.lat * Math.PI) / 180);
  const px = (point.lon - a.lon) * lonScale;
  const py = (point.lat - a.lat) * latScale;
  const bx = (b.lon - a.lon) * lonScale;
  const by = (b.lat - a.lat) * latScale;
  const lengthSquared = bx * bx + by * by;
  if (lengthSquared === 0) return distanceKm(point, a);
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / lengthSquared));
  const dx = px - t * bx;
  const dy = py - t * by;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Cheap crossing-specific geographic exclusion filter.
 * It never decides that a train crosses the BÜ; the OSM RailGraph remains authoritative.
 * Only actual consecutive route stops with coordinates form testable segments.
 * Missing geometry therefore cannot create artificial segments.
 */
export function isTrainRouteNearCrossing(
  crossing: { lat?: number; lon?: number },
  route: RouteStation[] | undefined,
  maxProximityKm = MAX_ROUTE_PROXIMITY_KM,
): boolean {
  const lat = Number(crossing?.lat);
  const lon = Number(crossing?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Array.isArray(route) || route.length < 2) return true;

  let usableSegments = 0;
  const crossingPoint = { lat, lon };

  for (let i = 1; i < route.length; i += 1) {
    const from = route[i - 1];
    const to = route[i];
    if (from?.lat == null || from?.lon == null || to?.lat == null || to?.lon == null) continue;

    const fromLat = Number(from.lat);
    const fromLon = Number(from.lon);
    const toLat = Number(to.lat);
    const toLon = Number(to.lon);
    if (!Number.isFinite(fromLat) || !Number.isFinite(fromLon) || !Number.isFinite(toLat) || !Number.isFinite(toLon)) continue;

    usableSegments += 1;
    if (pointToSegmentDistanceKm(crossingPoint, { lat: fromLat, lon: fromLon }, { lat: toLat, lon: toLon }) <= maxProximityKm) return true;
  }

  // Proximity is exclusion-only: insufficient geometry must reach RailGraph.
  return usableSegments === 0;
}
