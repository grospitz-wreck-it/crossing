export type CrossingRule = {
  platform: string;

  stopping: boolean;

  closeOffsetSeconds?: number;

  openOffsetSeconds?: number;
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

  confidence: number;
};