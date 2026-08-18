import type { Crossing } from "./types";
import type { CrossingOSMMapping, CrossingOSMTrack } from "./osm";
import {
  buildLevelCrossingOverpassQuery,
  buildRailwayWaysQuery,
  type OSMLevelCrossing,
  type OSMRailwayWay,
} from "./osm-query";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

type OverpassElement = {
  type: "node" | "way";
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
  nodes?: number[];
};

type OverpassResponse = { elements: OverpassElement[] };

async function queryOverpass(query: string): Promise<OverpassResponse> {
  const response = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ data: query }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Overpass request failed: ${response.status}`);
  }

  return response.json() as Promise<OverpassResponse>;
}

function haversineMeters(aLat: number, aLon: number, bLat: number, bLon: number) {
  const R = 6_371_000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function toCrossings(elements: OverpassElement[]): OSMLevelCrossing[] {
  return elements
    .filter((element) => element.type === "node" && typeof element.lat === "number" && typeof element.lon === "number")
    .map((element) => ({
      nodeId: String(element.id),
      lat: element.lat as number,
      lon: element.lon as number,
      tags: element.tags || {},
    }));
}

function toRailwayWays(elements: OverpassElement[]): OSMRailwayWay[] {
  return elements
    .filter((element) => element.type === "way" && Array.isArray(element.geometry))
    .map((element) => ({
      wayId: String(element.id),
      tags: element.tags || {},
      nodes: (element.geometry || []).map((point, index) => ({
        id: `${element.id}:${index}`,
        lat: point.lat,
        lon: point.lon,
      })),
    }));
}

function crossingTouchesWay(crossing: OSMLevelCrossing, way: OSMRailwayWay) {
  return way.nodes.some((node) => haversineMeters(crossing.lat, crossing.lon, node.lat, node.lon) <= 35);
}

/**
 * Discover the OSM level crossing nearest to an existing Crossing and the
 * railway ways physically associated with it.
 *
 * This is deliberately an additive importer. It does not mutate the existing
 * crossing and it never removes/invalidates legacy observation rules.
 */
export async function discoverCrossingOSM(crossing: Crossing): Promise<CrossingOSMMapping | null> {
  const crossingResponse = await queryOverpass(buildLevelCrossingOverpassQuery(crossing.lat, crossing.lon));
  const candidates = toCrossings(crossingResponse.elements)
    .map((candidate) => ({
      candidate,
      distanceMeters: haversineMeters(crossing.lat, crossing.lon, candidate.lat, candidate.lon),
    }))
    .filter(({ distanceMeters }) => distanceMeters <= 500)
    .sort((a, b) => a.distanceMeters - b.distanceMeters);

  const nearest = candidates[0];
  if (!nearest) return null;

  const railwayResponse = await queryOverpass(buildRailwayWaysQuery(nearest.candidate.lat, nearest.candidate.lon));
  const railwayWays = toRailwayWays(railwayResponse.elements).filter((way) => crossingTouchesWay(nearest.candidate, way));
  if (!railwayWays.length) return null;

  const tracks: CrossingOSMTrack[] = railwayWays.map((way) => ({
    railwayWayId: way.wayId,
    direction: "unknown",
    geometry: way.nodes.map((node) => [node.lat, node.lon]),
  }));

  const confidence = Math.min(
    1,
    0.85 + Math.min(0.1, railwayWays.length * 0.025),
  );

  return {
    crossingId: crossing.id,
    osmNodeId: nearest.candidate.nodeId,
    tracks,
    source: "openstreetmap",
    confidence,
    updatedAt: new Date().toISOString(),
  };
}
