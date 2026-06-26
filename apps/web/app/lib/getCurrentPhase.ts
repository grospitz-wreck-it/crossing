import { createHash } from "crypto";

export interface CurrentPhase {
  predictionId: string;

  state: "OPEN" | "CLOSED";

  nextCloseIn: number | null;

  nextOpenIn: number | null;

  phase: {
    start: string;
    end: string;

    trains: {
  line: string;

  trainNumber: string;

  platform: string;

  arrival?: string;

  departure?: string;

  arrivalStations?: string[];

  departureStations?: string[];
}[];
  } | null;
}

function buildPredictionId(
  window: any
) {
  return createHash("sha1")
    .update(
      JSON.stringify({
        start:
          window.start.toISOString(),

        end:
          window.end.toISOString(),

        trains:
          window.trains,
      })
    )
    .digest("hex");
}

export function getCurrentPhase(
  mergedWindows: any[]
): CurrentPhase {
  const now = Date.now();

  const current =
    mergedWindows.find(
      (window) =>
        now >=
          window.start.getTime() &&
        now <=
          window.end.getTime()
    );

  if (current) {
    return {
      predictionId:
        buildPredictionId(
          current
        ),

      state: "CLOSED",

      nextCloseIn: null,

      nextOpenIn: Math.max(
        0,
        Math.floor(
          (current.end.getTime() -
            now) /
            1000
        )
      ),

      phase: {
        start:
          current.start.toISOString(),

        end:
          current.end.toISOString(),

        trains:
          current.trains,
      },
    };
  }

  const next =
    mergedWindows.find(
      (window) =>
        window.start.getTime() >
        now
    );

  if (!next) {
    return {
      predictionId: "",

      state: "OPEN",

      nextCloseIn: null,

      nextOpenIn: null,

      phase: null,
    };
  }

  return {
    predictionId:
      buildPredictionId(
        next
      ),

    state: "OPEN",

    nextCloseIn: Math.max(
      0,
      Math.floor(
        (next.start.getTime() -
          now) /
          1000
      )
    ),

    nextOpenIn: null,

    phase: {
      start:
        next.start.toISOString(),

      end:
        next.end.toISOString(),

      trains:
        next.trains,
    },
  };
}