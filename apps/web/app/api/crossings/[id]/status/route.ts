import { getDepartures } from "../../../../../../../packages/db-api-client/src/irisDepartures";

import { parseIrisDepartures } from "../../../../../../../packages/db-api-client/src/parseIrisDepartures";

import { findJourney } from "../../../../../../../packages/db-api-client/src/journeyFind";

import { getTrainContext } from "../../../../../../../packages/db-api-client/src/journey";

import { crossings } from "../../../../../../../packages/crossing-model/src/crossings";

import { getCrossingDirection } from "../../../../../../../packages/prediction-engine/src/getCrossingDirection";

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

  const departures =
    parseIrisDepartures(
      await getDepartures(
        crossing.eva
      )
    );

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

  direction:
    getCrossingDirection(
      train.route
    ),

  delayMinutes:
    train.delay,

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

  const nextTrain =
  upcoming[0];

let state = "OPEN";

let nextCloseIn = 0;
let nextOpenIn = 0;

let phaseStart:
  string | null = null;

let phaseEnd:
  string | null = null;

if (nextTrain) {
  const crossingTime =
    new Date(
      nextTrain.crossingTime
    );

  const closeAt =
    new Date(
      crossingTime.getTime() -
      crossing.closeOffsetSeconds *
        1000
    );

  const openAt =
    new Date(
      crossingTime.getTime() +
      crossing.openOffsetSeconds *
        1000
    );

  phaseStart =
    closeAt.toISOString();

  phaseEnd =
    openAt.toISOString();

  const now =
    Date.now();

  if (
    now <
    closeAt.getTime()
  ) {
    state = "OPEN";

    nextCloseIn =
      Math.floor(
        (
          closeAt.getTime() -
          now
        ) / 1000
      );
  } else if (
    now <
    openAt.getTime()
  ) {
    state = "CLOSED";

    nextOpenIn =
      Math.floor(
        (
          openAt.getTime() -
          now
        ) / 1000
      );
  }
}

  return Response.json({
    crossing: {
      id:
        crossing.id,

      name:
        crossing.name,

      lat:
        crossing.lat,

      lon:
        crossing.lon,
    },

    state,

    nextCloseIn,

    nextOpenIn,

    phase: {
  start:
    phaseStart,

  end:
    phaseEnd,

  trains:
    nextTrain
      ? [nextTrain]
      : [],
},

    trainCount:
      trains.length,

    trains,
  });
}