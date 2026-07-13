import type {
  Crossing,
} from "../../crossing-model/src/types";

import { getDepartures } from "./irisDepartures";
import { parseIrisDepartures } from "./parseIrisDepartures";
import { findJourney } from "./journeyFind";
import { getJourneyPosition } from "./journeyPosition";

export type ThroughTrain = {
  type: "through";

  line: string;

  category: string;

  journeyNumber: number;

  destination: string;

  delay: number;

  route: string[];

  platform?: string;

  observationEva: string;
  observationStation: string;
  trackDistanceMeters: number;

  fallbackOffsetSeconds: number;

  journeyId: string;

  livePosition: {
    latitude: number;
    longitude: number;
    time: string;
    speed: number;
    metaSource: string;
  } | null;
};

export async function getThroughTrains(
  crossing: Crossing
): Promise<ThroughTrain[]> {
  if (!crossing.throughRules?.length) {
    return [];
  }

  const departures: Omit<
    ThroughTrain,
    "journeyId" | "livePosition"
  >[] = [];

  for (const rule of crossing.throughRules) {
    const parsed =
      parseIrisDepartures(
        await getDepartures(
          rule.observationEva
        )
      );

    departures.push(
      ...parsed
        .filter((train) =>
          rule.categories.includes(
            train.category
          )
        )
        .map((train) => ({
          type: "through" as const,

          line: train.line,

          category:
            train.category,

          journeyNumber:
            train.journeyNumber,

          destination:
            train.destination,

          delay:
            train.delay,

          route:
            train.route,

          platform:
            train.platform,

          observationEva:
            rule.observationEva,
          observationStation:
  rule.observationStation,
          trackDistanceMeters:
            rule.trackDistanceMeters,

          fallbackOffsetSeconds:
            rule.fallbackOffsetSeconds,
        }))
    );
  }

  const uniqueDepartures =
    Array.from(
      new Map(
        departures.map((train) => [
          `${train.category}-${train.journeyNumber}`,
          train,
        ])
      ).values()
    );

  const result: ThroughTrain[] = [];

  for (const train of uniqueDepartures) {

  await new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        250
      )
  );

  try {
      const journey =
        await findJourney(
          train.category,
          train.journeyNumber,
          train.observationEva
        );

      const raw =
  journey?.[0]
    ?.result?.data;

if (
  !raw ||
  raw === "[null]"
) {
  console.log(
    "No journey data:",
    train.line,
    train.journeyNumber
  );

  continue;
}

let parsedJourney: any;

try {
  parsedJourney =
    JSON.parse(raw);
} catch (error) {
  console.error(
    "Invalid journey:",
    train.line,
    train.journeyNumber
  );

  console.log(raw);

  continue;
}

const journeyRef =
  parsedJourney?.[1]
    ?.journeyId;

      const journeyId =
        parsedJourney?.[
          journeyRef
        ];

      if (!journeyId) {
        console.log(
          "No journey:",
          train.line
        );

        continue;
      }

      const livePosition =
        await getJourneyPosition(
          journeyId
        );

      result.push({
        ...train,

        journeyId,

        livePosition,
      });
    } catch (error) {
  console.error(
    "TRAIN:",
    train.line,
    train.journeyNumber
  );

  console.error(error);

  if (error instanceof Error) {
    console.error(error.stack);
  }
}
  }

  console.log(
    "Resolved through trains:",
    result.map((t) => ({
      line: t.line,

      journeyId:
        t.journeyId,

      livePosition:
        t.livePosition,
    }))
  );

  return result;
}