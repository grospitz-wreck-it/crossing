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
/**
 * Source-neutral observation contract for the prediction pipeline.
 * Station-board route context is deliberately not treated as a complete route.
 */
export type TrainObservationSource = "openboards" | "mobilithek" | "db-timetable";
export type TrainObservationTimeQuality = "REAL" | "PREVIEW" | "PLAN" | "ESTIMATED" | "UNKNOWN";
export type TrainRouteCompleteness = "complete" | "partial" | "unknown";

export interface TrainObservation {
  source: TrainObservationSource;
  journeyId: string;
  stationRef: string;
  direction: "arrivals" | "departures";
  observedAt: string;
  eventTime: string;
  scheduledTime?: string;
  timeQuality: TrainObservationTimeQuality;
  line: string;
  category: string;
  journeyNumber: number;
  originRef?: string;
  destinationRef?: string;
  viaRefs: string[];
  routeRefs: string[];
  routeNames: string[];
  routeCompleteness: TrainRouteCompleteness;
  platform?: string;
  cancelled: boolean;
}
