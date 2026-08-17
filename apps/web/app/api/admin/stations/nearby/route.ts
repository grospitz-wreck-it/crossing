import { readStations } from "db-stations";

export const dynamic = "force-dynamic";

let stationCache: Array<{ eva: string; name: string; ril100?: string; lat: number; lon: number; city?: string; zipcode?: string }> | null = null;
let stationCachePromise: Promise<typeof stationCache> | null = null;

async function getStations() {
  if (stationCache) return stationCache;
  if (!stationCachePromise) {
    stationCachePromise = (async () => {
      const stations: NonNullable<typeof stationCache> = [];
      for await (const station of readStations()) {
        const lat = Number(station.location?.latitude);
        const lon = Number(station.location?.longitude);
        const eva = String(station.id || "").trim();
        if (!eva || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        stations.push({
          eva,
          name: String(station.name || eva),
          ril100: station.ril100 ? String(station.ril100) : undefined,
          lat,
          lon,
          city: station.address?.city ? String(station.address.city) : undefined,
          zipcode: station.address?.zipcode ? String(station.address.zipcode) : undefined,
        });
      }
      stationCache = stations;
      return stations;
    })();
  }
  return stationCachePromise;
}

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const earthRadius = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));
  const radiusKm = Math.min(Math.max(Number(searchParams.get("radiusKm") || 25), 1), 100);
  const limit = Math.min(Math.max(Number(searchParams.get("limit") || 12), 1), 50);

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return Response.json({ error: "Ungültige Koordinaten." }, { status: 400 });
  }

  const stations = await getStations();
  const nearby = stations
    .map((station) => ({ ...station, distanceKm: distanceKm(lat, lon, station.lat, station.lon) }))
    .filter((station) => station.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit);

  return Response.json({ source: "db-stations", count: nearby.length, radiusKm, stations: nearby });
}
