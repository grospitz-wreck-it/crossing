import { auth } from "../../../../auth";
import { db } from "../../../lib/db";

export const dynamic = "force-dynamic";

type FuelType = "e5" | "e10" | "diesel";
type Station = {
  id: string; name: string; brand?: string; street?: string; houseNumber?: string;
  place?: string; postCode?: number; dist?: number; lat?: number; lng?: number;
  isOpen?: boolean; e5?: number | false; e10?: number | false; diesel?: number | false;
};

function compassDirection(fromLat: number, fromLon: number, toLat: number, toLon: number) {
  const toRad = (value: number) => value * Math.PI / 180;
  const y = Math.sin(toRad(toLon - fromLon)) * Math.cos(toRad(toLat));
  const x = Math.cos(toRad(fromLat)) * Math.sin(toRad(toLat)) -
    Math.sin(toRad(fromLat)) * Math.cos(toRad(toLat)) * Math.cos(toRad(toLon - fromLon));
  const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  return ["N", "NO", "O", "SO", "S", "SW", "W", "NW"][Math.round(bearing / 45) % 8];
}

function cheapest(stations: Station[], type: FuelType, lat: number, lon: number) {
  const available = stations
    .map((station) => ({ station, price: station[type] }))
    .filter((item): item is { station: Station; price: number } =>
      typeof item.price === "number" && Number.isFinite(item.price) && item.price > 0
    )
    .sort((a, b) => a.price - b.price);
  const selected: typeof available = [];
  const directions = new Set<string>();
  for (const item of available) {
    if (typeof item.station.lat !== "number" || typeof item.station.lng !== "number") continue;
    const direction = compassDirection(lat, lon, item.station.lat, item.station.lng);
    if (!directions.has(direction)) {
      selected.push(item);
      directions.add(direction);
      if (selected.length === 3) break;
    }
  }
  for (const item of available) {
    if (selected.length === 3) break;
    if (!selected.includes(item)) selected.push(item);
  }
  return selected.map(({ station, price }) => ({
    price,
    direction: typeof station.lat === "number" && typeof station.lng === "number"
      ? compassDirection(lat, lon, station.lat, station.lng) : "Umgebung",
    station: {
      name: station.name, brand: station.brand || null,
      street: [station.street, station.houseNumber].filter(Boolean).join(" ") || null,
      place: station.place || null, postCode: station.postCode || null,
      distanceKm: typeof station.dist === "number" ? station.dist : null,
      isOpen: station.isOpen === true,
      lat: typeof station.lat === "number" ? station.lat : null,
      lng: typeof station.lng === "number" ? station.lng : null,
    },
  }));
}

export async function GET(request: Request, { params }: { params: Promise<{ crossingId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Nicht angemeldet" }, { status: 401 });

  const { crossingId } = await params;
  const type = new URL(request.url).searchParams.get("type") as FuelType | null;
  if (!type || !["e5", "e10", "diesel"].includes(type)) {
    return Response.json({ error: "Ungültige Spritsorte." }, { status: 400 });
  }

  try {
    const crossingResult = await db.execute({
      sql: "SELECT lat, lon FROM crossings WHERE id = ? LIMIT 1",
      args: [crossingId],
    });
    const crossing = crossingResult.rows[0] as any;
    if (!crossing || !Number.isFinite(Number(crossing.lat)) || !Number.isFinite(Number(crossing.lon))) {
      return Response.json({ error: "Für diesen Bahnübergang sind keine Geodaten hinterlegt." }, { status: 404 });
    }

    const result = await db.execute({
      sql: `SELECT s.id, s.name, s.brand, s.street, s.house_number, s.post_code,
          s.place, s.lat, s.lon, s.is_open, cfs.distance_m, cfs.direction,
          p.price, p.fetched_at
        FROM crossing_fuel_stations cfs
        JOIN fuel_stations s ON s.id = cfs.station_id
        JOIN fuel_station_prices p ON p.station_id = s.id AND p.fuel_type = ?
        WHERE cfs.crossing_id = ?
        ORDER BY p.price ASC`,
      args: [type, crossingId],
    });

    const rows = result.rows as any[];
    const stations: Station[] = rows.map((row) => ({
      id: String(row.id),
      name: String(row.name || row.brand || "Tankstelle"),
      brand: row.brand ? String(row.brand) : undefined,
      street: row.street ? String(row.street) : undefined,
      houseNumber: row.house_number ? String(row.house_number) : undefined,
      place: row.place ? String(row.place) : undefined,
      postCode: row.post_code != null && Number.isFinite(Number(row.post_code)) ? Number(row.post_code) : undefined,
      dist: row.distance_m != null ? Number(row.distance_m) / 1000 : undefined,
      lat: row.lat != null ? Number(row.lat) : undefined,
      lng: row.lon != null ? Number(row.lon) : undefined,
      isOpen: Number(row.is_open) === 1,
      [type]: Number(row.price),
    }));
    const results = cheapest(stations, type, Number(crossing.lat), Number(crossing.lon));
    const newestFetchedAt = rows.reduce((latest, row) => Math.max(latest, Number(row.fetched_at || 0)), 0);

    if (results.length) {
      return Response.json({
        type, results, fetchedAt: newestFetchedAt,
        stale: Date.now() - newestFetchedAt > 30 * 60_000,
        radiusKm: 5,
        attribution: "Daten: Tankerkönig · CC BY 4.0",
        attributionUrl: "https://creativecommons.org/licenses/by/4.0/deed.de",
      }, { headers: { "Cache-Control": "private, no-store" } });
    }

    // During rollout, serve an already existing per-crossing cache if available.
    // This is read-only: user requests never call Tankerkönig.
    try {
      const legacy = await db.execute({
        sql: "SELECT payload_json, fetched_at FROM fuel_price_cache WHERE crossing_id = ? LIMIT 1",
        args: [crossingId],
      });
      const legacyRow = legacy.rows[0] as any;
      if (legacyRow) {
        const parsed = JSON.parse(String(legacyRow.payload_json));
        const cachedStations = Array.isArray(parsed) ? parsed as Station[] : [];
        const legacyResults = cheapest(cachedStations, type, Number(crossing.lat), Number(crossing.lon));
        if (legacyResults.length) {
          return Response.json({
            type, results: legacyResults, fetchedAt: Number(legacyRow.fetched_at || 0),
            stale: true, radiusKm: 5, source: "legacy-cache",
            attribution: "Daten: Tankerkönig · CC BY 4.0",
            attributionUrl: "https://creativecommons.org/licenses/by/4.0/deed.de",
          }, { headers: { "Cache-Control": "private, no-store" } });
        }
      }
    } catch {
      // The legacy table may not exist on a fresh installation.
    }

    const mapped = await db.execute({
      sql: "SELECT COUNT(*) AS count FROM crossing_fuel_stations WHERE crossing_id = ?",
      args: [crossingId],
    });
    const hasStations = Number((mapped.rows[0] as any)?.count || 0) > 0;
    return Response.json({
      type, results: [], fetchedAt: null, stale: false, radiusKm: 5,
      status: "warming_up",
      message: hasStations
        ? "Tankstellen sind erfasst. Die ersten Preise werden gerade gesammelt."
        : "Der Tankstellenbestand für diesen Bahnübergang wird gerade aufgebaut.",
      attribution: "Daten: Tankerkönig · CC BY 4.0",
      attributionUrl: "https://creativecommons.org/licenses/by/4.0/deed.de",
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[FUEL-PRICES] central cache lookup failed:", error);
    return Response.json({ error: "Spritpreise konnten gerade nicht geladen werden." }, { status: 502 });
  }
}
