import { getDepartures } from "../../../../../../../packages/db-api-client/src/irisDepartures";
import { parseIrisDepartures } from "../../../../../../../packages/db-api-client/src/parseIrisDepartures";

import { findJourney } from "../../../../../../../packages/db-api-client/src/journeyFind";
import { getTrainContext } from "../../../../../../../packages/db-api-client/src/journey";
import { getCrossingDirection } from "../../../../../../../packages/prediction-engine/src/getCrossingDirection";
import { crossings } from "../../../../../../../packages/crossing-model/src/crossings";


let cachedResponse: any = null;

let cacheTimestamp = 0;

const CACHE_TTL = 30_000;
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
const now = Date.now();

if (
  cachedResponse &&
  now - cacheTimestamp <
    CACHE_TTL
) {
  console.log("CACHE HIT");

  return Response.json(
    cachedResponse
  );
}

console.log("CACHE MISS");
  const crossing =
  crossings.find(
    (c) =>
      c.id === id
  );
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

  let departures = [];

try {
  departures =
    parseIrisDepartures(
      await getDepartures(
        crossing.eva
      )
    );
} catch (error) {
  console.error(
    "Failed to load departures:",
    error
  );

  return Response.json({
    crossing: {
      id: crossing.id,
      name: crossing.name,
      lat: crossing.lat,
      lon: crossing.lon,
    },

    state: "UNKNOWN",

    nextCloseIn: 0,
    nextOpenIn: 0,

    phase: null,

    closureCount: 0,
    closures: [],

    trainCount: 0,
    trains: [],
  });
}

  const trains = [];

  for (const train of departures) {
    try {
      const journey =
        await findJourney(
          train.category,
          train.journeyNumber,
          crossing.eva
        );

      const parsedJourney =
        JSON.parse(
          journey?.[0]
            ?.result?.data
        );

      const journeyRef =
        parsedJourney?.[1]
          ?.journeyId;

      const journeyId =
        parsedJourney?.[
          journeyRef
        ];

      if (!journeyId) {
        continue;
      }

      const context =
        await getTrainContext(
          journeyId
        );

      const crossingStop =
        context.stopDetails?.find(
          (stop) =>
            stop.name ===
            crossing.name
        );

    
      if (
        !crossingStop?.realtimeTime
      ) {
        continue;
      }

      const crossingTime =
        new Date(
          crossingStop.realtimeTime
        );

      const etaSeconds =
        Math.floor(
          (
            crossingTime.getTime() -
            Date.now()
          ) / 1000
        );

// TODO:
// Aktuell gelten alle Züge auf
// Bahnsteiggleis 1 oder 2 als haltend.
//
// Sobald die Journey-Daten getrennte
// Ankunfts-/Abfahrtszeiten liefern,
// wird diese Logik ersetzt.
const isStoppingTrain =
  train.platform === "1" ||
  train.platform === "2";

      trains.push({
  journeyId,

  line:
    train.line,

  category:
    train.category,

  journeyNumber:
    train.journeyNumber,

  origin:
    context.stopDetails?.[0]
      ?.name,

  destination:
    context.stopDetails?.[
      context.stopDetails.length - 1
    ]?.name,

  platform:
    train.platform,
// TODO:
// Aktuell gelten alle Regionalzüge auf
// Bahnsteiggleisen als haltend.
// Später anhand der Journey-Daten
// (Ankunft/Abfahrt) automatisch erkennen.
isStoppingTrain,

  direction:
    getCrossingDirection(
      train.route
    ),
directionLabel:
  context.stopDetails?.length
    ? `Richtung ${
        context.stopDetails[
          context.stopDetails.length - 1
        ].name
      }`
    : null,
  delayMinutes:
  crossingStop.scheduledTime &&
  crossingStop.realtimeTime
    ? Math.max(
        0,
        Math.round(
          (
            new Date(
              crossingStop.realtimeTime
            ).getTime()
            -
            new Date(
              crossingStop.scheduledTime
            ).getTime()
          ) / 60000
        )
      )
    : 0,

  currentStop:
    context.currentStop,

  nextStop:
    context.nextStop,

  crossingTime:
    crossingTime.toISOString(),

  arrival:
    crossingTime.toISOString(),

  etaSeconds,

  stopDetails:
    context.stopDetails,
});
    } catch (error) {
      console.error(
        train.category,
        train.journeyNumber,
        error
      );
    }
  }
  const upcoming =
  trains
    .filter(
      (t) =>
        t.etaSeconds > 0
    )
    .sort(
      (a, b) =>
        a.etaSeconds -
        b.etaSeconds
    );

