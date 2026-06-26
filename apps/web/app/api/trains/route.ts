import { parseTimetable } from "../../lib/parseTimetable";

export async function GET() {
  const eva = "8003288"; // später richtige EVA

  const now = new Date();

  const year = String(
    now.getUTCFullYear()
  ).slice(-2);

  const month = String(
    now.getUTCMonth() + 1
  ).padStart(2, "0");

  const day = String(
    now.getUTCDate()
  ).padStart(2, "0");

  const hour = String(
    now.getUTCHours()
  ).padStart(2, "0");

  const date =
    `${year}${month}${day}`;

  const url =
    `https://apis.deutschebahn.com/db-api-marketplace/apis/timetables/v1/plan/${eva}/${date}/${hour}`;

  const res = await fetch(url, {
    headers: {
      "DB-Client-Id":
        process.env.DB_CLIENT_ID!,
      "DB-Api-Key":
        process.env.DB_API_KEY!,
    },
    cache: "no-store",
  });

  const xml =
    await res.text();

  const trains =
    parseTimetable(xml);

  return Response.json({
    count: trains.length,
    trains,
  });
}