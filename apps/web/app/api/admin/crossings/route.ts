import { randomUUID } from "crypto";
import { db } from "../../../lib/db";

const CODE_ALPHABET = "23456789CFGHJMPQRVWX";
const SEPARATOR = "+";
const DB_TRANSPORT_API = "https://v6.db.transport.rest";

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

function cleanPlusCode(value: string) { return value.toUpperCase().replace(/\s+/g, ""); }

function decodeFullPlusCode(value: string) {
  const code = cleanPlusCode(value);
  const separator = code.indexOf(SEPARATOR);
  if (separator < 0) return null;
  const digits = code.slice(0, separator).replace(/0/g, "");
  if (digits.length < 8 || digits.length % 2 !== 0) return null;
  let lat = -90, lon = -180, latPlace = 400, lonPlace = 400;
  for (let i = 0; i < Math.min(digits.length, 10); i += 2) {
    const latIndex = CODE_ALPHABET.indexOf(digits[i]);
    const lonIndex = CODE_ALPHABET.indexOf(digits[i + 1]);
    if (latIndex < 0 || lonIndex < 0) return null;
    latPlace /= 20; lonPlace /= 20;
    lat += latIndex * latPlace; lon += lonIndex * lonPlace;
  }
  return { lat: lat + latPlace / 2, lon: lon + lonPlace / 2, source: "plus-code" as const };
}

