export type OSMTrackDirection = "forward" | "backward" | "unknown";

/**
 * Infrastructure identity derived from OpenStreetMap.
 *
 * This is deliberately separate from the existing Crossing model. Existing
 * crossings can continue using observation/through rules when no OSM mapping
 * is available or when the mapping cannot be trusted.
 */
export type CrossingOSMTrack = {
  railwayWayId: string;
  direction: OSMTrackDirection;
  geometry?: Array<[number, number]>;
};

export type CrossingOSMMapping = {
  crossingId: string;
  osmNodeId: string;
  tracks: CrossingOSMTrack[];
  source: "openstreetmap";
  confidence: number;
  updatedAt?: string;
};

export function hasUsableOSMMapping(mapping?: CrossingOSMMapping | null) {
  return Boolean(
    mapping &&
      mapping.osmNodeId &&
      mapping.tracks.length > 0 &&
      mapping.confidence >= 0.8,
  );
}
