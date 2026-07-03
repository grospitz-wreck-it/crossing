import { getDepartures } from "../../../../../packages/db-api-client/src/bahnExpert";


export async function GET() {
  const data =
    await getDepartures("8003288");

  return Response.json(data);
}