async function geocodeLocality(locality: string) {
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(locality)}`, { headers: { "User-Agent": "Crossings/1.0 (meineschranke)" }, cache: "no-store" });
    if (!response.ok) return null;
    const data = await response.json();
    if (!data?.[0]) return null;
    return { lat: Number(data[0].lat), lon: Number(data[0].lon) };
  } catch { return null; }
}

function recoverShortCode(shortCode: string, referenceLat: number, referenceLon: number) {
  const compact = cleanPlusCode(shortCode);
  const separator = compact.indexOf(SEPARATOR);
  if (separator < 0) return null;
  const code = compact.slice(0, separator);
  if (code.length >= 8) return decodeFullPlusCode(compact);
  const missingPairs = (8 - code.length) / 2;
  let prefix = "";
  let lat = referenceLat;
  let lon = referenceLon;
  for (let i = 0; i < missingPairs; i++) {
    const place = 400 / Math.pow(20, i + 1);
    const latIndex = Math.floor((lat + 90) / place);
    const lonIndex = Math.floor((lon + 180) / place);
    prefix += CODE_ALPHABET[Math.max(0, Math.min(19, latIndex))];
    prefix += CODE_ALPHABET[Math.max(0, Math.min(19, lonIndex))];
  }
  return decodeFullPlusCode(prefix + code + SEPARATOR);
}

async function resolvePlusCode(value: string) {
  const input = value.trim();
  const compact = cleanPlusCode(input);
  const separator = compact.indexOf(SEPARATOR);
  if (separator < 0) return null;
  const codePart = compact.slice(0, separator);
  const locality = input.slice(input.indexOf("+") + 1).trim();
  const full = decodeFullPlusCode(compact);
  if (full) return full;
  if (codePart.length < 4 || !locality) return null;
  const reference = await geocodeLocality(locality);
  if (!reference) return null;
  const recovered = recoverShortCode(codePart + SEPARATOR + compact.slice(separator + 1), reference.lat, reference.lon);
  return recovered ? { ...recovered, source: "plus-code-recovered" as const, locality } : null;
}

async function resolveLocation(value: string) { return parseCoordinates(value) || await resolvePlusCode(value); }

function uniqueLines(station: any) {
  const lines = Array.isArray(station?.lines) ? station.lines : [];
  return lines.map((line: any) => String(line?.id || line?.name || "")).filter(Boolean).slice(0, 12);
}

async function discoverStations(lat: number, lon: number) {
  try {
    const url = `${DB_TRANSPORT_API}/locations/nearby?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&results=12&distance=25000&stops=true&poi=false&linesOfStops=true&language=de&pretty=false`;
    const response = await fetch(url, { headers: { Accept: "application/json" }, next: { revalidate: 3600 } });
    if (!response.ok) return [];
    const data = await response.json();
    const raw = Array.isArray(data) ? data : [];
    return raw.filter((item: any) => item?.type === "stop" || item?.type === "station").map((item: any) => {
      const location = item.location || {};
      return {
        eva: String(item.id || ""),
        stationName: String(item.name || item.id || ""),
        lat: Number(location.latitude),
        lon: Number(location.longitude),
        distanceKm: distanceKm(lat, lon, Number(location.latitude), Number(location.longitude)),
        lines: uniqueLines(item),
        products: item.products || {},
      };
    }).filter((item: any) => item.eva && Number.isFinite(item.lat) && Number.isFinite(item.lon)).sort((a: any, b: any) => a.distanceKm - b.distanceKm);
  } catch (error) {
    console.error("DB station discovery failed", error);
    return [];
  }
}

async function loadCrossings() {
  const result = await db.execute(`SELECT id,name,eva,lat,lon,confidence,status,source,observation_evas,required_route_stops,close_offset_seconds,open_offset_seconds,created_at,updated_at FROM crossings ORDER BY name COLLATE NOCASE`);
  return result.rows;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const locationInput = searchParams.get("location") || searchParams.get("coordinates");
  const rows = await loadCrossings();
  if (locationInput) {
    const coords = await resolveLocation(locationInput);
    if (!coords) return Response.json({ error: "Standort konnte nicht erkannt werden. Bitte Google-Maps-Plus-Code, Koordinaten oder einen vollständigen Plus Code eingeben." }, { status: 400 });
    const [nearest, stations] = await Promise.all([
      Promise.resolve(rows.map((row) => ({ ...row, distanceKm: distanceKm(coords.lat, coords.lon, Number(row.lat), Number(row.lon)) })).sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 5)),
      discoverStations(coords.lat, coords.lon),
    ]);
    return Response.json({ input: locationInput, location: coords, nearest, stations });
  }
  const withStations = await Promise.all(rows.map(async (row) => {
    const stations = await db.execute({ sql: `SELECT id,eva,station_name,role,categories,direction,fallback_offset_seconds,track_distance_meters,sort_order FROM crossing_station_links WHERE crossing_id = ? ORDER BY sort_order`, args: [row.id] });
    return { ...row, stations: stations.rows };
  }));
  return Response.json(withStations);
}

export async function POST(request: Request) {
  const body = await request.json();
  const id = String(body.id || body.name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const name = String(body.name || "").trim();
  const eva = String(body.eva || "").trim();
  const lat = Number(body.lat), lon = Number(body.lon);
  if (!id || !name || !eva || !Number.isFinite(lat) || !Number.isFinite(lon)) return Response.json({ error: "Name, EVA, Breite und Länge sind erforderlich." }, { status: 400 });
  const stations = Array.isArray(body.stations) ? body.stations : [];
  const observationEvas = stations.map((s: any) => String(s.eva || "").trim()).filter(Boolean);
  if (!observationEvas.includes(eva)) observationEvas.unshift(eva);
  const routeStops = Array.isArray(body.requiredRouteStops) ? body.requiredRouteStops : [];
  const rules = Array.isArray(body.rules) ? body.rules : [];
  await db.execute({ sql: `INSERT INTO crossings (id,name,eva,observation_evas,required_route_stops,lat,lon,close_offset_seconds,open_offset_seconds,rules,through_rules,diversion_rules,reroute_watch_rules,confidence,source,status) VALUES (?,?,?,?,?,?,?,?,?,?,'[]','[]','[]',?,'manual','active')`, args: [id,name,eva,JSON.stringify(observationEvas),JSON.stringify(routeStops),lat,lon,Number(body.closeOffsetSeconds ?? 80),Number(body.openOffsetSeconds ?? 20),JSON.stringify(rules),Number(body.confidence ?? 0.5)] });
  for (let i = 0; i < stations.length; i++) {
    const station = stations[i]; const stationEva = String(station.eva || "").trim(); if (!stationEva) continue;
    await db.execute({ sql: `INSERT OR IGNORE INTO railway_stations (eva,name) VALUES (?,?)`, args: [stationEva,String(station.stationName || station.name || stationEva)] });
    await db.execute({ sql: `INSERT OR REPLACE INTO crossing_station_links (id,crossing_id,eva,station_name,role,categories,direction,fallback_offset_seconds,track_distance_meters,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)`, args: [randomUUID(),id,stationEva,String(station.stationName || station.name || stationEva),station.role || (stationEva === eva ? "primary" : "observation"),JSON.stringify(station.categories || []),station.direction || "unknown",Number(station.fallbackOffsetSeconds || 0),Number(station.trackDistanceMeters || 0),i] });
  }
  return Response.json({ id, ok: true }, { status: 201 });
}
