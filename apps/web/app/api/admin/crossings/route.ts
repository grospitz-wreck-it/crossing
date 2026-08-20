import { randomUUID } from "crypto";
import { db } from "../../../lib/db";
import { OpenLocationCode } from "open-location-code";

type Point = { lat: number; lon: number };
type Station = {
  eva: string;
  stationName: string;
  ril100?: string;
  ibnr?: string;
  lat?: number;
  lon?: number;
  distanceKm?: number;
  trackDistanceMeters?: number;
  role?: "observation" | "context";
  source?: "osm" | "catalog";
};
type RailwayRoute = {
  ref?: string;
  name?: string;
  from?: string;
  to?: string;
  relationId?: number | null;
  segments?: Point[][];
};
type OpenLocationCodeRuntime = {
  isValid(code: string): boolean;
  isFull(code: string): boolean;
  isShort(code: string): boolean;
  decode(code: string): { latitudeCenter: number; longitudeCenter: number };
  recoverNearest(code: string, latitude: number, longitude: number): string;
};

const OLC = new OpenLocationCode() as unknown as OpenLocationCodeRuntime;

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pointSegmentDistanceMeters(lat: number, lon: number, a: Point, b: Point) {
  const scale = 111320;
  const x = (lon - a.lon) * scale * Math.cos((lat * Math.PI) / 180);
  const y = (lat - a.lat) * scale;
  const bx = (b.lon - a.lon) * scale * Math.cos((lat * Math.PI) / 180);
  const by = (b.lat - a.lat) * scale;
  const denom = bx * bx + by * by;
  let t = denom ? (x * bx + y * by) / denom : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - bx * t, y - by * t);
}

function geometryDistanceMeters(point: Point, segments: Point[][]) {
  let best = Infinity;
  for (const geometry of segments) {
    for (let i = 1; i < geometry.length; i += 1) {
      best = Math.min(
        best,
        pointSegmentDistanceMeters(point.lat, point.lon, geometry[i - 1], geometry[i])
      );
    }
  }
  return best;
}

function routeBBox(routeSegments: Point[][], lat: number, lon: number, radiusKm: number) {
  const points = routeSegments.flat();
  const all = points.length ? points : [{ lat, lon }];
  const lats = all.map((p) => p.lat);
  const lons = all.map((p) => p.lon);
  const padLat = radiusKm / 111;
  const padLon = radiusKm / (111 * Math.max(Math.cos((lat * Math.PI) / 180), 0.1));
  return {
    south: Math.max(-90, Math.min(...lats) - padLat),
    west: Math.max(-180, Math.min(...lons) - padLon),
    north: Math.min(90, Math.max(...lats) + padLat),
    east: Math.min(180, Math.max(...lons) + padLon),
  };
}

function parseCoordinates(value: string) {
  const normalized = value
    .trim()
    .replace(/\s*[,;]\s*/g, " ")
    .replace(/\s+/g, " ");
  const match = normalized.match(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return null;
  }
  return { lat, lon, source: "coordinates" as const };
}

function splitPlusCodeInput(value: string) {
  const input = value
    .trim()
    .replace(/^plus\s*code\s*[:：]?\s*/i, "")
    .replace(/\s+/g, " ");
  const plusIndex = input.indexOf("+");
  if (plusIndex < 0) return null;
  const left = input.slice(0, plusIndex).trim().toUpperCase();
  const parts = input.slice(plusIndex + 1).trim().split(/\s+/);
  const right = parts.shift();
  return left && right
    ? { code: `${left}+${right.toUpperCase()}`, locality: parts.join(" ").trim() }
    : null;
}

async function googleGeocode(address: string) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  try {
    const params = new URLSearchParams({ address, key, language: "de", region: "de" });
    const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`, {
      cache: "no-store",
    });
    const data = await response.json();
    const location = data?.results?.[0]?.geometry?.location;
    const lat = Number(location?.lat);
    const lon = Number(location?.lng);
    if (data?.status !== "OK" || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return {
      lat,
      lon,
      source: "google-geocoding" as const,
      globalCode: String(data?.results?.[0]?.plus_code?.global_code || ""),
    };
  } catch {
    return null;
  }
}

async function geocodeLocality(locality: string) {
  if (!locality) return null;
  for (const query of [`${locality}, Deutschland`, locality]) {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=de&q=${encodeURIComponent(query)}`,
        {
          headers: { "User-Agent": "Crossings/1.0 (meineschranke.com)" },
          cache: "no-store",
        }
      );
      const data = await response.json();
      const item = data?.[0];
      const lat = Number(item?.lat);
      const lon = Number(item?.lon);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        return { lat, lon, source: "geocoder" as const };
      }
    } catch {
      // Try the next locality resolution strategy.
    }
  }
  return null;
}

