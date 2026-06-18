import { crossings } from "@crossing/crossing-model";
import { createPrediction } from "@crossing/prediction-engine";
import { getNextTrainEta } from "@crossing/db-api-client";

export async function GET(
  req: Request,
  context: {
    params: Promise<{
      id: string;
    }>;
  }
) {
  const { id } = await context.params;

  const crossing = crossings.find(
    (c) => c.id === id
  );

  if (!crossing) {
    return Response.json(
      { error: "not found" },
      { status: 404 }
    );
  }

  const eta =
    await getNextTrainEta();

  const prediction =
    createPrediction(
      crossing.id,
      eta,
      crossing.closeOffsetSeconds,
      crossing.openOffsetSeconds
    );

  return Response.json(
    prediction
  );
}
