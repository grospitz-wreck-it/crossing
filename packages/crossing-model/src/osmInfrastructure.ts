import type { CrossingOSMMapping, CrossingOSMTrack } from "./osm";

export type OSMRailwayWay = {
  osmId: string;
  ref?: string;
  tracks?: number;
  usage?: string;
  passengerLines?: number;
  maxSpeedKmh?: number;
  electrified?: string;
  railway?: string;
};

export type CrossingInfrastructure = {
  crossingId: string;
  osmNodeId: string;
  confidence: number;
  tracks: Array<CrossingOSMTrack & { railway: OSMRailwayWay }>;
  railwayRefs: string[];
};

function asNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Build a normalized infrastructure view from the OSM mapping plus the
 * already-imported railway way tags. This is deliberately read-only: it does
 * not decide which trains belong to a crossing.
 */
export function buildCrossingInfrastructure(
  mapping: CrossingOSMMapping,
  ways: Array<OSMRailwayWay>,
): CrossingInfrastructure {
  const byId = new Map(ways.map((way) => [String(way.osmId), way]));
  const tracks = mapping.tracks.map((track) => ({
    ...track,
    railway: byId.get(String(track.railwayWayId)) ?? { osmId: String(track.railwayWayId) },
  }));

  return {
    crossingId: mapping.crossingId,
    osmNodeId: mapping.osmNodeId,
    confidence: mapping.confidence,
    tracks,
    railwayRefs: [...new Set(tracks.map((track) => track.railway.ref).filter(Boolean) as string[])],
  };
}

/**
 * Convert raw OSM tags into the normalized railway-way representation used by
 * the crossing infrastructure layer.
 */
export function railwayWayFromTags(osmId: string | number, tags: Record<string, unknown>): OSMRailwayWay {
  return {
    osmId: String(osmId),
    railway: typeof tags.railway === "string" ? tags.railway : undefined,
    ref: typeof tags.ref === "string" ? tags.ref : undefined,
    tracks: asNumber(tags.tracks),
    usage: typeof tags.usage === "string" ? tags.usage : undefined,
    passengerLines: asNumber(tags.passenger_lines),
    maxSpeedKmh: asNumber(tags.maxspeed),
    electrified: typeof tags.electrified === "string" ? tags.electrified : undefined,
  };
}
