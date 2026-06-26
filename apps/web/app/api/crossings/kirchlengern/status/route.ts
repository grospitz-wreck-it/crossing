import { crossings } from "../../../../lib/crossings";

import { parseTimetable } from "../../../../lib/parseTimetable";

import { predictCrossingWindows } from "../../../../lib/predictCrossingWindows";

import { mergeCrossingWindows } from "../../../../lib/mergeCrossingWindows";

import { getCurrentPhase } from "../../../../lib/getCurrentPhase";

import { parseDbTime } from "../../../../lib/getNextTrain";

export async function GET() {
  const crossing =
    crossings.kirchlengern;

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

  const url =
    `https://apis.deutschebahn.com/db-api-marketplace/apis/timetables/v1/plan/${crossing.eva}/${date}/${hour}`;

  const res =
    await fetch(url, {
      headers: {
        "DB-Client-Id":
          process.env
            .DB_CLIENT_ID!,

        "DB-Api-Key":
          process.env
            .DB_API_KEY!,
      },

      cache:
        "no-store",
    });

  const xml =
    await res.text();

  const trains =
    parseTimetable(xml);

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

    debugUrl:
      url,

    trainsFound:
      upcomingTrains.length,

    windowsFound:
      windows.length,

    mergedFound:
      merged.length,

    ...phase,
  });
}