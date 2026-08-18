import { Prediction } from "@crossing/shared-types";

export function createPrediction(
  crossingId: string,
  trainEta: Date,
  closeOffset: number,
  openOffset: number
): Prediction {
  const nextCloseAt = new Date(
    trainEta.getTime() - closeOffset * 1000
  );

  const nextOpenAt = new Date(
    trainEta.getTime() + openOffset * 1000
  );

  const now = Date.now();

  const state =
    now >= nextCloseAt.getTime() &&
    now <= nextOpenAt.getTime()
      ? "CLOSED"
      : "OPEN";

  return {
    crossingId,

    state,

    nextCloseAt: nextCloseAt.toISOString(),
    nextOpenAt: nextOpenAt.toISOString(),

    nextCloseIn: Math.max(
      0,
      Math.floor((nextCloseAt.getTime() - now) / 1000)
    ),

    expectedClosedDuration:
      closeOffset + openOffset,

    confidence: 0.85,
  };
}

export { trainUsesCrossing } from "./trainUsesCrossing";
export type { TrainUsesCrossingResult } from "./trainUsesCrossing";
