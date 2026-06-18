export type CrossingState = "OPEN" | "CLOSED";

export interface Crossing {
  id: string;
  name: string;

  lat: number;
  lon: number;

  closeOffsetSeconds: number;
  openOffsetSeconds: number;

  confidence: number;
}

export interface Prediction {
  crossingId: string;

  state: CrossingState;

  nextCloseAt: string;
  nextOpenAt: string;

  nextCloseIn: number;
  expectedClosedDuration: number;

  confidence: number;
}
