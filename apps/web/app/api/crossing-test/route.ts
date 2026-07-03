import {
  crossingMarkers,
} from "../../../../../packages/prediction-engine/src/crossingMarkers";

import {
  journeyUsesCrossing,
} from "../../../../../packages/prediction-engine/src/journeyUsesCrossing";

import {
  getJourneyPosition,
  getTrainContext,
} from "../../../../../packages/db-api-client/src/journey";

import {
  calculateEta,
} from "../../../../../packages/prediction-engine/src/calculateEta";

import {
  getCrossingStatus,
} from "../../../../../packages/prediction-engine/src/getCrossingStatus";

import {
  hasPassedCrossing,
} from "../../../../../packages/prediction-engine/src/hasPassedCrossing";

export async function GET() {
  const journeyId =
    "20260701-e4836ecb-e8e7-3388-94c8-e821d320b580";

  const position =
    await getJourneyPosition(journeyId);

  const context =
    await getTrainContext(journeyId);
const relevant =
  journeyUsesCrossing(
    context.stops,
    crossingMarkers[
      "kirchlengern-01"
    ]
  );

console.log({
  relevant,
});
  if (!position) {
    return Response.json(
      {
        error: "Position not found",
      },
      {
        status: 500,
      }
    );
  }

  const crossing = {
    id: "kirchlengern-01",
    lat: 52.196944,
    lon: 8.642139,
  };

  const passed =
  hasPassedCrossing(
    context.currentStop,
    "Kirchlengern",
    context.stops
  );

  if (passed) {
    return Response.json({
      provider:
        "bahn-expert",

      crossing:
        crossing.id,

      state: "OPEN",

      passed: true,

      etaMinutes: null,

      context,

      train:
        position,
    });
  }

  const eta = calculateEta(
    position.lat,
    position.lon,
    crossing.lat,
    crossing.lon
  );

  const state =
    getCrossingStatus(
      eta.etaMinutes
    );

  return Response.json({
  provider:
    "bahn-expert",

  crossing:
    crossing.id,

  relevant,

  state,

  passed: false,

  etaMinutes:
    eta.etaMinutes,

  context,

  train:
    position,
});
}