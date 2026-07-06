import { crossings }
from "../../../../../../packages/crossing-model/src/crossings";

export async function GET() {
  return Response.json(
    crossings
  );
}