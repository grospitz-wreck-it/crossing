export type CrossingRule = {
  platform: string;
  stopping: boolean;
  closeOffsetSeconds?: number;
  openOffsetSeconds?: number;
  /** Explicit lines/services known to cross this BÜ; used to constrain demand and snapshots. */
  lineHints?: string[];
};

export type ThroughRule = {
  observationEva: string;
  observationStation: string;
  categories: string[];
  trackDistanceMeters: number;
  fallbackOffsetSeconds: number;
  direction: "eastbound" | "westbound" | "unknown";
};

export type DiversionRule = {
  observationEva: string;
  observationStation: string;
  categories: string[];
  anchorRouteStops: string[];
  excludedRouteStop: string;
};

export type RerouteWatchRule = {
  observationEva: string;
  observationStation: string;
  categories: string[];
  crossingRouteNames: string[];
  fallbackOffsetSeconds: number;
  direction: "eastbound" | "westbound" | "unknown";
};

export type CrossingOsmTrack = {
  wayId: number;
  ref?: string;
  name?: string;
  distanceMeters?: number;
  lineRelations?: Array<{ id: number; ref?: string; name?: string; routeType?: string }>;
  segments?: Array<Array<{ lat: number; lon: number }>>;
};

export type CrossingObservationStation = {
  eva: string;
  stationName?: string;
  side: "before" | "after";
  /** OSM way IDs this station is assigned to; empty means legacy/unassigned. */
  trackWayIds?: number[];
  /** Direction in which this station is used for the configured track. */
  direction?: "eastbound" | "westbound" | "unknown";
  enabled?: boolean;
  priority?: number;
  distanceKm?: number;
  /** Along-track distance from the crossing, not lateral distance to the OSM geometry. */
  trackDistanceMeters?: number;
  fallbackOffsetSeconds?: number;
  lat?: number;
  lon?: number;
};

export type CrossingOsmRules = {
  lineHints?: string[];
  selectedOsmTracks?: CrossingOsmTrack[];
  observationStations?: CrossingObservationStation[];
};

export type Crossing = {
  id: string;
  name: string;
  eva: string;
  observationEvas: string[];
  requiredRouteStops: string[];
  lat: number;
  lon: number;
  closeOffsetSeconds: number;
  openOffsetSeconds: number;
  rules?: CrossingRule[] | CrossingOsmRules;
  /** Platform-specific barrier timing, kept separate from OSM selection rules. */
  platformRules?: CrossingRule[];
  throughRules?: ThroughRule[];
  diversionRules?: DiversionRule[];
  rerouteWatchRules?: RerouteWatchRule[];
  confidence: number;
};