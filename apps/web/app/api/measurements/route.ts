import { db } from "../../lib/db";

export async function POST(
  req: Request
) {
  const body =
    await req.json();

  await db.execute({
    sql: `
      INSERT INTO measurements (
        prediction_id,
        event_type,
        actual_at,
        phase_json
      )
      VALUES (?, ?, ?, ?)
    `,
    args: [
      body.predictionId,
      body.event,
      body.actualAt,
      JSON.stringify(
        body.phase
      ),
    ],
  });

  return Response.json({
    success: true,
  });
}