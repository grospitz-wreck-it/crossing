const BASE_URL =
  "https://bahn.expert";

export async function getDepartures(
  evaNumber: string
) {
  const input = {
    0: JSON.stringify([
      {
        evaNumber: 1,
        lookahead: 2,
        lookbehind: 3,
        startTime: -1,
      },
      evaNumber,
      150,
      10,
    ]),
  };

  const url =
    `${BASE_URL}/rpc/iris.departures` +
    `?batch=1&input=` +
    encodeURIComponent(
      JSON.stringify(input)
    );

  console.log(url);

  const res = await fetch(url, {
    cache: "no-store",
  });

  console.log(
    "STATUS:",
    res.status
  );

  const text =
    await res.text();

  console.log(
    "BODY:",
    text.slice(0, 2000)
  );

  if (!res.ok) {
    throw new Error(
      `iris.departures ${res.status}`
    );
  }

  return JSON.parse(text);
}