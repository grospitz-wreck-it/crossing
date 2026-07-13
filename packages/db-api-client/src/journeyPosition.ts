import {
  fetchBahnExpertJson,
} from "./bahnExpertHttp";

const BASE_URL =
  "https://bahn.expert";

export async function getJourneyPosition(
  journeyId: string
) {
  const input = {
    0: JSON.stringify([
      journeyId,
    ]),
  };

  const url =
    `${BASE_URL}/rpc/journey.journeyPosition` +
    `?batch=1&input=` +
    encodeURIComponent(
      JSON.stringify(input)
    );

  const data =
    await fetchBahnExpertJson(
      url,
      "journeyPosition"
    );

  console.log(
    "JOURNEY POSITION RAW"
  );

  console.log(
    JSON.stringify(
      data,
      null,
      2
    )
  );

  const raw =
    data?.[0]?.result?.data;

  console.log(
    "POSITION DATA STRING"
  );

  console.log(raw);

  if (!raw) {
    return null;
  }

  const parsed =
    JSON.parse(raw);

  console.log(
    "POSITION PARSED"
  );

  console.log(parsed);

  return parsed;
}
