import { db } from "@/app/lib/db";

const VALID_RATINGS = new Set([1, 2, 3, 4, 5]);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const rating = Number(body.rating);

    if (!body.predictionId || !body.crossingId || !VALID_RATINGS.has(rating)) {
      return Response.json(
        { success: false, error: "Invalid feedback" },
        { status: 400 }
      );
    }

    await db.execute({
      sql: `
        INSERT INTO prediction_feedback (
          prediction_id,
          crossing_id,
          rating,
          created_at
        )
        VALUES (?, ?, ?, ?)
      `,
      args: [
        String(body.predictionId),
        String(body.crossingId),
        rating,
        new Date().toISOString(),
      ],
    });

    return Response.json({ success: true });
  } catch (error) {
    console.error("Prediction feedback insert failed", error);

    return Response.json(
      { success: false, error: "Insert failed" },
      { status: 500 }
    );
  }
}