const MERGE_GAP_SECONDS =
  30;

const closures: {
  start: Date;
  end: Date;
  trains: any[];
}[] = [];

for (const train of upcoming) {
  const crossingTime =
    new Date(
      train.crossingTime
    );

  let closeOffset =
    crossing.closeOffsetSeconds;

  let openOffset =
    crossing.openOffsetSeconds;

  const rule =
    (crossing as any).rules?.find(
      (rule: any) =>
        rule.platform ===
          train.platform &&
        rule.stopping ===
          train.isStoppingTrain
    );

  if (rule) {
    closeOffset =
      rule.closeOffsetSeconds ??
      closeOffset;

    openOffset =
      rule.openOffsetSeconds ??
      openOffset;
  }

  const closeAt =
    new Date(
      crossingTime.getTime() -
        closeOffset * 1000
    );

  const openAt =
    new Date(
      crossingTime.getTime() +
        openOffset * 1000
    );

  const last =
    closures[
      closures.length - 1
    ];

  if (
    !last ||
    closeAt.getTime() >
      last.end.getTime() +
        MERGE_GAP_SECONDS *
          1000
  ) {
    closures.push({
      start: closeAt,
      end: openAt,
      trains: [train],
    });
  } else {
    if (
      openAt.getTime() >
      last.end.getTime()
    ) {
      last.end = openAt;
    }

    last.trains.push(
      train
    );
  }
}

const nextClosure =
  closures[0];
const MAX_LOOKAHEAD_MINUTES =
  30;

const visibleClosures =
  closures.filter(
    (closure) =>
      closure.start.getTime() <=
      Date.now() +
        MAX_LOOKAHEAD_MINUTES *
          60 *
          1000
  );
let state = "OPEN";

let nextCloseIn = 0;
let nextOpenIn = 0;

let phaseStart:
  string | null = null;

let phaseEnd:
  string | null = null;

if (nextClosure) {
  phaseStart =
    nextClosure.start.toISOString();

  phaseEnd =
    nextClosure.end.toISOString();

  const now =
    Date.now();

  if (
    now <
    nextClosure.start.getTime()
  ) {
    state = "OPEN";

    nextCloseIn =
      Math.floor(
        (
          nextClosure.start.getTime() -
          now
        ) / 1000
      );
  } else if (
    now <
    nextClosure.end.getTime()
  ) {
    state = "CLOSED";

    nextOpenIn =
      Math.floor(
        (
          nextClosure.end.getTime() -
          now
        ) / 1000
      );
  }
}

const response = {
  crossing: {
    id: crossing.id,
    name: crossing.name,
    lat: crossing.lat,
    lon: crossing.lon,
  },

  state,

  nextCloseIn,

  nextOpenIn,

  phase: nextClosure
    ? {
        start: phaseStart,

        end: phaseEnd,

        durationMinutes:
          Math.round(
            (
              nextClosure.end.getTime() -
              nextClosure.start.getTime()
            ) /
              60000
          ),

        trainCount:
          nextClosure.trains
            .length,

        trains:
          nextClosure.trains,
      }
    : null,

  closureCount:
  visibleClosures.length,

closures:
  visibleClosures.map(
    (closure) => ({
      start:
        closure.start.toISOString(),

      end:
        closure.end.toISOString(),

      durationMinutes:
        Math.round(
          (
            closure.end.getTime() -
            closure.start.getTime()
          ) / 60000
        ),

      trainCount:
        closure.trains
          .length,

      trains:
        closure.trains,
    })
  ),

trainCount:
  trains.length,

trains,
};

cachedResponse =
  response;

cacheTimestamp =
  Date.now();

return Response.json(
  response
);
}