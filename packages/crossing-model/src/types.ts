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

export type CrossingOsmRules = {
  lineHints?: string[];
  selectedOsmTracks?: CrossingOsmTrack[];
  observationStations?: Array<{
    eva: string;
    stationName?: string;
    side?: "before" | "after";
    distanceKm?: number;
    trackDistanceMeters?: number;
    fallbackOffsetSeconds?: number;
    lat?: number;
    lon?: number;
  }>;
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
  throughRules?: ThroughRule[];
  diversionRules?: DiversionRule[];
  rerouteWatchRules?: RerouteWatchRule[];
  confidence: number;
};