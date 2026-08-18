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

function networkQuery(bbox) {
  const [south, west, north, east] = bbox;
  return `[out:json][timeout:90];(node[railway=level_crossing](${south},${west},${north},${east});way[railway=rail](${south},${west},${north},${east}););out body geom;`;
}

function crossingQuery(lat, lon) {
  return `[out:json][timeout:60];node[railway=level_crossing](around:100,${lat},${lon})->.crossings;way(bn.crossings)[railway=rail];out body geom;`;
}

function osmIdQuery(osmId) {
  return `[out:json][timeout:60];node(${osmId})->.crossing;(.crossing;way(bn.crossing)[railway=rail];);out body geom;`;
}

function isOverpassTimeout(error) {
  const message = String(error?.message || error);
  return /Overpass (429|502|503|504)/.test(message) || /timed out/i.test(message);
}

async function fetchOverpass(query) {
  const encoded = encodeURIComponent(query);
  let lastError = null;
  for (const baseUrl of OVERPASS_URLS) {
    try {
      const response = await fetch(`${baseUrl}?data=${encoded}`, {
        method: "GET",
        headers: {
          accept: "application/json",
          "user-agent": "Crossings/1.0 (https://crossings.app; OSM importer)",
        },
      });
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

async function upsertCrossing(crossing) {
  await db.execute({
    sql: `INSERT INTO osm_crossings (osm_id, lat, lon, tags_json, osm_version, osm_timestamp, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(osm_id) DO UPDATE SET lat=excluded.lat, lon=excluded.lon,
      tags_json=excluded.tags_json, osm_version=excluded.osm_version,
      osm_timestamp=excluded.osm_timestamp, updated_at=datetime('now')`,
    args: [crossing.id, crossing.lat, crossing.lon, JSON.stringify(crossing.tags ?? {}), crossing.version ?? null, crossing.timestamp ?? null],
  });
}

async function upsertRailWay(way) {
  if (!Array.isArray(way.nodes) || way.nodes.length < 2 || !Array.isArray(way.geometry) || way.geometry.length < 2) return;
  await db.execute({
    sql: `INSERT INTO osm_rail_ways (osm_id, tags_json, node_ids_json, geometry_json, osm_version, osm_timestamp, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(osm_id) DO UPDATE SET tags_json=excluded.tags_json,
      node_ids_json=excluded.node_ids_json, geometry_json=excluded.geometry_json,
      osm_version=excluded.osm_version, osm_timestamp=excluded.osm_timestamp,
      updated_at=datetime('now')`,
    args: [way.id, JSON.stringify(way.tags ?? {}), JSON.stringify(way.nodes), JSON.stringify(way.geometry), way.version ?? null, way.timestamp ?? null],
  });
}

async function linkCrossingWays(crossing, crossingWays) {
  await upsertCrossing(crossing);
  for (const way of crossingWays) {
    if (!Array.isArray(way.nodes) || !way.nodes.includes(crossing.id)) continue;
    const index = way.nodes.indexOf(crossing.id);
    await upsertRailWay(way);
    await db.execute({
      sql: `INSERT INTO osm_crossing_rail_ways
        (crossing_osm_id, railway_way_id, crossing_node_index, way_direction, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(crossing_osm_id, railway_way_id) DO UPDATE SET
          crossing_node_index=excluded.crossing_node_index,
          way_direction=excluded.way_direction,
          updated_at=excluded.updated_at`,
      args: [crossing.id, way.id, index, index === 0 ? "forward" : index === way.nodes.length - 1 ? "backward" : "both"],
    });
  }
  console.log(`OSM ${crossing.id}: ${crossingWays.length} railway ways`);
}

async function importNetworkPayload(payload) {
  const elements = payload.elements ?? [];
  const crossings = elements.filter((e) => e.type === "node" && e.tags?.railway === "level_crossing");
  const ways = elements.filter((e) => e.type === "way" && e.tags?.railway === "rail");

  const waysByNode = new Map();
  for (const way of ways) {
    if (!Array.isArray(way.nodes) || way.nodes.length < 2) continue;
    await upsertRailWay(way);
    for (const nodeId of way.nodes) {
      const key = String(nodeId);
      const list = waysByNode.get(key) ?? [];
      list.push(way);
      waysByNode.set(key, list);
    }
  }

  for (const crossing of crossings) {
    const crossingWays = waysByNode.get(String(crossing.id)) ?? [];
    await linkCrossingWays(crossing, crossingWays);
  }

  return { crossings: crossings.length, ways: ways.length };
}

async function importCrossingWays(crossing, elements) {
  const ways = elements.filter((e) => e.type === "way" && e.tags?.railway === "rail");
  await linkCrossingWays(crossing, ways.filter((way) => way.nodes?.includes(crossing.id)));
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
  const osm = await db.execute({ sql: `SELECT osm_id, lat, lon FROM osm_crossings`, args: [] });
  const MAX_DISTANCE_METERS = 80;
  const pairs = [];

  for (const crossing of result.rows) {
    for (const row of osm.rows) {
      const distanceMeters = Math.sqrt(distance2(Number(crossing.lat), Number(crossing.lon), Number(row.lat), Number(row.lon)));
      if (distanceMeters <= MAX_DISTANCE_METERS) pairs.push({ crossing, row, distanceMeters });
    }
  }

  pairs.sort((a, b) => a.distanceMeters - b.distanceMeters);
  const assignedCrossings = new Set();
  const assignedOsmIds = new Set();
  const assignments = [];
  for (const pair of pairs) {
    if (assignedCrossings.has(pair.crossing.id) || assignedOsmIds.has(Number(pair.row.osm_id))) continue;
    assignedCrossings.add(pair.crossing.id);
    assignedOsmIds.add(Number(pair.row.osm_id));
    assignments.push(pair);
  }

  for (const crossing of result.rows) {
    const assignment = assignments.find((pair) => pair.crossing.id === crossing.id);
    if (!assignment) {
      console.log(`REVIEW ${crossing.name} -> no unique OSM crossing within ${MAX_DISTANCE_METERS}m`);
      continue;
    }
    const confidence = assignment.distanceMeters <= 20 ? 0.99 : 0.9;
    await db.execute({
      sql: `INSERT INTO crossing_osm_links (crossing_id, osm_crossing_id, match_method, confidence, updated_at)
        VALUES (?, ?, 'nearest_unique_global', ?, datetime('now'))
        ON CONFLICT(crossing_id) DO UPDATE SET osm_crossing_id=excluded.osm_crossing_id,
        match_method=excluded.match_method, confidence=excluded.confidence, updated_at=excluded.updated_at`,
      args: [crossing.id, assignment.row.osm_id, confidence],
    });
    console.log(`MATCH ${crossing.name} -> OSM ${assignment.row.osm_id} distance=${assignment.distanceMeters.toFixed(1)}m confidence=${confidence}`);
  }
}

async function importByBbox(bbox, depth = 0) {
  const maxDepth = 2;
  try {
    const payload = await fetchOverpass(networkQuery(bbox));
    const stats = await importNetworkPayload(payload);
    console.log(`OSM network tile: ${stats.crossings} crossings, ${stats.ways} railway ways`);
    return stats;
  } catch (error) {
    if (!isOverpassTimeout(error) || depth >= maxDepth) throw error;

    const [south, west, north, east] = bbox;
    const midLat = (south + north) / 2;
    const midLon = (west + east) / 2;
    const tiles = [
      [south, west, midLat, midLon],
      [south, midLon, midLat, east],
      [midLat, west, north, midLon],
      [midLat, midLon, north, east],
    ];

    console.warn(`Overpass timed out; splitting bbox into ${tiles.length} tiles (depth ${depth + 1}/${maxDepth})`);
    let crossings = 0;
    let ways = 0;
    for (const tile of tiles) {
      const stats = await importByBbox(tile, depth + 1);
      crossings += stats.crossings;
      ways += stats.ways;
    }
    return { crossings, ways };
  }
}

async function importSingleCrossing(crossingId) {
  const result = await db.execute({ sql: `SELECT id, name, lat, lon FROM crossings WHERE id = ?`, args: [crossingId] });
  const crossing = result.rows[0];
  if (!crossing) throw new Error(`Crossing not found: ${crossingId}`);

  const existingLink = await db.execute({ sql: `SELECT osm_crossing_id FROM crossing_osm_links WHERE crossing_id = ?`, args: [crossingId] });
  const linkedOsmId = existingLink.rows[0]?.osm_crossing_id;

  if (linkedOsmId) {
    console.log(`Using existing OSM link for ${crossing.name}: ${linkedOsmId}`);
    const detail = await fetchOverpass(osmIdQuery(Number(linkedOsmId)));
    const osmCrossing = (detail.elements ?? []).find((e) => e.type === "node" && Number(e.id) === Number(linkedOsmId));
    if (!osmCrossing) throw new Error(`OSM node ${linkedOsmId} was not returned by Overpass`);
    await importCrossingWays(osmCrossing, detail.elements ?? []);
    console.log(`OSM candidate for ${crossing.name}: ${linkedOsmId}`);
    return;
  }

  const detail = await fetchOverpass(crossingQuery(crossing.lat, crossing.lon));
  const osmCrossings = (detail.elements ?? []).filter((e) => e.type === "node" && e.tags?.railway === "level_crossing");
  if (!osmCrossings.length) throw new Error(`No OSM level crossing found near ${crossing.name}`);

  osmCrossings.sort((a, b) => Math.sqrt(distance2(Number(crossing.lat), Number(crossing.lon), Number(a.lat), Number(a.lon))) - Math.sqrt(distance2(Number(crossing.lat), Number(crossing.lon), Number(b.lat), Number(b.lon))));
  const osmCrossing = osmCrossings[0];
  await importCrossingWays(osmCrossing, detail.elements ?? []);
  console.log(`OSM candidate for ${crossing.name}: ${osmCrossing.id}`);
}

async function main() {
  const { bbox, crossingId } = parseArgs();
  await ensureSchema();
  if (crossingId) {
    await importSingleCrossing(crossingId);
  } else {
    const stats = await importByBbox(parseBbox(bbox));
    console.log(`OSM import network complete: ${stats.crossings} crossings, ${stats.ways} railway ways`);
    await matchExistingCrossings();
  }
  console.log("OSM import complete.");
}

main().catch((error) => { console.error(error); process.exit(1); });
