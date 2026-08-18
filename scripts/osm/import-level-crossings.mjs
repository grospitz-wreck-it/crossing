#!/usr/bin/env node

import { createClient } from "@libsql/client";

const OVERPASS_URL = process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";
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

function escapeSqlJson(value) {
  return JSON.stringify(value ?? {});
}

async function ensureSchema() {
  await db.batch([
    {
      sql: `CREATE TABLE IF NOT EXISTS osm_crossings (
        osm_id INTEGER PRIMARY KEY,
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        tags_json TEXT NOT NULL DEFAULT '{}',
        osm_version INTEGER,
        osm_timestamp TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS osm_rail_ways (
        osm_id INTEGER PRIMARY KEY,
        tags_json TEXT NOT NULL DEFAULT '{}',
        node_ids_json TEXT NOT NULL DEFAULT '[]',
        geometry_json TEXT NOT NULL DEFAULT '[]',
        osm_version INTEGER,
        osm_timestamp TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS osm_crossing_rail_ways (
        crossing_osm_id INTEGER NOT NULL,
        railway_way_id INTEGER NOT NULL,
        crossing_node_index INTEGER,
        way_direction TEXT NOT NULL DEFAULT 'unknown',
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (crossing_osm_id, railway_way_id),
        FOREIGN KEY (crossing_osm_id) REFERENCES osm_crossings(osm_id),
        FOREIGN KEY (railway_way_id) REFERENCES osm_rail_ways(osm_id)
      )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS crossing_osm_links (
        crossing_id TEXT PRIMARY KEY,
        osm_crossing_id INTEGER NOT NULL,
        match_method TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 1.0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (osm_crossing_id) REFERENCES osm_crossings(osm_id)
      )`,
      args: [],
    },
  ]);
}

function buildQuery(bbox) {
  const scope = bbox ? `(${bbox.join(",")})` : "(51.9,8.2,52.5,9.1)";
  return `
[out:json][timeout:180];
node[railway=level_crossing]${scope}->.crossings;
(
  .crossings;
  way(bn.crossings)[railway=rail];
);
out body geom;
`.trim();
}

async function fetchOverpass(query) {
  const response = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Overpass ${response.status}: ${text.slice(0, 500)}`);
  }
  return response.json();
}

function indexCrossingNodes(elements) {
  return new Map(
    elements
      .filter((element) => element.type === "node")
      .map((element) => [element.id, element])
  );
}

function indexRailWays(elements) {
  return new Map(
    elements
      .filter((element) => element.type === "way" && element.tags?.railway === "rail")
      .map((element) => [element.id, element])
  );
}

function linkedWays(crossingId, ways) {
  return [...ways.values()].filter((way) => Array.isArray(way.nodes) && way.nodes.includes(crossingId));
}

async function importData(elements) {
  const crossings = indexCrossingNodes(elements);
  const ways = indexRailWays(elements);

  console.log(`OSM: ${crossings.size} level crossings, ${ways.size} railway ways`);

  for (const crossing of crossings.values()) {
    await db.execute({
      sql: `INSERT INTO osm_crossings
        (osm_id, lat, lon, tags_json, osm_version, osm_timestamp, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(osm_id) DO UPDATE SET
          lat=excluded.lat,
          lon=excluded.lon,
          tags_json=excluded.tags_json,
          osm_version=excluded.osm_version,
          osm_timestamp=excluded.osm_timestamp,
          updated_at=datetime('now')`,
      args: [
        crossing.id,
        crossing.lat,
        crossing.lon,
        escapeSqlJson(crossing.tags),
        crossing.version ?? null,
        crossing.timestamp ?? null,
      ],
    });

    await db.execute({
      sql: `DELETE FROM osm_crossing_rail_ways WHERE crossing_osm_id = ?`,
      args: [crossing.id],
    });

    for (const way of linkedWays(crossing.id, ways)) {
      const index = way.nodes.indexOf(crossing.id);
      await db.execute({
        sql: `INSERT INTO osm_rail_ways
          (osm_id, tags_json, node_ids_json, geometry_json, osm_version, osm_timestamp, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(osm_id) DO UPDATE SET
            tags_json=excluded.tags_json,
            node_ids_json=excluded.node_ids_json,
            geometry_json=excluded.geometry_json,
            osm_version=excluded.osm_version,
            osm_timestamp=excluded.osm_timestamp,
            updated_at=datetime('now')`,
        args: [
          way.id,
          escapeSqlJson(way.tags),
          JSON.stringify(way.nodes ?? []),
          JSON.stringify(way.geometry ?? []),
          way.version ?? null,
          way.timestamp ?? null,
        ],
      });

      await db.execute({
        sql: `INSERT INTO osm_crossing_rail_ways
          (crossing_osm_id, railway_way_id, crossing_node_index, way_direction, updated_at)
          VALUES (?, ?, ?, ?, datetime('now'))`,
        args: [crossing.id, way.id, index, index === 0 ? "forward" : index === way.nodes.length - 1 ? "backward" : "both"],
      });
    }
  }
}

async function matchExistingCrossings() {
  const result = await db.execute({
    sql: `SELECT id, name, lat, lon FROM crossings WHERE status = 'active'`,
    args: [],
  });

  for (const crossing of result.rows) {
    const candidates = await db.execute({
      sql: `SELECT osm_id, lat, lon, tags_json,
        ((lat - ?) * (lat - ?) + (lon - ?) * (lon - ?)) AS distance2
        FROM osm_crossings
        ORDER BY distance2 ASC
        LIMIT 3`,
      args: [crossing.lat, crossing.lat, crossing.lon, crossing.lon],
    });

    const best = candidates.rows[0];
    if (!best) continue;

    await db.execute({
      sql: `INSERT INTO crossing_osm_links
        (crossing_id, osm_crossing_id, match_method, confidence, updated_at)
        VALUES (?, ?, 'nearest', ?, datetime('now'))
        ON CONFLICT(crossing_id) DO UPDATE SET
          osm_crossing_id=excluded.osm_crossing_id,
          match_method=excluded.match_method,
          confidence=excluded.confidence,
          updated_at=datetime('now')`,
      args: [crossing.id, best.osm_id, Number(best.distance2) < 0.00001 ? 0.99 : 0.8],
    });

    console.log(`MATCH ${crossing.name} -> OSM ${best.osm_id} confidence=${Number(best.distance2) < 0.00001 ? 0.99 : 0.8}`);
  }
}

async function main() {
  const { bbox, crossingId } = parseArgs();
  await ensureSchema();

  const query = buildQuery(parseBbox(bbox));
  console.log(query);
  const payload = await fetchOverpass(query);
  await importData(payload.elements ?? []);

  if (crossingId) {
    const result = await db.execute({
      sql: `SELECT * FROM crossing_osm_links WHERE crossing_id = ?`,
      args: [crossingId],
    });
    console.log(JSON.stringify(result.rows, null, 2));
  } else {
    await matchExistingCrossings();
  }

  console.log("OSM import complete.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
