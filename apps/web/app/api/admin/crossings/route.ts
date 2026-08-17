import { randomUUID } from "crypto";
import { db } from "../../../lib/db";
import { readStations } from "db-stations";
import { OpenLocationCode } from "open-location-code";

const OLC = new OpenLocationCode();

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseCoordinates(value: string) {
  const match = value.replace(/,/g, " ").match(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon, source: "coordinates" as const };
}

function splitPlusCodeInput(value: string) {
  const input = value.trim().replace(/\s+/g, " ");
  const plus = input.indexOf("+");
  if (plus < 0) return null;
  const left = input.slice(0, plus).trim().toUpperCase();
  const rest = input.slice(plus + 1).trim();
  const [right, ...localityParts] = rest.split(/\s+/);
  if (!right) return null;
  return { code: `${left}+${right.toUpperCase()}`, locality: localityParts.join(" ").trim() };
}

async function geocodeLocality(locality: string) {
  const urls = [
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(locality)}&count=1&language=de&format=json`,
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=de&q=${encodeURIComponent(locality)}`,
  ];
  for (const url of urls) {
    try {
      const response = await fetch(url, { headers: { "User-Agent": "Crossings/1.0 (meineschranke.com)" }, cache: "no-store" });
      if (!response.ok) continue;
      const data = await response.json();
      const item = data?.results?.[0] || data?.[0];
      const lat = Number(item?.latitude ?? item?.lat), lon = Number(item?.longitude ?? item?.lon);
      if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
    } catch { /* try next geocoder */ }
  }
  return null;
}

async function resolvePlusCode(value: string) {
  const parsed = splitPlusCodeInput(value);
  if (!parsed) return null;
  const { code, locality } = parsed;
  try {
    if (OLC.isFull(code)) {
      const decoded = OLC.decode(code);
      return { lat: decoded.latitudeCenter, lon: decoded.longitudeCenter, source: "plus-code" as const };
    }
    if (!OLC.isShort(code) || !locality) return null;
    const reference = await geocodeLocality(locality);
    if (!reference) return null;
    const recovered = OLC.recoverNearest(code, reference.lat, reference.lon);
    const decoded = OLC.decode(recovered);
    return { lat: decoded.latitudeCenter, lon: decoded.longitudeCenter, source: "plus-code-recovered" as const };
  } catch {
    return null;
  }
}

async function resolveLocation(value: string) {
  return parseCoordinates(value) || await resolvePlusCode(value);
}

type Station = { type?: string; id?: string; ril100?: string; nr?: number; name?: string; weight?: number; location?: { latitude?: number; longitude?: number }; address?: { city?: string; zipcode?: string; street?: string } };
let stationCatalogPromise: Promise<Station[]> | null = null;
async function loadStationCatalog() {
  if (!stationCatalogPromise) stationCatalogPromise = (async () => {
    const stations: Station[] = [];
    for await (const station of readStations() as AsyncIterable<Station>) stations.push(station);
    return stations.filter((station) => Number.isFinite(station.location?.latitude) && Number.isFinite(station.location?.longitude));
  })().catch((error) => { stationCatalogPromise = null; throw error; });
  return stationCatalogPromise;
}

async function discoverStations(lat: number, lon: number) {
  const stations = await loadStationCatalog();
  return stations.map((station) => {
    const stationLat = Number(station.location?.latitude), stationLon = Number(station.location?.longitude);
    return { eva: String(station.id || ""), stationName: String(station.name || station.id || ""), ril100: String(station.ril100 || ""), nr: station.nr ?? null, lat: stationLat, lon: stationLon, city: String(station.address?.city || ""), zipcode: String(station.address?.zipcode || ""), distanceKm: distanceKm(lat, lon, stationLat, stationLon) };
  }).filter((station) => station.eva && station.distanceKm <= 25).sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 12);
}

async function loadCrossings() { const result = await db.execute(`SELECT id,name,eva,lat,lon,confidence,status,source,observation_evas,required_route_stops,close_offset_seconds,open_offset_seconds,created_at,updated_at FROM crossings ORDER BY name COLLATE NOCASE`); return result.rows; }

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const locationInput = searchParams.get("location") || searchParams.get("coordinates");
  const rows = await loadCrossings();
  if (locationInput) {
    const coords = await resolveLocation(locationInput);
    if (!coords) return Response.json({ error: "Standort konnte nicht erkannt werden. Bitte Google-Maps-Plus-Code, Koordinaten oder einen vollständigen Plus Code eingeben." }, { status: 400 });
    const nearest = rows.map((row) => ({ ...row, distanceKm: distanceKm(coords.lat, coords.lon, Number(row.lat), Number(row.lon)) })).sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 5);
    let stations: Awaited<ReturnType<typeof discoverStations>> = [];
    try { stations = await discoverStations(coords.lat, coords.lon); } catch { /* station catalog failure must not block location resolution */ }
    return Response.json({ input: locationInput, location: coords, nearest, stations });
  }
  const withStations = await Promise.all(rows.map(async (row) => { const stations = await db.execute({ sql: `SELECT id,eva,station_name,role,categories,direction,fallback_offset_seconds,track_distance_meters,sort_order FROM crossing_station_links WHERE crossing_id = ? ORDER BY sort_order`, args: [row.id] }); return { ...row, stations: stations.rows }; }));
  return Response.json(withStations);
}

export async function POST(request: Request) {
  const body = await request.json();
  const id = String(body.id || body.name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const name = String(body.name || "").trim(), eva = String(body.eva || "").trim();
  const lat = Number(body.lat), lon = Number(body.lon);
  if (!id || !name || !eva || !Number.isFinite(lat) || !Number.isFinite(lon)) return Response.json({ error: "Name, EVA, Breite und Länge sind erforderlich." }, { status: 400 });
  const stations = Array.isArray(body.stations) ? body.stations : [];
  const observationEvas = stations.map((s: any) => String(s.eva || "").trim()).filter(Boolean);
  if (!observationEvas.includes(eva)) observationEvas.unshift(eva);
  await db.execute({ sql: `INSERT INTO crossings (id,name,eva,observation_evas,required_route_stops,lat,lon,close_offset_seconds,open_offset_seconds,rules,through_rules,diversion_rules,reroute_watch_rules,confidence,source,status) VALUES (?,?,?,?,?,?,?,?,?,?,'[]','[]','[]',?,'manual','active')`, args: [id,name,eva,JSON.stringify(observationEvas),JSON.stringify([]),lat,lon,Number(body.closeOffsetSeconds ?? 80),Number(body.openOffsetSeconds ?? 20),JSON.stringify(body.rules || []),Number(body.confidence ?? 0.5)] });
  for (let i = 0; i < stations.length; i++) {
    const station = stations[i], stationEva = String(station.eva || "").trim(); if (!stationEva) continue;
    await db.execute({ sql: `INSERT OR IGNORE INTO railway_stations (eva,name) VALUES (?,?)`, args: [stationEva,String(station.stationName || station.name || stationEva)] });
    await db.execute({ sql: `INSERT OR REPLACE INTO crossing_station_links (id,crossing_id,eva,station_name,role,categories,direction,fallback_offset_seconds,track_distance_meters,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)`, args: [randomUUID(),id,stationEva,String(station.stationName || station.name || stationEva),station.role || (stationEva === eva ? "primary" : "observation"),JSON.stringify(station.categories || []),station.direction || "unknown",Number(station.fallbackOffsetSeconds || 0),Number(station.trackDistanceMeters || 0),i] });
  }
  return Response.json({ id, ok: true }, { status: 201 });
}
