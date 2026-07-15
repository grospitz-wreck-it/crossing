import type { Crossing } from "../../crossing-model/src/types";
import type { TrainMovement } from "./types/TrainMovement";

import { getThroughTrains } from "./getThroughTrains";
import { getTrainContext } from "./journey";
import { withMemoryCache } from "./memoryCache";

export async function buildThroughMovements(
  crossing: Crossing
): Promise<TrainMovement[]> {

  const throughTrains =
    await withMemoryCache(
      `through-${crossing.id}`,
      5000,
      () => getThroughTrains(crossing)
    );

  const contexts =
    await Promise.all(
      throughTrains.map((train) =>
        getTrainContext(train.journeyId)
      )
    );

  console.log(
    "[THROUGH MOVEMENTS]",
    throughTrains.length
  );

  return [];
}