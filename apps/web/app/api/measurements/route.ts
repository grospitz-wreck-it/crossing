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

const VALID_PRECISIONS = ["exact", "at_least"];

export async function POST(
  request: Request
) {
  try {
    const body =
      await request.json();

    // "exact": Nutzer hat den Wechsel (Schranke runter/hoch) live
    // mitbekommen - actualAt ist eine präzise Punktmessung und fließt
    // 1:1 in die Kalibrierung ein.
    //
    // "at_least": Schranke war beim Eintreffen schon in dem gemeldeten
    // Zustand - actualAt ist nur eine ZENSIERTE OBERE SCHRANKE für den
    // echten Zeitpunkt (der reale Wechsel lag irgendwann VOR actualAt,
    // wie lange, ist unbekannt). Darf NIE als Punktschätzer gemittelt
    // werden - nur als einseitiger Hinweis "Vorhersage ist mindestens
    // X Sekunden zu spät", falls actualAt vor der vorhergesagten Zeit
    // liegt. Andernfalls ist die Messung nicht auswertbar.
    const precision = VALID_PRECISIONS.includes(body.precision)
      ? body.precision
      : "exact";

    await db.execute({
      sql: `
        INSERT INTO measurements (
          prediction_id,
          event_type,
          actual_at,
          phase_json,
          precision
        )
        VALUES (?, ?, ?, ?, ?)
      `,
      args: [
        body.predictionId ?? null,
        body.event,
        body.actualAt,
        JSON.stringify(
          body.phase
        ),
        precision,
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