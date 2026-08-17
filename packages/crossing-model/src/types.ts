export type CrossingRule = {
  platform: string;
  stopping: boolean;
  closeOffsetSeconds?: number;
  openOffsetSeconds?: number;
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
  rules?: CrossingRule[];
  throughRules?: ThroughRule[];
  diversionRules?: DiversionRule[];
  rerouteWatchRules?: RerouteWatchRule[];
  confidence: number;
};