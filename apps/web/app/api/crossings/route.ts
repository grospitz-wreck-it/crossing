import { crossings } from "../../../../../packages/crossing-model/src/crossings";

export async function GET() {
  const list = crossings.map((c) => ({
    id: c.id,
    name: c.name,
  }));

  return Response.json(list);
}