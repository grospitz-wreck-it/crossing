import { randomUUID } from "crypto";
import { db } from "../../../lib/db";
import { readStations } from "db-stations";

const CODE_ALPHABET = "23456789CFGHJMPQRVWX";
const SEPARATOR = "+";
const PAIR_RESOLUTIONS = [20, 1, 0.05, 0.0025, 0.000125];

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
  const lat = Number(match[1]), lon = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon, source: "coordinates" as const };
}

function cleanCode(value: string) { return value.toUpperCase().trim().replace(/\s+/g, ""); }

function encodeFull(latInput: number, lonInput: number, length = 10) {
  let lat = Math.max(-90, Math.min(90, latInput));
  let lon = ((lonInput + 180) % 360 + 360) % 360 - 180;
  if (lat === 90) lat -= 1e-12;
  lat += 90; lon += 180;
  let code = "";
  for (let i = 0; i < Math.min(length, 10); i += 2) {
    const resolution = PAIR_RESOLUTIONS[i / 2];
    const latDigit = Math.floor(lat / resolution);
    const lonDigit = Math.floor(lon / resolution);
    code += CODE_ALPHABET[Math.max(0, Math.min(19, latDigit))];
    code += CODE_ALPHABET[Math.max(0, Math.min(19, lonDigit))];
    lat -= latDigit * resolution; lon -= lonDigit * resolution;
  }
  return code.slice(0, 8) + SEPARATOR + code.slice(8);
}

function decodeFull(value: string) {
  const code = cleanCode(value);
  const separator = code.indexOf(SEPARATOR);
  if (separator !== 8) return null;
  const digits = code.slice(0, separator) + code.slice(separator + 1);
  if (digits.length < 2 || digits.length > 11) return null;
  const hasGrid = digits.length > 10;
  const pairDigits = hasGrid ? 10 : digits.length;
  if (pairDigits % 2 !== 0 || pairDigits > 10) return null;

  let lat = -90, lon = -180;
  let latResolution = 20;
  let lonResolution = 20;
  for (let i = 0; i < pairDigits; i += 2) {
    const latIndex = CODE_ALPHABET.indexOf(digits[i]);
    const lonIndex = CODE_ALPHABET.indexOf(digits[i + 1]);
    if (latIndex < 0 || lonIndex < 0) return null;
    const resolution = PAIR_RESOLUTIONS[i / 2];
    if (!resolution) return null;
    lat += latIndex * resolution;
    lon += lonIndex * resolution;
    latResolution = resolution;
    lonResolution = resolution;
  }

  if (hasGrid) {
    const gridIndex = CODE_ALPHABET.indexOf(digits[10]);
    if (gridIndex < 0) return null;
    const row = Math.floor(gridIndex / 4), col = gridIndex % 4;
    lat += row * (latResolution / 5);
    lon += col * (lonResolution / 4);
    latResolution /= 5;
    lonResolution /= 4;
  }
  return { lat: lat + latResolution / 2, lon: lon + lonResolution / 2, source: "plus-code" as const };
}

function recoverShortCode(shortCode: string, referenceLat: number, referenceLon: number) {
  const code = cleanCode(shortCode);
  const separator = code.indexOf(SEPARATOR);
  if (separator < 2 || separator >= 8) return null;
  const paddingLength = 8 - separator;
  if (paddingLength % 2 !== 0) return null;
  const referenceDigits = encodeFull(referenceLat, referenceLon, 10).replace(SEPARATOR, "");
  const shortDigits = code.replace(SEPARATOR, "");
  const candidateDigits = referenceDigits.slice(0, paddingLength) + shortDigits;
  const candidate = candidateDigits.slice(0, 8) + SEPARATOR + candidateDigits.slice(8);
  return decodeFull(candidate) ? { ...decodeFull(candidate)!, source: "plus-code-recovered" as const } : null;
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

async function geocodeLocalityFromStations(locality: string) {
  try {
    const normalized = locality.toLocaleLowerCase("de-DE").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    const stations = await loadStationCatalog();
    const matches = stations.filter((station) => String(station.address?.city || "").toLocaleLowerCase("de-DE").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim() === normalized);
    if (!matches.length) return null;
    return { lat: matches.reduce((sum, s) => sum + Number(s.location?.latitude), 0) / matches.length, lon: matches.reduce((sum, s) => sum + Number(s.location?.longitude), 0) / matches.length };
  } catch { return null; }
}

async function resolvePlusCode(value: string) {
  const input = value.trim();
  const plusIndex = input.indexOf(SEPARATOR);
  if (plusIndex < 0) return null;
  const before = input.slice(0, plusIndex).trim();
  const after = input.slice(plusIndex + 1).trim();
  const suffix = after.split(/\s+/)[0];
  const codePart = `${before}+${suffix}`;
  const full = decodeFull(codePart);
  if (full) return full;
  if (before.length < 2 || before.length > 7) return null;
  const locality = after.split(/\s+/).slice(1).join(" ").trim();
  if (!locality) return null;
  const reference = await geocodeLocality(locality) || await geocodeLocalityFromStations(locality);
  if (!reference) return null;
  return recoverShortCode(codePart, reference.lat, reference.lon);
}

async function resolveLocation(value: string) { return parseCoordinates(value) || await resolvePlusCode(value); }

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
    const [nearest, stations] = await Promise.all([Promise.resolve(rows.map((row) => ({ ...row, distanceKm: distanceKm(coords.lat, coords.lon, Number(row.lat), Number(row.lon)) })).sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 5)), discoverStations(coords.lat, coords.lon)]);
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
