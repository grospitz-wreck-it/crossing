import {
  fetchBahnExpertJson,
} from "./bahnExpertHttp";

const BASE_URL =
  "https://bahn.expert";

export async function findJourney(
  category: string,
  journeyNumber: number,
  evaNumbers: string | string[]
) {
  const evas = Array.isArray(evaNumbers)
    ? evaNumbers
    : [evaNumbers];

  for (const evaNumber of evas) {
    const input = {
      0: JSON.stringify([
        {
          journeyNumber: 1,
          category: 2,
          evaNumberAlongRoute: 3,
          limit: 4,
        },
        journeyNumber,
        category,
        evaNumber,
        1,
      ]),
    };

    const url =
      `${BASE_URL}/rpc/journey.find` +
      `?batch=1&input=` +
      encodeURIComponent(
        JSON.stringify(input)
      );

    const data =
      await fetchBahnExpertJson(
        url,
        "journey.find"
      );

    if (data?.[0]?.result?.data) {
      return data;
    }
  }

  return [];
}
