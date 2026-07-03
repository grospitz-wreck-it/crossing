import {
  getJourneyPosition,
  getTrainContext,
} from "../../../../../packages/db-api-client/src/journey";

import {
  calculateEta,
} from "../../../../../packages/prediction-engine/src/calculateEta";

export async function GET() {
  const journeyId =
    "20260701-e4836ecb-e8e7-3388-94c8-e821d320b580";

  const position =
    await getJourneyPosition(journeyId);

  const context =
    await getTrainContext(journeyId);

  if (!position) {
    return Response.json(
      { error: "Position not found" },
      { status: 500 }
    );
  }

  const crossing = {
    id: "kirchlengern-01",
    lat: 52.196944,
    lon: 8.642139,
  };

  const eta = calculateEta(
    position.lat,
    position.lon,
    crossing.lat,
    crossing.lon
  );

  return Response.json({
    crossing,
    train: position,
    context,
    eta,
  });
}