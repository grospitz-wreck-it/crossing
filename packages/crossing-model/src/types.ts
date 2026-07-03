export type Crossing = {
  id: string;
  name: string;

  eva: string;

  lat: number;
  lon: number;

  closeOffsetSeconds: number;
  openOffsetSeconds: number;

  confidence: number;
};