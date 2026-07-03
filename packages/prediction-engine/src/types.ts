export type CrossingTrain = {
  journeyId: string;

  line: string;
  category: string;

  destination: string;

  direction:
    | "eastbound"
    | "westbound"
    | "unknown";

  delayMinutes: number;

  route: string[];

  livePosition?: {
    lat: number;
    lon: number;
    speed?: number;
  };
};