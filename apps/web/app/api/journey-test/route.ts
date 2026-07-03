import { getJourney }
from "../../../../../packages/db-api-client/src/journey";

export async function GET() {
  const data =
    await getJourney(
      "20260701-e4836ecb-e8e7-3388-94c8-e821d320b580"
    );

  return Response.json(data);
}