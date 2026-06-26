export interface MergedWindow {
  start: Date;
  end: Date;

  trains: {
    trainNumber: string;
    line: string;
    platform: string;

    arrival?: string;
    departure?: string;

    arrivalStations?: string[];
    departureStations?: string[];
  }[];
}

export function mergeCrossingWindows(
  windows: any[]
): MergedWindow[] {
  if (
    windows.length === 0
  ) {
    return [];
  }

  const merged: MergedWindow[] =
    [];

  let current: MergedWindow = {
    start:
      windows[0].start,

    end:
      windows[0].end,

    trains: [
      {
        trainNumber:
          windows[0]
            .trainNumber,

        line:
          windows[0].line,

        platform:
          windows[0]
            .platform,

        arrival:
          windows[0]
            .arrival,

        departure:
          windows[0]
            .departure,

        arrivalStations:
          windows[0]
            .arrivalStations,

        departureStations:
          windows[0]
            .departureStations,
      },
    ],
  };

  for (
    let i = 1;
    i < windows.length;
    i++
  ) {
    const next =
      windows[i];

    if (
      next.start <=
      current.end
    ) {
      if (
        next.end >
        current.end
      ) {
        current.end =
          next.end;
      }

      current.trains.push(
        {
          trainNumber:
            next.trainNumber,

          line:
            next.line,

          platform:
            next.platform,

          arrival:
            next.arrival,

          departure:
            next.departure,

          arrivalStations:
            next.arrivalStations,

          departureStations:
            next.departureStations,
        }
      );
    } else {
      merged.push(
        current
      );

      current = {
        start:
          next.start,

        end:
          next.end,

        trains: [
          {
            trainNumber:
              next.trainNumber,

            line:
              next.line,

            platform:
              next.platform,

            arrival:
              next.arrival,

            departure:
              next.departure,

            arrivalStations:
              next.arrivalStations,

            departureStations:
              next.departureStations,
          },
        ],
      };
    }
  }

  merged.push(
    current
  );

  return merged;
}