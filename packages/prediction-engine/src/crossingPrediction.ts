export type CrossingPrediction = {
  journeyNumber: number;
  line: string;
  category: string;

  direction:
    | "eastbound"
    | "westbound"
    | "unknown";

  destination: string;

  delayMinutes: number;
};