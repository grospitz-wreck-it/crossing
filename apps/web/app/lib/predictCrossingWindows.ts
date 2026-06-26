import { parseDbTime } from "./getNextTrain";

export interface CrossingWindow {
  trainNumber: string;
  line: string;
  platform: string;

  arrival?: string;
  departure?: string;

  arrivalStations?: string[];
  departureStations?: string[];

  warningSeconds: number;
  closedSeconds: number;

  start: Date;
  end: Date;
}

function getProfile(
  line?: string
) {
  if (!line) {
    return {
      warningSeconds: 60,
      closedSeconds: 90,
    };
  }

  if (
    line.startsWith("ICE")
  ) {
    return {
      warningSeconds: 45,
      closedSeconds: 75,
    };
  }

  if (
    line.startsWith("IC")
  ) {
    return {
      warningSeconds: 50,
      closedSeconds: 80,
    };
  }

  if (
    line.startsWith("RE")
  ) {
    return {
      warningSeconds: 60,
      closedSeconds: 95,
    };
  }

  if (
    line.startsWith("RB")
  ) {
    return {
      warningSeconds: 70,
      closedSeconds: 110,
    };
  }

  if (
    line.startsWith("S")
  ) {
    return {
      warningSeconds: 75,
      closedSeconds: 120,
    };
  }

  return {
    warningSeconds: 60,
    closedSeconds: 90,
  };
}

export function predictCrossingWindows(
  trains: any[]
): CrossingWindow[] {
  return trains
    .filter(
      (t) => t.arrival
    )
    .map((train) => {
      const arrival =
        parseDbTime(
          train.arrival
        );
const now =
  Date.now();

if (
  arrival.getTime() <
  now - 5 * 60 * 1000
) {
  return null;
}
      const profile =
        getProfile(
          train.line
        );

      const start =
        new Date(
          arrival.getTime() -
            profile.warningSeconds *
              1000
        );

      const end =
        new Date(
          arrival.getTime() +
            profile.closedSeconds *
              1000
        );

      return {
        trainNumber:
          train.trainNumber,

        line:
          train.line,

        platform:
          train.platform,

        arrival:
          train.arrival,

        departure:
          train.departure,

        arrivalStations:
          train.arrivalStations,

        departureStations:
          train.departureStations,

        warningSeconds:
          profile.warningSeconds,

        closedSeconds:
          profile.closedSeconds,

        start,

        end,
      };
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        a.start.getTime() -
        b.start.getTime()
    );
}