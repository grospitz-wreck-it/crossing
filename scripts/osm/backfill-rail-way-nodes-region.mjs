#!/usr/bin/env node

import { createClient } from "@libsql/client";

const DATABASE_URL = process.env.TURSO_DATABASE_URL;
const AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!DATABASE_URL || !AUTH_TOKEN) {
  throw new Error("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN");
}

const db = createClient({ url: DATABASE_URL, authToken: AUTH_TOKEN });

const WAY_BATCH_SIZE = 1000;
const INSERT_BATCH_SIZE = 5000;
const startedAt = Date.now();

let totalWays = 0;
let totalNodes = 0;

console.log("=== OSM RAIL WAY NODE BACKFILL v3 (MISSING-ONLY) ===");
console.log("Selecting missing ways directly; no MAX(id) resume cursor.");

while (true) {
  const result = await db.execute({
    sql: `
      SELECT w.osm_id, w.node_ids_json
      FROM osm_rail_ways w
      WHERE NOT EXISTS (
        SELECT 1
        FROM osm_rail_way_nodes n
        WHERE n.railway_way_id = w.osm_id
      )
      AND CASE
        WHEN json_valid(w.node_ids_json)
        THEN json_array_length(w.node_ids_json) >= 2
        ELSE 0
      END
      ORDER BY w.osm_id
      LIMIT ?
    `,
    args: [WAY_BATCH_SIZE],
  });

  const rows = result.rows;
  if (!rows.length) break;

  let pendingStatements = [];
  let pendingWays = 0;

  const flush = async () => {
    if (!pendingStatements.length) return;
    await db.batch(pendingStatements);
    totalNodes += pendingStatements.length;
    totalWays += pendingWays;
    pendingStatements = [];
    pendingWays = 0;
  };

  for (const row of rows) {
    let nodes;
    try {
      nodes = JSON.parse(String(row.node_ids_json || "[]"));
    } catch {
      throw new Error(`Invalid node_ids_json for way ${row.osm_id}; refusing to skip it.`);
    }

    if (!Array.isArray(nodes) || nodes.length < 2) {
      throw new Error(`Way ${row.osm_id} no longer has a valid node list; refusing to skip it.`);
    }

    const wayId = Number(row.osm_id);
    if (!Number.isSafeInteger(wayId)) {
      throw new Error(`Invalid OSM way id: ${row.osm_id}`);
    }

    const wayStatements = [];
    for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
      const nodeId = Number(nodes[nodeIndex]);
      if (!Number.isSafeInteger(nodeId)) {
        throw new Error(`Invalid node id in OSM way ${wayId} at index ${nodeIndex}`);
      }

      wayStatements.push({
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

    // Never split a single Way across write batches. If a process stops,
    // the next run can safely retry every Way that has no index rows.
    if (
      pendingStatements.length > 0 &&
      pendingStatements.length + wayStatements.length > INSERT_BATCH_SIZE
    ) {
      await flush();
    }

    pendingStatements.push(...wayStatements);
    pendingWays += 1;
  }

  await flush();

  const elapsed = (Date.now() - startedAt) / 1000;
  console.log(
    `processed_ways=${totalWays} ` +
    `batch_rows=${rows.length} ` +
    `node_mappings_written=${totalNodes} ` +
    `elapsed=${elapsed.toFixed(1)}s`,
  );
}

const verification = await db.execute(`
  SELECT
    COUNT(*) AS total_ways,
    SUM(CASE WHEN EXISTS (
      SELECT 1 FROM osm_rail_way_nodes n
      WHERE n.railway_way_id = w.osm_id
    ) THEN 1 ELSE 0 END) AS indexed_ways,
    SUM(CASE WHEN NOT EXISTS (
      SELECT 1 FROM osm_rail_way_nodes n
      WHERE n.railway_way_id = w.osm_id
    ) THEN 1 ELSE 0 END) AS missing_ways
  FROM osm_rail_ways w
`);

console.log("\n=== COMPLETE ===");
console.log("processed ways:", totalWays);
console.log("node mappings written:", totalNodes);
console.log("verification:", verification.rows[0]);
console.log("elapsed:", ((Date.now() - startedAt) / 1000).toFixed(1), "s");

const missing = Number(verification.rows[0]?.missing_ways ?? 0);
if (missing > 0) {
  throw new Error(`Backfill finished with ${missing} ways still missing from the node index.`);
}
