import { parseDbTime } from "./getNextTrain";

export interface CrossingConfig {
  warningSeconds: number;
  closedSeconds: number;
}

export const defaultCrossingConfig: CrossingConfig = {
  warningSeconds: 60,
  closedSeconds: 90,
};

export function predictCrossing(
  train: any,
  config: CrossingConfig = defaultCrossingConfig
) {
  if (!train?.arrival) {
    return null;
  }

  const arrival = parseDbTime(
    train.arrival
  );

  const closeAt = new Date(
    arrival.getTime() -
      config.warningSeconds * 1000
  );

  const openAt = new Date(
    arrival.getTime() +
      (config.closedSeconds -
        config.warningSeconds) *
        1000
  );

  return {
    closeAt,
    openAt,
  };
}