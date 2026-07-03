import {
  decodeJourney,
} from "./journeyDecoder";

const BASE_URL =
  "https://bahn.expert";

export async function getJourney(
  journeyId: string
) {
  const input = {
    0: JSON.stringify([
      journeyId,
    ]),
    1: JSON.stringify([
      journeyId,
    ]),
  };

  const url =
    `${BASE_URL}/rpc/journey.detailsByJourneyId,journey.journeyPosition` +
    `?batch=1&input=` +
    encodeURIComponent(
      JSON.stringify(input)
    );

  const res = await fetch(
    url,
    {
      cache:
        "no-store",
    }
  );

  if (!res.ok) {
    throw new Error(
      `bahn.expert ${res.status}`
    );
  }

  return res.json();
}

export function extractPosition(
  journeyData: any
) {
  try {
    const raw =
      journeyData?.[1]
        ?.result?.data;

    if (
      !raw ||
      raw === "[null]"
    ) {
      return null;
    }

    const parsed =
      JSON.parse(raw);

    return {
      lon: parsed?.[1],
      lat: parsed?.[2],
      timestamp:
        parsed?.[3]?.[1] ??
        null,
    };
  } catch (error) {
    console.error(
      "extractPosition failed",
      error
    );

    return null;
  }
}

export async function getJourneyPosition(
  journeyId: string
) {
  const journey =
    await getJourney(
      journeyId
    );

  return extractPosition(
    journey
  );
}

export async function getTrainContext(
  journeyId: string
) {
  const journey =
    await getJourney(
      journeyId
    );

  const decoded =
    decodeJourney(
      journey
    );

  console.log(
    "DECODED",
    decoded
  );

  return {
  currentStop:
    decoded?.currentStop ??
    "unknown",

  nextStop:
    decoded?.nextStop ??
    null,

  finalDestination:
    decoded?.destination ??
    "unknown",

  delayMinutes:
    decoded?.delayMinutes ??
    0,

  stops:
    decoded?.stops ??
    [],

  stopDetails:
    decoded?.stopDetails ??
    [],
};
}