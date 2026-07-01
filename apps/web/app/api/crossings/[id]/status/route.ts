import { crossings } from "../../../../lib/crossings";

import { parseTimetable } from "../../../../lib/parseTimetable";

import { predictCrossingWindows } from "../../../../lib/predictCrossingWindows";

import { mergeCrossingWindows } from "../../../../lib/mergeCrossingWindows";

import { getCurrentPhase } from "../../../../lib/getCurrentPhase";

import { parseDbTime } from "../../../../lib/getNextTrain";

export async function GET(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      id: string;
    }>;
  }
) {
  const { id } =
    await params;

  const crossing =
    crossings[
      id as keyof typeof crossings
    ];

  if (!crossing) {
    return Response.json(
      {
        error:
          "Crossing not found",
      },
      {
        status: 404,
      }
    );
  }

  const now =
    new Date();

  const year =
    String(
      now.getUTCFullYear()
    ).slice(-2);

  const month =
    String(
      now.getUTCMonth() +
        1
    ).padStart(2, "0");

  const day =
    String(
      now.getUTCDate()
    ).padStart(2, "0");

  const hour =
    String(
      now.getUTCHours()
    ).padStart(2, "0");

  const date =
    `${year}${month}${day}`;

  const nextHourDate =
  new Date(
    now.getTime() +
      60 * 60 * 1000
  );

const nextYear =
  String(
    nextHourDate.getUTCFullYear()
  ).slice(-2);

const nextMonth =
  String(
    nextHourDate.getUTCMonth() +
      1
  ).padStart(2, "0");

const nextDay =
  String(
    nextHourDate.getUTCDate()
  ).padStart(2, "0");

const nextHour =
  String(
    nextHourDate.getUTCHours()
  ).padStart(2, "0");

const nextDate =
  `${nextYear}${nextMonth}${nextDay}`;

const urlCurrent =
  `https://apis.deutschebahn.com/db-api-marketplace/apis/timetables/v1/plan/${crossing.eva}/${date}/${hour}`;

const urlNext =
  `https://apis.deutschebahn.com/db-api-marketplace/apis/timetables/v1/plan/${crossing.eva}/${nextDate}/${nextHour}`;

const headers = {
  "DB-Client-Id":
    process.env
      .DB_CLIENT_ID!,

  "DB-Api-Key":
    process.env
      .DB_API_KEY!,
};

const [
  resCurrent,
  resNext,
] = await Promise.all([
  fetch(urlCurrent, {
    headers,
    cache:
      "no-store",
  }),

  fetch(urlNext, {
    headers,
    cache:
      "no-store",
  }),
]);

const [
  xmlCurrent,
  xmlNext,
] = await Promise.all([
  resCurrent.text(),
  resNext.text(),
]);

const trains = [
  ...parseTimetable(
    xmlCurrent
  ),
  ...parseTimetable(
    xmlNext
  ),
];
console.log(
  "PARSED TRAINS",
  trains.slice(0, 10).map(
    (t) => ({
      line: t.line,
      arrival: t.arrival,
      parsedArrival:
        t.arrival
          ? parseDbTime(
              t.arrival
            ).toString()
          : null,
      parsedIso:
        t.arrival
          ? parseDbTime(
              t.arrival
            ).toISOString()
          : null,
    })
  )
);
  const nowMs =
    Date.now();

  const upcomingTrains =
    trains.filter(
      (train) => {
        if (
          !train.arrival
        ) {
          return false;
        }

        return (
          parseDbTime(
            train.arrival
          ).getTime() >
          nowMs
        );
      }
    );
console.log(
  "UPCOMING",
  upcomingTrains.map(
    (t) => ({
      line: t.line,
      arrival: t.arrival,
    })
  )
);
  const windows =
    predictCrossingWindows(
      upcomingTrains
    );

  const merged =
    mergeCrossingWindows(
      windows
    );

  const phase =
    getCurrentPhase(
      merged
    );

  return Response.json({
  crossing:
    crossing.name,

  debugNow:
    new Date().toString(),

  debugUtcNow:
    new Date().toISOString(),

  debugHour:
    hour,

  debugDate:
    date,

  debugUrlCurrent:
    urlCurrent,

  debugUrlNext:
    urlNext,

  totalTrainsLoaded:
    trains.length,

  trainsFound:
    upcomingTrains.length,

  windowsFound:
    windows.length,

  mergedFound:
    merged.length,

  ...phase,
});
}