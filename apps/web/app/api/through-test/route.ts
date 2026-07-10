import { crossings } from "../../../../../packages/crossing-model/src/crossings";
import { getThroughTrains } from "../../../../../packages/db-api-client/src/getThroughTrains";

export async function GET() {
  const crossing = crossings.find(
    (c) => c.id === "kirchlengern"
  );

  if (!crossing) {
    return Response.json(
      { error: "not found" },
      { status: 404 }
    );
  }

  const trains = await getThroughTrains(
    crossing
  );

  return Response.json(trains);
}