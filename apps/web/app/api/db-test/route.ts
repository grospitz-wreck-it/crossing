export async function GET() {
  const eva = "8003295"; // Kirchlengern

  const now = new Date();

  const hour = now
    .toISOString()
    .slice(0, 13)
    .replace(/[-:]/g, "");

  const url =
    `https://apis.deutschebahn.com/db-api-marketplace/apis/timetables/v1/plan/${eva}/${hour}`;

  const res = await fetch(url, {
    headers: {
      "DB-Client-Id":
        process.env.DB_CLIENT_ID!,
      "DB-Api-Key":
        process.env.DB_API_KEY!,
    },
    cache: "no-store",
  });

  const text = await res.text();

  return new Response(text, {
    headers: {
      "Content-Type": "text/xml",
    },
  });
}