async function stationReference(locality: string) {
  if (!locality) return null;
  try {
    const result = await db.execute({
      sql: `SELECT eva,name,lat,lon FROM railway_station_catalog
            WHERE lat IS NOT NULL AND lon IS NOT NULL
              AND name LIKE ? COLLATE NOCASE
            ORDER BY length(name) LIMIT 1`,
      args: [`%${locality}%`],
    });
    const row = result.rows[0] as any;
    const lat = Number(row?.lat);
    const lon = Number(row?.lon);
    return Number.isFinite(lat) && Number.isFinite(lon)
      ? { lat, lon, station: String(row?.name || row?.eva || locality) }
      : null;
  } catch {
    return null;
  }
}

async function resolveLocation(value: string) {
  const coordinates = parseCoordinates(value);
  if (coordinates) return { result: coordinates, debug: { stage: "coordinates" } };

  const parsed = splitPlusCodeInput(value);
  if (!parsed) return { result: null, debug: { stage: "parse", reason: "invalid-plus-code-input" } };

  const { code, locality } = parsed;
  try {
    if (OLC.isFull(code)) {
      const decoded = OLC.decode(code);
      return {
        result: { lat: decoded.latitudeCenter, lon: decoded.longitudeCenter, source: "plus-code" as const },
        debug: { stage: "decode-full", code },
      };
    }

    if (!OLC.isShort(code) || !locality) {
      return { result: null, debug: { stage: "parse", code, locality, isValid: OLC.isValid(code) } };
    }

    const google = await googleGeocode(`${code} ${locality}`);
    if (google) return { result: google, debug: { stage: "google-geocoding", code, locality } };

    const reference = (await stationReference(locality)) || (await geocodeLocality(locality));
    if (!reference) {
      return { result: null, debug: { stage: "reference-resolution", reference: false, code, locality } };
    }

    const recovered = OLC.recoverNearest(code, reference.lat, reference.lon);
    const decoded = OLC.decode(recovered);
    return {
      result: {
        lat: decoded.latitudeCenter,
        lon: decoded.longitudeCenter,
        source: "plus-code-recovered" as const,
      },
      debug: { stage: "recover-nearest", code, locality, recovered, reference },
    };
  } catch (error) {
    return {
      result: null,
      debug: {
        stage: "resolve-exception",
        error: error instanceof Error ? error.message : String(error),
        code,
        locality,
      },
    };
  }
}

async function expandRouteSegments(route: RailwayRoute | null): Promise<Point[][]> {
  if (!route) return [];

  if (route.relationId) {
    for (const endpoint of [
      "https://overpass-api.de/api/interpreter",
      "https://overpass.kumi.systems/api/interpreter",
    ]) {
      try {
        // Expand the complete relation, including its member ways. This is
        // important for tram/light-rail relations where the individual way
        // often has no useful ref of its own.
        const query =
          `[out:json][timeout:25];rel(${Number(route.relationId)});(._;>;);out tags geom;`;
        const response = await fetch(`${endpoint}?${new URLSearchParams({ data: query })}`, {
          cache: "no-store",
          headers: {
            accept: "application/json",
            "user-agent": "Crossings/1.0 (meineschranke.com)",
          },
        });
        if (!response.ok) continue;

        const data = await response.json();
        const segments = (data?.elements || [])
          .filter(
            (element: any) =>
              element.type === "way" &&
              /^(rail|tram|light_rail)$/.test(String(element.tags?.railway || "")) &&
              Array.isArray(element.geometry)
          )
          .map((element: any) =>
            element.geometry
              .map((point: any) => ({ lat: Number(point.lat), lon: Number(point.lon) }))
              .filter((point: Point) => Number.isFinite(point.lat) && Number.isFinite(point.lon))
          )
          .filter((geometry: Point[]) => geometry.length >= 2);

        if (segments.length) return segments;
      } catch {
        // Try the secondary Overpass endpoint or supplied route geometry.
      }
    }
  }

  return Array.isArray(route.segments) ? route.segments : [];
}

