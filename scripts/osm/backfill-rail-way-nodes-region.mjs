#!/usr/bin/env node

import { createClient } from "@libsql/client";

const DATABASE_URL = process.env.TURSO_DATABASE_URL;
const AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!DATABASE_URL || !AUTH_TOKEN) {
  throw new Error("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN");
}

const db = createClient({
  url: DATABASE_URL,
  authToken: AUTH_TOKEN,
});

const WAY_BATCH_SIZE = 2000;
const INSERT_BATCH_SIZE = 5000;

const startedAt = Date.now();

console.log("=== OSM RAIL WAY NODE BACKFILL v2 ===");

const existing = await db.execute(`
  SELECT COALESCE(MAX(railway_way_id), 0) AS max_way_id
  FROM osm_rail_way_nodes
`);

let lastWayId = Number(existing.rows[0]?.max_way_id ?? 0);

console.log("Resume from railway_way_id:", lastWayId);

let totalWays = 0;
let totalNodes = 0;

while (true) {
  const result = await db.execute({
    sql: `
      SELECT osm_id, node_ids_json
      FROM osm_rail_ways
      WHERE osm_id > ?
      ORDER BY osm_id
      LIMIT ?
    `,
    args: [lastWayId, WAY_BATCH_SIZE],
  });

  const rows = result.rows;

  if (!rows.length) break;

  const statements = [];

  for (const row of rows) {
    let nodes;

    try {
      nodes = JSON.parse(String(row.node_ids_json || "[]"));
    } catch {
      continue;
    }

    if (!Array.isArray(nodes)) continue;

    const wayId = Number(row.osm_id);

    for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
      const nodeId = Number(nodes[nodeIndex]);

      if (!Number.isFinite(nodeId) || !Number.isFinite(wayId)) continue;

      statements.push({
        sql: `
          INSERT INTO osm_rail_way_nodes
            (node_id, railway_way_id, node_index)
          VALUES (?, ?, ?)
          ON CONFLICT(node_id, railway_way_id) DO UPDATE SET
            node_index = excluded.node_index
        `,
        args: [nodeId, wayId, nodeIndex],
      });
    }
  }

  for (let i = 0; i < statements.length; i += INSERT_BATCH_SIZE) {
    const batch = statements.slice(i, i + INSERT_BATCH_SIZE);

    if (batch.length) {
      await db.batch(batch);
      totalNodes += batch.length;
    }
  }

  totalWays += rows.length;

  lastWayId = Number(rows[rows.length - 1].osm_id);

  const elapsed = (Date.now() - startedAt) / 1000;
  const rate = totalWays / Math.max(elapsed, 0.001);

  console.log(
    `ways=${totalWays} ` +
    `lastWayId=${lastWayId} ` +
    `nodes=${totalNodes} ` +
    `rate=${rate.toFixed(1)} ways/s ` +
    `elapsed=${elapsed.toFixed(1)}s`
  );
}

const count = await db.execute(`
  SELECT COUNT(*) AS count
  FROM osm_rail_way_nodes
`);

console.log("\n=== COMPLETE ===");
console.log("processed ways:", totalWays);
console.log("new node mappings:", totalNodes);
console.log("database rows:", count.rows[0]?.count);
console.log(
  "elapsed:",
  ((Date.now() - startedAt) / 1000).toFixed(1),
  "s"
);
