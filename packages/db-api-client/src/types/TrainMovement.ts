import type { TrainContext } from "./trainContext";

export type TrainMovement = {
  journeyId: string;

  line: string;

  category: string;

  journeyNumber: number;

  destination: string;

  origin?: string;

  platform?: string;

  direction?: "eastbound" | "westbound";

  isStoppingTrain: boolean;

  crossingTime: Date;

  etaSeconds: number;

  delayMinutes: number;

  context: TrainContext;

  livePosition?: {
    latitude: number;
    longitude: number;
    speed: number;
    time: string;
    metaSource: string;
  } | null;
};