async function loadCatalogForRoute(
  routeSegments: Point[][],
  lat: number,
  lon: number
): Promise<Station[]> {
  const bbox = routeBBox(routeSegments, lat, lon, 80);
  try {
    const result = await db.execute({
      sql: `SELECT eva,name,lat,lon,ril100,ibnr
            FROM railway_station_catalog
            WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?`,
      args: [bbox.south, bbox.north, bbox.west, bbox.east],
    });
    return result.rows
      .map((row: any) => ({
        eva: String(row.eva || ""),
        stationName: String(row.name || row.eva || ""),
        ril100: String(row.ril100 || ""),
        ibnr: String(row.ibnr || row.eva || ""),
        lat: Number(row.lat),
        lon: Number(row.lon),
        source: "catalog" as const,
      }))
      .filter(
        (station: Station) =>
          Boolean(station.eva) && Number.isFinite(station.lat) && Number.isFinite(station.lon)
      );
  } catch {
    return [];
  }
}

function isLargeStation(name: string) {
  const normalized = name.toLowerCase();
  return /\bhbf\b|hauptbahnhof|zentralbahnhof/.test(normalized);
}

function uniqueStations(stations: Station[]) {
  const seen = new Set<string>();
  return stations.filter((station) => {
    const key =
      station.eva ||
      `${station.stationName}|${Number(station.lat).toFixed(4)}|${Number(station.lon).toFixed(4)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function derivePredictionConfig(lat: number, lon: number, route: RailwayRoute | null) {
  try {
    const segments = await expandRouteSegments(route);
    const catalog = await loadCatalogForRoute(segments, lat, lon);

    if (!catalog.length) {
      return {
        observationEvas: [],
        contextEvas: [],
        requiredRouteStops: [],
        throughRules: [],
        diversionRules: [],
        stations: [] as Station[],
        osmStations: [] as Station[],
      };
    }

    const onRoute = catalog
      .map((station) => ({
        ...station,
        trackDistanceMeters: segments.length
          ? geometryDistanceMeters(
              { lat: Number(station.lat), lon: Number(station.lon) },
              segments
            )
          : Infinity,
        distanceKm: distanceKm(
          lat,
          lon,
          Number(station.lat),
          Number(station.lon)
        ),
      }))
      .filter(
        (station) =>
          Number(station.trackDistanceMeters) <= 2500 && Number(station.distanceKm) <= 75
      )
      .sort((a, b) => Number(a.distanceKm) - Number(b.distanceKm));

    const observation = uniqueStations(onRoute)
      .slice(0, 8)
      .map((station) => ({ ...station, role: "observation" as const }));
    const observationSet = new Set(observation.map((station) => station.eva));

    const context = uniqueStations(
      catalog
        .map((station) => ({
          ...station,
          distanceKm: distanceKm(
            lat,
            lon,
            Number(station.lat),
            Number(station.lon)
          ),
        }))
        .filter(
          (station) =>
            Number(station.distanceKm) <= 75 &&
            isLargeStation(station.stationName) &&
            !observationSet.has(station.eva)
        )
        .sort((a, b) => Number(a.distanceKm) - Number(b.distanceKm))
        .slice(0, 6)
    ).map((station) => ({
      ...station,
      role: "context" as const,
      trackDistanceMeters: geometryDistanceMeters(
        { lat: Number(station.lat), lon: Number(station.lon) },
        segments
      ),
    }));

    const routeStops = Array.from(
      new Set([route?.from, route?.to].filter((value): value is string => Boolean(value?.trim())))
    );
    const requiredRouteStops = routeStops.length
      ? routeStops
      : observation.slice(0, 2).map((station) => station.stationName);

    const sources = [...observation, ...context];
    const throughRules = sources
      .filter((station) => station.eva)
      .map((station) => ({
        observationEva: station.eva,
        observationStation: station.stationName,
        // Legacy values are intentionally retained; the prediction layer
        // treats these as generic rail transit for existing crossings.
        categories: ["ICE", "IC", "EC"],
        trackDistanceMeters: Math.round(Number(station.trackDistanceMeters || 0)),
        fallbackOffsetSeconds: Math.max(
          60,
          Math.round((Math.max(0.5, Number(station.distanceKm || 0)) / 90) * 3600)
        ),
        direction: "unknown" as const,
      }));

    const diversionRules =
      context.length && requiredRouteStops.length
        ? context.map((station) => ({
            observationEva: station.eva,
            observationStation: station.stationName,
            categories: ["ICE", "IC", "EC"],
            anchorRouteStops: requiredRouteStops.slice(0, 2),
            excludedRouteStop: observation[0]?.stationName || requiredRouteStops[0],
          }))
        : [];

    return {
      observationEvas: observation.map((station) => station.eva),
      contextEvas: context.map((station) => station.eva),
      requiredRouteStops,
      throughRules,
      diversionRules,
      stations: sources,
      osmStations: sources,
    };
  } catch (error) {
    console.error("derivePredictionConfig failed", error);
    return {
      observationEvas: [],
      contextEvas: [],
      requiredRouteStops: [],
      throughRules: [],
      diversionRules: [],
      stations: [] as Station[],
      osmStations: [] as Station[],
    };
  }
}

async function discoverStations(lat: number, lon: number) {
  try {
    const catalog = await loadCatalogForRoute([], lat, lon);
    return uniqueStations(
      catalog
        .map((station) => ({
          ...station,
          distanceKm: distanceKm(lat, lon, Number(station.lat), Number(station.lon)),
        }))
        .filter((station) => Number(station.distanceKm) <= 25)
        .sort((a, b) => Number(a.distanceKm) - Number(b.distanceKm))
        .slice(0, 12)
    );
  } catch {
    return [];
  }
}

async function loadCrossings() {
  const result = await db.execute(
    `SELECT id,name,eva,lat,lon,confidence,status,source,observation_evas,context_evas,required_route_stops,close_offset_seconds,open_offset_seconds,created_at,updated_at
     FROM crossings ORDER BY name COLLATE NOCASE`
  );

  return result.rows.map((row: any) => {
    let observationEvas: string[] = [];
    let contextEvas: string[] = [];
    try {
      observationEvas = JSON.parse(String(row.observation_evas || "[]"));
    } catch {}
    try {
      contextEvas = JSON.parse(String(row.context_evas || "[]"));
    } catch {}

    return {
      ...row,
      stations: [
        ...observationEvas.map((eva) => ({ eva, stationName: eva, role: "observation" })),
        ...contextEvas.map((eva) => ({ eva, stationName: eva, role: "context" })),
      ],
    };
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const locationInput = searchParams.get("location") || searchParams.get("coordinates");
  const rows = await loadCrossings();

  if (!locationInput) return Response.json(rows);

  const resolved = await resolveLocation(locationInput);
  if (!resolved.result) {
    return Response.json(
      {
        error:
          "Standort konnte nicht erkannt werden. Bitte Google-Maps-Plus-Code, Koordinaten oder einen vollständigen Plus Code eingeben.",
        debug: {
          input: locationInput,
          parsed: splitPlusCodeInput(locationInput),
          ...resolved.debug,
          googleGeocodingConfigured: Boolean(process.env.GOOGLE_MAPS_API_KEY),
        },
      },
      { status: 400 }
    );
  }

  const coords = resolved.result;
  const nearest = rows
    .map((row: any) => ({
      ...row,
      distanceKm: distanceKm(coords.lat, coords.lon, Number(row.lat), Number(row.lon)),
    }))
    .sort((a: any, b: any) => a.distanceKm - b.distanceKm)
    .slice(0, 5);

  return Response.json({
    input: locationInput,
    location: coords,
    debug: resolved.debug,
    nearest,
    stations: await discoverStations(coords.lat, coords.lon),
  });
}

export async function POST(request: Request) {
  let stage = "request";

  try {
    const body = await request.json();
    const suppliedName = String(body.name || "").trim();
    const routeRef = String(body.routeRef || body.selectedRouteRef || "").trim();
    const routeName = String(body.routeName || body.selectedRouteName || "").trim();
    const name =
      suppliedName ||
      ["Bahnübergang", routeRef ? `Strecke ${routeRef}` : routeName].filter(Boolean).join(" ");
    const eva = String(body.eva || "").trim();
    const lat = Number(body.lat);
    const lon = Number(body.lon);
    const route: RailwayRoute | null =
      body.selectedRoute && typeof body.selectedRoute === "object" ? body.selectedRoute : null;

    if (!name) {
      return Response.json(
        { error: "Bitte einen Namen für den Bahnübergang vergeben.", stage: "validation" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return Response.json(
        { error: "Standortkoordinaten fehlen. Bitte zuerst den Plus Code prüfen.", stage: "validation" },
        { status: 400 }
      );
    }

    stage = "duplicate-name";
    const sameName = await db.execute({
      sql: `SELECT id,name,lat,lon FROM crossings WHERE LOWER(TRIM(name))=LOWER(TRIM(?)) LIMIT 1`,
      args: [name],
    });
    if (sameName.rows.length) {
      return Response.json(
        {
          error: `Dieser Name wird bereits verwendet: „${String((sameName.rows[0] as any).name)}“.`,
          code: "DUPLICATE_NAME",
          existing: sameName.rows[0],
        },
        { status: 409 }
      );
    }

    stage = "duplicate-location";
    const sameLocation = await db.execute({
      sql: `SELECT id,name,lat,lon FROM crossings WHERE ROUND(lat,5)=ROUND(?,5) AND ROUND(lon,5)=ROUND(?,5) LIMIT 1`,
      args: [lat, lon],
    });
    if (sameLocation.rows.length) {
      return Response.json(
        {
          error: `An diesem Standort existiert bereits der Bahnübergang „${String((sameLocation.rows[0] as any).name)}“.`,
          code: "DUPLICATE_LOCATION",
          existing: sameLocation.rows[0],
        },
        { status: 409 }
      );
    }

    stage = "derive-prediction-config";
    const derived = await derivePredictionConfig(lat, lon, route);
    const requiredRouteStops = derived.requiredRouteStops.length
      ? derived.requiredRouteStops
      : routeRef
        ? [routeRef]
        : [];
    const idBase =
      name
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "crossing";
    const id = `${idBase}-${randomUUID().slice(0, 8)}`;

    stage = "insert-crossing";
    await db.execute({
      sql: `INSERT INTO crossings
        (id,name,eva,observation_evas,context_evas,required_route_stops,lat,lon,close_offset_seconds,open_offset_seconds,rules,through_rules,diversion_rules,reroute_watch_rules,confidence,source,status)
        VALUES (?,?,?,?,?,?,?,?,?,?,'[]',?,?,?,?,'manual','active')`,
      args: [
        id,
        name,
        eva,
        JSON.stringify(derived.observationEvas),
        JSON.stringify(derived.contextEvas),
        JSON.stringify(requiredRouteStops),
        lat,
        lon,
        Number(body.closeOffsetSeconds ?? 80),
        Number(body.openOffsetSeconds ?? 20),
        JSON.stringify(derived.throughRules),
        JSON.stringify(derived.diversionRules),
        JSON.stringify([]),
        Number(body.confidence ?? 0.5),
      ],
    });

    stage = "verify";
    const result = await db.execute({
      sql: `SELECT id,name,eva,lat,lon,confidence,status,source,observation_evas,context_evas,required_route_stops,close_offset_seconds,open_offset_seconds,created_at,updated_at
            FROM crossings WHERE id=? LIMIT 1`,
      args: [id],
    });
    if (!result.rows.length) {
      return Response.json(
        { error: "Der Übergang wurde gespeichert, konnte aber nicht bestätigt werden.", stage },
        { status: 500 }
      );
    }

    return Response.json(
      {
        ok: true,
        id,
        crossing: result.rows[0],
        autoStations: derived.osmStations,
        autoRules: {
          requiredRouteStops,
          throughRules: derived.throughRules,
          diversionRules: derived.diversionRules,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/DUPLICATE_NAME/i.test(message)) {
      return Response.json(
        { error: "Dieser Name wird bereits verwendet.", code: "DUPLICATE_NAME", stage },
        { status: 409 }
      );
    }
    if (/DUPLICATE_LOCATION/i.test(message)) {
      return Response.json(
        { error: "An diesem Standort existiert bereits ein Bahnübergang.", code: "DUPLICATE_LOCATION", stage },
        { status: 409 }
      );
    }
    if (/UNIQUE|constraint/i.test(message)) {
      return Response.json(
        {
          error: "Dieser Bahnübergang existiert bereits. Bitte prüfe Name und Standort.",
          code: "DUPLICATE",
          stage,
        },
        { status: 409 }
      );
    }
    return Response.json(
      { error: message || "Speichern fehlgeschlagen.", stage },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  const id = String(new URL(request.url).searchParams.get("id") || "").trim();
  if (!id) return Response.json({ error: "ID des Bahnübergangs fehlt." }, { status: 400 });

  try {
    const existing = await db.execute({
      sql: `SELECT id,name FROM crossings WHERE id=? LIMIT 1`,
      args: [id],
    });
    if (!existing.rows.length) {
      return Response.json(
        { error: "Bahnübergang nicht gefunden.", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    for (const table of ["user_crossings", "campaign_crossings"]) {
      try {
        await db.execute({ sql: `DELETE FROM ${table} WHERE crossing_id=?`, args: [id] });
      } catch (error) {
        console.warn(`DELETE ${table} skipped`, error);
      }
    }

    await db.execute({ sql: `DELETE FROM crossings WHERE id=?`, args: [id] });
    const verify = await db.execute({
      sql: `SELECT id FROM crossings WHERE id=? LIMIT 1`,
      args: [id],
    });
    if (verify.rows.length) {
      return Response.json(
        { error: "Der Bahnübergang konnte nicht vollständig gelöscht werden." },
        { status: 500 }
      );
    }

    return Response.json({ ok: true, id });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
