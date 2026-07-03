import {
  getDepartures,
} from "../../../../../packages/db-api-client/src/irisDepartures";

import {
  parseIrisDepartures,
} from "../../../../../packages/db-api-client/src/parseIrisDepartures";

import {
  crossings,
} from "../../../../../packages/prediction-engine/src/crossings";

import {
  getCrossingDirection,
} from "../../../../../packages/prediction-engine/src/getCrossingDirection";

import {
  getTriggerStop,
} from "../../../../../packages/prediction-engine/src/getTriggerStop";

import {
  findTriggerStopInRoute,
} from "../../../../../packages/prediction-engine/src/findTriggerStopInRoute";

import {
  isRelevantForCrossing,
} from "../../../../../packages/prediction-engine/src/isRelevantForCrossing";

export async function GET() {
  const data =
    await getDepartures(
      "8000059"
    );

  const departures =
    parseIrisDepartures(
      data
    );

  const crossing =
    crossings.find(
      (c) =>
        c.id ===
        "kirchlengern"
    )!;

  const relevant =
    departures.filter((train) =>
      isRelevantForCrossing(
        train.route,
        crossing
      )
    );

  const crossingTrains =
    relevant.map((train) => {
      const direction =
        getCrossingDirection(
          train.route
        );

      const triggerStop =
        getTriggerStop(
          direction,
          crossing
        );

      const triggerIndex =
        triggerStop
          ? findTriggerStopInRoute(
              train.route,
              triggerStop
            )
          : -1;

      return {
        journeyNumber:
          train.journeyNumber,

        line: train.line,

        category:
          train.category,

        destination:
          train.destination,

        delayMinutes:
          train.delay,

        direction,

        triggerStop,

        triggerIndex,

        route:
          train.route,
      };
    });

  console.log(
    "CROSSING TRAINS"
  );

  console.log(
    JSON.stringify(
      crossingTrains,
      null,
      2
    )
  );

  return Response.json({
    total:
      departures.length,

    relevant:
      relevant.length,

    crossingTrains,
  });
}