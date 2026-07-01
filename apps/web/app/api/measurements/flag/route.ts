import { db } from "@/app/lib/db";

export async function POST(
  request: Request
) {
  const {
    predictionId,
    flag,
  } = await request.json();

  await db.execute({
    sql: `
      INSERT INTO measurement_flags (
        prediction_id,
        flag
      )
      VALUES (?, ?)
    `,
    args: [
      predictionId,
      flag,
    ],
  });

  return Response.json({
    success: true,
  });
}