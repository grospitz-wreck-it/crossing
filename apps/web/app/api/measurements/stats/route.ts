import { db } from "@/app/lib/db";

export async function GET() {
  const result =
    await db.execute(
      `
      SELECT *
      FROM measurements
      ORDER BY id DESC
    `
    );

  const grouped =
    new Map<
      string,
      {
        predictionId: string;

        closeAt: string | null;

        openAt: string | null;

        phase: any;
      }
    >();

  for (const row of result
    .rows as any[]) {
    const predictionId =
      row.prediction_id;

    if (
      !grouped.has(
        predictionId
      )
    ) {
      let phase = null;

      try {
        phase =
          JSON.parse(
            row.phase_json
          );
      } catch {
        phase = null;
      }

      grouped.set(
        predictionId,
        {
          predictionId,

          closeAt:
            null,

          openAt:
            null,

          phase,
        }
      );
    }

    const current =
      grouped.get(
        predictionId
      );

    if (!current) {
      continue;
    }

    if (
      row.event_type ===
      "close"
    ) {
      current.closeAt =
        row.actual_at;
    }

    if (
      row.event_type ===
      "open"
    ) {
      current.openAt =
        row.actual_at;
    }
  }

  const rows =
    Array.from(
      grouped.values()
    )
      .map(
        (
          row: any
        ) => {
          const predictedClose =
            row.phase?.start
              ? new Date(
                  row.phase.start
                )
              : null;

          const predictedOpen =
            row.phase?.end
              ? new Date(
                  row.phase.end
                )
              : null;

          const actualClose =
            row.closeAt
              ? new Date(
                  row.closeAt
                )
              : null;

          const actualOpen =
            row.openAt
              ? new Date(
                  row.openAt
                )
              : null;

          return {
            predictionId:
              row.predictionId,

            predictedClose,

            predictedOpen,

            actualClose,

            actualOpen,

            closeDeltaSeconds:
              predictedClose &&
              actualClose
                ? Math.round(
                    (actualClose.getTime() -
                      predictedClose.getTime()) /
                      1000
                  )
                : null,

            openDeltaSeconds:
              predictedOpen &&
              actualOpen
                ? Math.round(
                    (actualOpen.getTime() -
                      predictedOpen.getTime()) /
                      1000
                  )
                : null,

            measuredDurationSeconds:
              actualClose &&
              actualOpen
                ? Math.round(
                    (actualOpen.getTime() -
                      actualClose.getTime()) /
                      1000
                  )
                : null,

            trains:
              row.phase
                ?.trains ??
              [],

            trainCount:
              row.phase
                ?.trains
                ?.length ?? 0,
          };
        }
      )
      .sort(
        (a, b) => {
          const aTime =
            a.actualClose
              ? new Date(
                  a.actualClose
                ).getTime()
              : 0;

          const bTime =
            b.actualClose
              ? new Date(
                  b.actualClose
                ).getTime()
              : 0;

          return (
            bTime - aTime
          );
        }
      );

  return Response.json(
    rows
  );
}