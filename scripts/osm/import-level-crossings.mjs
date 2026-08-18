#!/usr/bin/env node

import { createClient } from "@libsql/client";

const OVERPASS_URLS = [
  process.env.OVERPASS_URL || "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];
const DATABASE_URL = process.env.TURSO_DATABASE_URL;
const AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!DATABASE_URL || !AUTH_TOKEN) {
  console.error("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN");
  process.exit(1);
}

const db = createClient({ url: DATABASE_URL, authToken: AUTH_TOKEN });

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--bbox") result.bbox = args[++i];
    if (arg === "--crossing") result.crossingId = args[++i];
  }
  return result;
}

function parseBbox(value) {
  if (!value) return null;
  const parts = value.split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error("--bbox must be south,west,north,east");
  }
  return parts;
}

async function ensureSchema() {
  await db.batch([
    { sql: `CREATE TABLE IF NOT EXISTS osm_crossings (osm_id INTEGER PRIMARY KEY, lat REAL NOT NULL, lon REAL NOT NULL, tags_json TEXT NOT NULL DEFAULT '{}', osm_version INTEGER, osm_timestamp TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')))` , args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS osm_rail_ways (osm_id INTEGER PRIMARY KEY, tags_json TEXT NOT NULL DEFAULT '{}', node_ids_json TEXT NOT NULL DEFAULT '[]', geometry_json TEXT NOT NULL DEFAULT '[]', osm_version INTEGER, osm_timestamp TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')))` , args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS osm_crossing_rail_ways (crossing_osm_id INTEGER NOT NULL, railway_way_id INTEGER NOT NULL, crossing_node_index INTEGER, way_direction TEXT NOT NULL DEFAULT 'unknown', updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (crossing_osm_id, railway_way_id), FOREIGN KEY (crossing_osm_id) REFERENCES osm_crossings(osm_id), FOREIGN KEY (railway_way_id) REFERENCES osm_rail_ways(osm_id))`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS crossing_osm_links (crossing_id TEXT PRIMARY KEY, osm_crossing_id INTEGER NOT NULL, match_method TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 1.0, updated_at TEXT NOT NULL DEFAULT (datetime('now')), FOREIGN KEY (osm_crossing_id) REFERENCES osm_crossings(osm_id))`, args: [] },
  ]);
}

function buildQuery(bbox) {
  const scope = bbox ? `(${bbox.join(",")})` : "(51.9,8.2,52.5,9.1)";
  return `[out:json][timeout:180];\nnode[railway=level_crossing]${scope}->.crossings;\n(\n  .crossings;\n  way(bn.crossings)[railway=rail];\n);\nout body geom;`;
}

async function fetchOverpass(query) {
  const encoded = encodeURIComponent(query);
  let lastError = null;
  for (const baseUrl of OVERPASS_URLS) {
    try {
      const response = await fetch(`${baseUrl}?data=${encoded}`, { method: "GET", headers: { accept: "application/json", "user-agent": "Crossings/1.0 (https://crossings.app; OSM importer)" } });
      if (!response.ok) throw new Error(`Overpass ${response.status}: ${(await response.text()).slice(0, 500)}`);
      return response.json();
    } catch (error) {
      lastError = error;
      console.warn(`Overpass endpoint failed: ${baseUrl}`);
      console.warn(error instanceof Error ? error.message : error);
    }
  }
  throw lastError ?? new Error("All Overpass endpoints failed");
}

function indexCrossingNodes(elements) {
  return new Map(elements.filter((e) => e.type === "node").map((e) => [e.id, e]));
}
function indexRailWays(elements) {
  return new Map(elements.filter((e) => e.type === "way" && e.tags?.railway === "rail").map((e) => [e.id, e]));
}
function linkedWays(crossingId, ways) {
  return [...ways.values()].filter((way) => Array.isArray(way.nodes) && way.nodes.includes(crossingId));
}

async function importData(elements) {
  const crossings = indexCrossingNodes(elements);
  const ways = indexRailWays(elements);
  console.log(`OSM: ${crossings.size} level crossings, ${ways.size} railway ways`);

  for (const crossing of crossings.values()) {
    await db.execute({ sql: `INSERT INTO osm_crossings (osm_id, lat, lon, tags_json, osm_version, osm_timestamp, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now')) ON CONFLICT(osm_id) DO UPDATE SET lat=excluded.lat, lon=excluded.lon, tags_json=excluded.tags_json, osm_version=excluded.osm_version, osm_timestamp=excluded.osm_timestamp, updated_at=datetime('now')`, args: [crossing.id, crossing.lat, crossing.lon, JSON.stringify(crossing.tags ?? {}), crossing.version ?? null, crossing.timestamp ?? null] });
    await db.execute({ sql: `DELETE FROM osm_crossing_rail_ways WHERE crossing_osm_id = ?`, args: [crossing.id] });
    for (const way of linkedWays(crossing.id, ways)) {
      const index = way.nodes.indexOf(crossing.id);
      await db.execute({ sql: `INSERT INTO osm_rail_ways (osm_id, tags_json, node_ids_json, geometry_json, osm_version, osm_timestamp, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now')) ON CONFLICT(osm_id) DO UPDATE SET tags_json=excluded.tags_json, node_ids_json=excluded.node_ids_json, geometry_json=excluded.geometry_json, osm_version=excluded.osm_version, osm_timestamp=excluded.osm_timestamp, updated_at=datetime('now')`, args: [way.id, JSON.stringify(way.tags ?? {}), JSON.stringify(way.nodes ?? []), JSON.stringify(way.geometry ?? []), way.version ?? null, way.timestamp ?? null] });
      await db.execute({ sql: `INSERT INTO osm_crossing_rail_ways (crossing_osm_id, railway_way_id, crossing_node_index, way_direction, updated_at) VALUES (?, ?, ?, ?, datetime('now'))`, args: [crossing.id, way.id, index, index === 0 ? "forward" : index === way.nodes.length - 1 ? "backward" : "both"] });
    }
  }
}

function distance2(aLat, aLon, bLat, bLon) {
  const latScale = 111320;
  const lonScale = 111320 * Math.cos((aLat * Math.PI) / 180);
  const dy = (aLat - bLat) * latScale;
  const dx = (aLon - bLon) * lonScale;
  return dx * dx + dy * dy;
}

async function matchExistingCrossings() {
  const result = await db.execute({ sql: `SELECT id, name, lat, lon FROM crossings WHERE status = 'active'`, args: [] });
  const osm = await db.execute({ sql: `SELECT osm_id, lat, lon, tags_json FROM osm_crossings`, args: [] });
  const candidates = osm.rows.map((row) => ({ ...row, distanceMeters: distance2(Number(row.lat), Number(row.lon), Number(row.lat), Number(row.lon)) }));

  const assignments = new Map();
  const usedOsmIds = new Set();

  for (const crossing of result.rows) {
    const ranked = osm.rows
      .map((row) => ({ row, distanceMeters: Math.sqrt(distance2(Number(crossing.lat), Number(crossing.lon), Number(row.lat), Number(row.lon))) }))
      .sort((a, b) => a.distanceMeters - b.distanceMeters);

    const best = ranked[0];
    const second = ranked[1];
    if (!best) continue;

    const MAX_DISTANCE_METERS = 80;
    const AMBIGUITY_MARGIN_METERS = 15;
    const ambiguous = second && second.distanceMeters - best.distanceMeters < AMBIGUITY_MARGIN_METERS;
    if (best.distanceMeters > MAX_DISTANCE_METERS || ambiguous || usedOsmIds.has(Number(best.row.osm_id))) {
      console.log(`REVIEW ${crossing.name} -> nearest OSM ${best.row.osm_id} (${best.distanceMeters.toFixed(1)}m)`);
      continue;
    }

    assignments.set(crossing.id, best.row.osm_id);
    usedOsmIds.add(Number(best.row.osm_id));
  }

  for (const crossing of result.rows) {
    const osmId = assignments.get(crossing.id);
    if (osmId == null) continue;
    const row = osm.rows.find((candidate) => Number(candidate.osm_id) === Number(osmId));
    const distanceMeters = Math.sqrt(distance2(Number(crossing.lat), Number(crossing.lon), Number(row.lat), Number(row.lon)));
    await db.execute({ sql: `INSERT INTO crossing_osm_links (crossing_id, osm_crossing_id, match_method, confidence, updated_at) VALUES (?, ?, 'nearest_unique', ?, datetime('now')) ON CONFLICT(crossing_id) DO UPDATE SET osm_crossing_id=excluded.osm_crossing_id, match_method=excluded.match_method, confidence=excluded.confidence, updated_at=datetime('now')`, args: [crossing.id, osmId, distanceMeters <= 20 ? 0.99 : 0.9] });
    console.log(`MATCH ${crossing.name} -> OSM ${osmId} distance=${distanceMeters.toFixed(1)}m confidence=${distanceMeters <= 20 ? 0.99 : 0.9}`);
  }
}

async function main() {
  const { bbox, crossingId } = parseArgs();
  await ensureSchema();
  const payload = await fetchOverpass(buildQuery(parseBbox(bbox)));
  await importData(payload.elements ?? []);
  if (crossingId) {
    const result = await db.execute({ sql: `SELECT * FROM crossing_osm_links WHERE crossing_id = ?`, args: [crossingId] });
    console.log(JSON.stringify(result.rows, null, 2));
  } else {
    await matchExistingCrossings();
  }
  console.log("OSM import complete.");
}

main().catch((error) => { console.error(error); process.exit(1); });
