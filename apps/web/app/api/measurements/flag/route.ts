import { db } from "@/app/lib/db";

const VALID_FLAGS = new Set(["unexpected_train"]);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const predictionId =
      typeof body?.predictionId === "string" ? body.predictionId.trim() : "";
    const flag = typeof body?.flag === "string" ? body.flag.trim() : "";

    if (!predictionId || !VALID_FLAGS.has(flag)) {
      return Response.json(
        { success: false, error: "Invalid measurement flag" },
        { status: 400 }
      );
    }

    await db.execute({
      sql: `
        INSERT INTO measurement_flags (
          prediction_id,
          flag
        )
        VALUES (?, ?)
      `,
      args: [predictionId, flag],
    });

    return Response.json({ success: true });
  } catch (error) {
    console.error("Measurement flag insert failed:", error);
    return Response.json(
      { success: false, error: "Flag insert failed" },
      { status: 500 }
    );
  }
}
