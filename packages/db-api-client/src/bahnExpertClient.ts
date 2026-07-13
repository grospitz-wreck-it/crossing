import {
  fetchBahnExpertJson,
} from "./bahnExpertHttp";

const BASE_URL = "https://bahn.expert";

export async function getDepartures(
  eva: string
) {
  const input = {
    0: JSON.stringify([
      {
        evaNumber: 1,
        lookahead: 2,
        lookbehind: 3,
        startTime: -1,
      },
      eva,
      150,
      10,
    ]),
  };

  const url =
    `${BASE_URL}/rpc/iris.departures?batch=1&input=` +
    encodeURIComponent(JSON.stringify(input));

  return fetchBahnExpertJson(
    url,
    "bahn.expert"
  );
}
