import { db } from "@/app/lib/db";

export async function GET() {
  const result =
    await db.execute(`
      SELECT *
      FROM measurements
      ORDER BY id DESC
    `);

  return Response.json(
    result.rows
  );
}

export async function POST(
  request: Request
) {
  try {
    const body =
      await request.json();

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
  } catch (error) {
    console.error(
      "Measurement insert failed",
      error
    );

    return Response.json(
      {
        success: false,
        error:
          "Insert failed",
      },
      {
        status: 500,
      }
    );
  }
}