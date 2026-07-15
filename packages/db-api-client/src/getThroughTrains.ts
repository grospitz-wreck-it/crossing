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

  initialDepartureDate: [
    string,
    string,
  ];

  destination: string;

  delay: number;

  route: string[];

  platform?: string;

  observationEva: string;

  observationStation: string;

  trackDistanceMeters: number;

  fallbackOffsetSeconds: number;
direction:
  | "eastbound"
  | "westbound";
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
    console.log(
      `\n--- Observation EVA ${rule.observationEva} (${rule.observationStation}) ---`
    );

    const rawDepartures = await getDepartures(
  rule.observationEva
);

const parsed =
  parseIrisDepartures(rawDepartures);


const matching = parsed.filter((train) => {
  // Nur gewünschte Zugkategorien
  if (!rule.categories.includes(train.category)) {
    return false;
  }

  // Zug muss alle Pflicht-Halte enthalten
  const hasRequiredRoute =
    crossing.requiredRouteStops.every(
      (requiredStop) =>
        train.route.includes(requiredStop)
    );

  if (!hasRequiredRoute) {
    return false;
  }

  // Richtung anhand des Zielbahnhofs
  if (
    rule.direction === "westbound" &&
    train.destination !== "Amsterdam Centraal"
  ) {
    return false;
  }

  if (
    rule.direction === "eastbound" &&
    train.destination !== "Berlin Südkreuz"
  ) {
    return false;
  }

  return true;
});

console.log(
  `=== ${rule.observationStation} ===`
);

console.log(
  "Alle ICE-Kandidaten:"
);

console.dir(
  parsed
    .filter(
      (t) =>
        rule.categories.includes(
          t.category
        )
    )
    .map((t) => ({
      line: t.line,
      destination:
        t.destination,
      route: t.route,
    })),
  { depth: null }
);

    departures.push(
      ...matching.map((train) => ({
        type: "through" as const,
        line: train.line,
        category: train.category,
        journeyNumber: train.journeyNumber,
        initialDepartureDate: train.initialDepartureDate,
        destination: train.destination,
        delay: train.delay,
        route: train.route,
        platform: train.platform,
        observationEva: rule.observationEva,
        observationStation: rule.observationStation,
        trackDistanceMeters: rule.trackDistanceMeters,
        fallbackOffsetSeconds: rule.fallbackOffsetSeconds,
        direction: rule.direction,
      }))
    );
  }



  const uniqueDepartures = Array.from(
    new Map(
      departures.map((train) => [
        `${train.category}-${train.journeyNumber}`,
        train,
      ])
    ).values()
  );

  const result = (
  await Promise.all(
    uniqueDepartures.map(
      async (train): Promise<ThroughTrain | null> => {
        console.log(
          `\n===== ${train.category} ${train.journeyNumber} (${train.line}) =====`
        );

        try {

          const journey =
            await findJourney(
              train.category,
              train.journeyNumber,
              train.initialDepartureDate,
              train.observationEva
            );

          const raw =
            journey?.[0]?.result?.data;

          if (
            !raw ||
            raw === "[null]"
          ) {
            return null;
          }

          let parsedJourney: any;

          try {
            parsedJourney =
              JSON.parse(raw);
          } catch {
          
            return null;
          }

          const journeyRef =
            parsedJourney?.[1]?.journeyId;

          const journeyId =
            parsedJourney?.[
              journeyRef
            ];

          if (!journeyId) {
            
            return null;
          }

          const livePosition =
            await getJourneyPosition(
              journeyId
            );

          console.log(
            "LivePosition:",
            livePosition
          );

          return {
            ...train,
            journeyId,
            livePosition,
          };
        } catch (error) {
          console.error(
            `${train.category} ${train.journeyNumber}`,
            error
          );

          return null;
        }
      }
    )
  )
).filter(
  (
    train
  ): train is ThroughTrain =>
    train !== null
);

console.log(
  result.map((t) => ({
    line: t.line,
    category: t.category,
    journeyId: t.journeyId,
    live:
      t.livePosition !== null,
  }))
);

if (result.length === 0) {
  console.warn(
    "getThroughTrains(): keine Through-Trains gefunden"
  );
  return [];
}

return result;
}