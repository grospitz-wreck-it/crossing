import { predictCrossing } from "../../lib/predictCrossing";

export async function GET() {
  return Response.json(
    predictCrossing({
      arrival:
        "2606182042",
    })
  );
}