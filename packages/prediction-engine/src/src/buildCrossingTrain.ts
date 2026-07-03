import { CrossingTrain } from "./types";

export function buildCrossingTrain({
  journeyId,
  line,
  category,
  destination,
  direction,
  delayMinutes,
  route,
  livePosition,
}: CrossingTrain): CrossingTrain {
  return {
    journeyId,

    line,
    category,

    destination,

    direction,

    delayMinutes,

    route,

    livePosition,
  };
}