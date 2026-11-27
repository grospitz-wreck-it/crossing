import { auth } from "../../../../../auth";
import { db } from "../../../../lib/db";

export const dynamic = "force-dynamic";

type FuelType = "e5" | "e10" | "diesel";
type Station = {
  id: string; name: string; brand?: string; street?: string; houseNumber?: string;
  place?: string; postCode?: number; dist?: number; lat?: number; lng?: number;
  isOpen?: boolean; e5?: number | false; e10?: number | false; diesel?: number | false;
};

async function ensureCache() {
  await db.execute(`CREATE TABLE IF NOT EXISTS fuel_price_cache (
    crossing_id TEXT PRIMARY KEY,
    payload_json TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS fuel_price_api_guard (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_request_at INTEGER NOT NULL
  )`);
}

function cheapest(stations: Station[], type: FuelType) {
  const available = stations
    .map((station) => ({ station, price: station[type] }))
    .filter((item): item is { station: Station; price: number } =>
      typeof item.price === "number" && Number.isFinite(item.price) && item.price > 0
    )
    .sort((a, b) => a.price - b.price);
  if (!available.length) return null;
  const { station, price } = available[0];
  return {
    price,
    station: {
      name: station.name,
      brand: station.brand || null,
      street: [station.street, station.houseNumber].filter(Boolean).join(" ") || null,
      place: station.place || null,
      postCode: station.postCode || null,
      distanceKm: typeof station.dist === "number" ? station.dist : null,
      isOpen: station.isOpen === true,
    },
    stationCount: available.length,
  };
}

export async function GET(request: Request, { params }: { params: Promise<{ crossingId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Nicht angemeldet" }, { status: 401 });

  const { crossingId } = await params;
  const type = new URL(request.url).searchParams.get("type") as FuelType | null;
  if (!type || !["e5", "e10", "diesel"].includes(type)) {
    return Response.json({ error: "Ungültige Spritsorte." }, { status: 400 });
  }

  const apiKey = process.env.TANKERKOENIG_API_KEY;
  if (!apiKey) return Response.json({ error: "Spritpreise sind noch nicht konfiguriert." }, { status: 503 });

  try {
    await ensureCache();
    const cached = await db.execute({
      sql: "SELECT payload_json, fetched_at FROM fuel_price_cache WHERE crossing_id = ? LIMIT 1",
      args: [crossingId],
    });
    const cacheRow = cached.rows[0] as any;
    const cachedAt = Number(cacheRow?.fetched_at || 0);
    let stations: Station[] = [];

    if (cacheRow && Date.now() - cachedAt < 60_000) {
      const parsed = JSON.parse(String(cacheRow.payload_json));
      stations = Array.isArray(parsed) ? parsed : [];
    } else {
      const guard = await db.execute("SELECT last_request_at FROM fuel_price_api_guard WHERE id = 1 LIMIT 1");
      const lastRequestAt = Number((guard.rows[0] as any)?.last_request_at || 0);
      if (Date.now() - lastRequestAt < 60_000) {
        if (cacheRow) {
          const parsed = JSON.parse(String(cacheRow.payload_json));
          stations = Array.isArray(parsed) ? parsed : [];
        } else {
          return Response.json({ error: "Die Spritpreisdaten werden gerade aktualisiert. Bitte in einer Minute erneut versuchen.", retryAfter: Math.ceil((60_000 - (Date.now() - lastRequestAt)) / 1000) }, { status: 429 });
        }
      } else {
        const crossingResult = await db.execute({
          sql: "SELECT lat, lon FROM crossings WHERE id = ? LIMIT 1",
          args: [crossingId],
        });
        const crossing = crossingResult.rows[0] as any;
        if (!crossing || !Number.isFinite(Number(crossing.lat)) || !Number.isFinite(Number(crossing.lon))) {
          return Response.json({ error: "Für diesen Bahnübergang sind keine Geodaten hinterlegt." }, { status: 404 });
        }

        await db.execute({
          sql: "INSERT INTO fuel_price_api_guard (id, last_request_at) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET last_request_at = excluded.last_request_at",
          args: [Date.now()],
        });
        const url = new URL("https://creativecommons.tankerkoenig.de/json/list.php");
        url.searchParams.set("lat", String(crossing.lat));
        url.searchParams.set("lng", String(crossing.lon));
        url.searchParams.set("rad", "5");
        url.searchParams.set("type", "all");
        url.searchParams.set("sort", "dist");
        url.searchParams.set("apikey", apiKey);

        const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error(`Tankerkönig HTTP ${response.status}`);
        const payload = await response.json();
        if (payload?.ok !== true || !Array.isArray(payload.stations)) {
          throw new Error(payload?.message || "Tankerkönig hat keine gültigen Daten geliefert.");
        }
        stations = payload.stations as Station[];
        await db.execute({
          sql: "INSERT INTO fuel_price_cache (crossing_id, payload_json, fetched_at) VALUES (?, ?, ?) ON CONFLICT(crossing_id) DO UPDATE SET payload_json = excluded.payload_json, fetched_at = excluded.fetched_at",
          args: [crossingId, JSON.stringify(stations), Date.now()],
        });
      }
    }

    return Response.json({
      type,
      result: cheapest(stations, type),
      fetchedAt: cachedAt && Date.now() - cachedAt < 60_000 ? cachedAt : Date.now(),
      radiusKm: 5,
      attribution: "Daten: Tankerkönig · CC BY 4.0",
      attributionUrl: "https://creativecommons.org/licenses/by/4.0/deed.de",
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[FUEL-PRICES] lookup failed:", error);
    return Response.json({ error: "Spritpreise konnten gerade nicht geladen werden." }, { status: 502 });
  }
}
