export type TrainContext = {
  currentStop: string;
  nextStop: string | null;
  finalDestination: string;
  delayMinutes: number;
};