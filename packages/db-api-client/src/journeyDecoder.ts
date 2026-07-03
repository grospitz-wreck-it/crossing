export type JourneyStop = {
  name: string;
  delay: number;
  scheduledTime?: string;
  realtimeTime?: string;
};

export type DecodedJourney = {
  currentStop?: string;
  nextStop?: string;
  destination?: string;
  delayMinutes?: number;

  stops: string[];

  stopDetails: JourneyStop[];
};

type StopInfo = {
  name: string;
  delay: number;
  scheduledTime?: string;
  realtimeTime?: string;
};

export function decodeJourney(
  journeyData: any
): DecodedJourney | null {
  try {
    const raw =
      journeyData?.[0]?.result?.data;

    if (!raw) {
      return null;
    }

    const parsed =
      JSON.parse(raw);

    const stopInfos: StopInfo[] =
      [];

    for (
      let i = 0;
      i < parsed.length;
      i++
    ) {
      const item =
        parsed[i];

      if (
        !item ||
        typeof item !==
          "object"
      ) {
        continue;
      }

      if (
        !(
          "stopPlace" in item
        ) ||
        !(
          "arrival" in item
        )
      ) {
        continue;
      }

      try {
        const stopPlace =
          parsed[
            item.stopPlace
          ];

        const stopName =
          parsed[
            stopPlace?.name
          ];

        const arrival =
          parsed[
            item.arrival
          ];

        const scheduledTime =
          parsed?.[
            arrival?.scheduledTime
          ];

        const realtimeTime =
          parsed?.[
            arrival?.time
          ];

        const delay =
          Number(
            arrival?.delay ?? 0
          );

        if (
          typeof stopName ===
          "string"
        ) {
          stopInfos.push({
            name: stopName,
            delay,
            scheduledTime:
              Array.isArray(
                scheduledTime
              )
                ? scheduledTime[1]
                : undefined,
            realtimeTime:
              Array.isArray(
                realtimeTime
              )
                ? realtimeTime[1]
                : undefined,
          });
        }
      } catch {
        // ignore invalid stop
      }
    }

    const stops =
      stopInfos.map(
        (s) => s.name
      );
const now = Date.now();

let currentIndex = -1;

for (
  let i = 0;
  i < stopInfos.length;
  i++
) {
  const stop =
    stopInfos[i];

  if (
    !stop.realtimeTime
  ) {
    continue;
  }

  const stopTime =
    new Date(
      stop.realtimeTime
    ).getTime();

  if (
    stopTime <= now
  ) {
    currentIndex = i;
  }
}

let currentStop:
  string | undefined;

let nextStop:
  string | undefined;

let delayMinutes = 0;

if (currentIndex >= 0) {
  currentStop =
    stopInfos[
      currentIndex
    ].name;

  delayMinutes =
    stopInfos[
      currentIndex
    ].delay;

  if (
    currentIndex + 1 <
    stopInfos.length
  ) {
    nextStop =
      stopInfos[
        currentIndex + 1
      ].name;
  }
}

    console.log(
      "STOP COUNT:",
      stopInfos.length
    );

    console.log(
      "FIRST 5 STOPS:",
      stopInfos.slice(
        0,
        5
      )
    );

    console.log(
      "LAST 5 STOPS:",
      stopInfos.slice(
        -5
      )
    );

    return {
  currentStop,
  nextStop,

  destination:
    stops.length > 0
      ? stops[stops.length - 1]
      : undefined,

  delayMinutes,

  stops,

  stopDetails:
    stopInfos,
};
  } catch (error) {
    console.error(
      "decodeJourney failed",
      error
    );

    return null;
  }
}