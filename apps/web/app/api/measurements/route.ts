import { db } from "@/app/lib/db";

export async function GET() {
  const result =
    await db.execute(`
      SELECT
        prediction_id,

        MIN(
          CASE
            WHEN event_type = 'close'
            THEN actual_at
          END
        ) AS close_at,

        MIN(
          CASE
            WHEN event_type = 'open'
            THEN actual_at
          END
        ) AS open_at,

        MIN(
          phase_json
        ) AS phase_json

      FROM measurements

      GROUP BY prediction_id

      ORDER BY prediction_id DESC
    `);

  const rows =
    result.rows.map(
      (row: any) => {
        const phase =
          JSON.parse(
            row.phase_json
          );

        const closeAt =
          row.close_at
            ? new Date(
                row.close_at
              )
            : null;

        const openAt =
          row.open_at
            ? new Date(
                row.open_at
              )
            : null;

        const predictedClose =
          new Date(
            phase.start
          );

        const predictedOpen =
          new Date(
            phase.end
          );

        return {
          predictionId:
            row.prediction_id,

          predictedClose,

          predictedOpen,

          actualClose:
            closeAt,

          actualOpen:
            openAt,

          closeDeltaSeconds:
            closeAt
              ? Math.round(
                  (closeAt.getTime() -
                    predictedClose.getTime()) /
                    1000
                )
              : null,

          openDeltaSeconds:
            openAt
              ? Math.round(
                  (openAt.getTime() -
                    predictedOpen.getTime()) /
                    1000
                )
              : null,

          measuredDurationSeconds:
            closeAt &&
            openAt
              ? Math.round(
                  (openAt.getTime() -
                    closeAt.getTime()) /
                    1000
                )
              : null,

          trains:
            phase.trains,
        };
      }
    );

  return Response.json(
    rows
  );
}