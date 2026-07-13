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

  direction:
    | "eastbound"
    | "westbound";
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

  confidence: number;
};