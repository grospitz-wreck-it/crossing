import { randomUUID } from "crypto";
import { db } from "../../../lib/db";
import { readStations } from "db-stations";

const CODE_ALPHABET = "23456789CFGHJMPQRVWX";
const SEPARATOR = "+";

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

function cleanCode(value: string) { return value.toUpperCase().trim(); }

function decodeFullPlusCode(value: string) {
  const code = cleanCode(value).replace(/\s+/g, "");
  const separator = code.indexOf(SEPARATOR);
  if (separator < 0) return null;
  const digits = code.slice(0, separator).replace(/0/g, "");
  if (digits.length < 8 || digits.length % 2 !== 0) return null;
  let lat = -90, lon = -180, latPlace = 400, lonPlace = 400;
  for (let i = 0; i < Math.min(digits.length, 10); i += 2) {
    const latIndex = CODE_ALPHABET.indexOf(digits[i]);
    const lonIndex = CODE_ALPHABET.indexOf(digits[i + 1]);
    if (latIndex < 0 || lonIndex < 0) return null;
    latPlace /= 20;
    lonPlace /= 20;
    lat += latIndex * latPlace;
    lon += lonIndex * lonPlace;
  }
  return { lat: lat + latPlace / 2, lon: lon + lonPlace / 2, source: "plus-code" as const };
}

async function geocodeLocality(locality: string) {
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=de&q=${encodeURIComponent(locality)}`, {
      headers: { "User-Agent": "Crossings/1.0 (meineschranke)" },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!data?.[0]) return null;
    return { lat: Number(data[0].lat), lon: Number(data[0].lon) };
  } catch { return null; }
}

function encodeReferencePrefix(referenceLat: number, referenceLon: number, digitCount: number) {
  let lat = Math.max(-90, Math.min(90, referenceLat)) + 90;
  let lon = ((referenceLon + 180) % 360 + 360) % 360;
  let result = "";
  const pairCount = Math.floor(digitCount / 2);
  let latPlace = 400;
  let lonPlace = 400;
  for (let i = 0; i < pairCount; i++) {
    latPlace /= 20;
    lonPlace /= 20;
    const latIndex = Math.max(0, Math.min(19, Math.floor(lat / latPlace)));
    const lonIndex = Math.max(0, Math.min(19, Math.floor(lon / lonPlace)));
    result += CODE_ALPHABET[latIndex] + CODE_ALPHABET[lonIndex];
    lat -= latIndex * latPlace;
    lon -= lonIndex * lonPlace;
  }
  return result;
}

function recoverShortCode(shortCode: string, referenceLat: number, referenceLon: number) {
  const compact = cleanCode(shortCode).replace(/\s+/g, "");
  const separator = compact.indexOf(SEPARATOR);
  if (separator < 4 || separator >= 8) return null;
  const shortDigits = compact.slice(0, separator);
  const suffix = compact.slice(separator + 1);
  const prefixLength = 8 - shortDigits.length;
  if (prefixLength < 1 || prefixLength % 2 !== 0 || !suffix.length) return null;
  const prefix = encodeReferencePrefix(referenceLat, referenceLon, prefixLength);
  return decodeFullPlusCode(prefix + shortDigits + SEPARATOR + suffix);
}

async function resolvePlusCode(value: string) {
  const input = value.trim();
  const plusIndex = input.indexOf(SEPARATOR);
  if (plusIndex < 0) return null;
  const before = input.slice(0, plusIndex).trim();
  const after = input.slice(plusIndex + 1).trim();
  const suffix = after.split(/\s+/)[0];
  const codePart = `${before}+${suffix}`;
  const full = decodeFullPlusCode(codePart);
  if (full) return full;
  if (before.length < 4 || before.length > 7) return null;
  const locality = after.split(/\s+/).slice(1).join(" ").trim();
  if (!locality) return null;
  const reference = await geocodeLocality(locality);
  if (!reference) return null;
  const recovered = recoverShortCode(codePart, reference.lat, reference.lon);
  return recovered ? { ...recovered, source: "plus-code-recovered" as const, locality } : null;
}

async function resolveLocation(value: string) { return parseCoordinates(value) || await resolvePlusCode(value); }

type Station = {
  type?: string;
  id?: string;
  ril100?: string;
  nr?: number;
  name?: string;
  weight?: number;
  location?: { latitude?: number; longitude?: number };
  address?: { city?: string; zipcode?: string; street?: string };
};

let stationCatalogPromise: Promise<Station[]> | null = null;

async function loadStationCatalog() {
  if (!stationCatalogPromise) {
    stationCatalogPromise = (async () => {
      const stations: Station[] = [];
      for await (const station of readStations() as AsyncIterable<Station>) stations.push(station);
      return stations.filter((station) => Number.isFinite(station.location?.latitude) && Number.isFinite(station.location?.longitude));
    })().catch((error) => {
      stationCatalogPromise = null;
      throw error;
    });
  }
  return stationCatalogPromise;
}

async function discoverStations(lat: number, lon: number) {
  const stations = await loadStationCatalog();
  return stations
    .map((station) => {
      const stationLat = Number(station.location?.latitude);
      const stationLon = Number(station.location?.longitude);
      return {
        eva: String(station.id || ""),
        stationName: String(station.name || station.id || ""),
        ril100: String(station.ril100 || ""),
        nr: station.nr ?? null,
        lat: stationLat,
        lon: stationLon,
        city: String(station.address?.city || ""),
        zipcode: String(station.address?.zipcode || ""),
        distanceKm: distanceKm(lat, lon, stationLat, stationLon),
      };
    })
    .filter((station) => station.eva && station.distanceKm <= 25)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 12);
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
