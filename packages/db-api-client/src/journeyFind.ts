import {
  fetchBahnExpertJson,
} from "./bahnExpertHttp";

const BASE_URL =
  "https://bahn.expert";

export async function findJourney(
  category: string,
  journeyNumber: number,
  initialDepartureDate: [string, string],
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
          initialDepartureDate: 3,
          evaNumberAlongRoute: 4,
          limit: 5,
        },
        journeyNumber,
        category,
        initialDepartureDate,
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

    if (
      data?.[0]?.result?.data
    ) {
      return data;
    }
  }

  return [];
}