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

const INSERT_BATCH_SIZE = 5000;

const startedAt = Date.now();

console.log("=== OSM CORRIDOR RAIL WAY NODE BACKFILL ===");

/*
 * 1. Alle Ways aus den vorhandenen Crossing-Corridors sammeln.
 *
 * Wir verändern keine bestehenden Daten und indexieren ausschließlich
 * Ways, die bereits einem Crossing-Corridor zugeordnet sind.
 */
const corridors = await db.execute(`
  SELECT crossing_id, railway_way_ids_json
  FROM crossing_osm_corridors
  WHERE railway_way_ids_json IS NOT NULL
`);

const wayIds = new Set();

for (const row of corridors.rows) {
  try {
    const ids = JSON.parse(
      String(row.railway_way_ids_json || "[]"),
    );

    if (!Array.isArray(ids)) continue;

    for (const id of ids) {
      const wayId = Number(id);

      if (Number.isFinite(wayId)) {
        wayIds.add(wayId);
      }
    }
  } catch {
    console.warn(
      "Invalid railway_way_ids_json for crossing:",
      String(row.crossing_id),
    );
  }
}

const allWayIds = [...wayIds];

console.log("crossing corridors:", corridors.rows.length);
console.log("unique corridor ways:", allWayIds.length);

if (!allWayIds.length) {
  console.log("No corridor ways found.");
  process.exit(0);
}

/*
 * 2. Bereits indexierte Ways feststellen.
 *
 * Diese Ways werden komplett übersprungen.
 * Dadurch erzeugen wir keine unnötigen Writes.
 */
const existingWayIds = new Set();

const CHECK_BATCH_SIZE = 500;

for (
  let i = 0;
  i < allWayIds.length;
  i += CHECK_BATCH_SIZE
) {
  const batch = allWayIds.slice(
    i,
    i + CHECK_BATCH_SIZE,
  );

  const placeholders = batch.map(() => "?").join(",");

  const result = await db.execute({
    sql: `
      SELECT DISTINCT railway_way_id
      FROM osm_rail_way_nodes
      WHERE railway_way_id IN (${placeholders})
    `,
    args: batch,
  });

  for (const row of result.rows) {
    existingWayIds.add(
      Number(row.railway_way_id),
    );
  }
}

const missingWayIds = allWayIds.filter(
  (id) => !existingWayIds.has(id),
);

console.log(
  "already indexed ways:",
  existingWayIds.size,
);

console.log(
  "missing corridor ways:",
  missingWayIds.length,
);

if (!missingWayIds.length) {
  console.log("\n=== NOTHING TO DO ===");
  console.log(
    "All corridor ways are already indexed.",
  );
  process.exit(0);
}

/*
 * 3. Fehlende Ways aus osm_rail_ways laden.
 *
 * Wir lesen ausschließlich die konkret benötigten Ways.
 */
let processedWays = 0;
let writtenNodes = 0;

for (
  let i = 0;
  i < missingWayIds.length;
  i += CHECK_BATCH_SIZE
) {
  const batchWayIds = missingWayIds.slice(
    i,
    i + CHECK_BATCH_SIZE,
  );

  const placeholders = batchWayIds
    .map(() => "?")
    .join(",");

  const result = await db.execute({
    sql: `
      SELECT osm_id, node_ids_json
      FROM osm_rail_ways
      WHERE osm_id IN (${placeholders})
    `,
    args: batchWayIds,
  });

  const statements = [];

  for (const row of result.rows) {
    const wayId = Number(row.osm_id);

    let nodes;

    try {
      nodes = JSON.parse(
        String(row.node_ids_json || "[]"),
      );
    } catch {
      console.warn(
        "Invalid node_ids_json for way:",
        wayId,
      );
      continue;
    }

    if (!Array.isArray(nodes)) continue;

    processedWays += 1;

    for (
      let nodeIndex = 0;
      nodeIndex < nodes.length;
      nodeIndex += 1
    ) {
      const nodeId = Number(nodes[nodeIndex]);

      if (
        !Number.isFinite(nodeId) ||
        !Number.isFinite(wayId)
      ) {
        continue;
      }

      statements.push({
        sql: `
          INSERT INTO osm_rail_way_nodes
            (node_id, railway_way_id, node_index)
          VALUES (?, ?, ?)
          ON CONFLICT(node_id, railway_way_id)
          DO UPDATE SET
            node_index = excluded.node_index
        `,
        args: [
          nodeId,
          wayId,
          nodeIndex,
        ],
      });
    }
  }

  /*
   * Turso-Batches.
   */
  for (
    let j = 0;
    j < statements.length;
    j += INSERT_BATCH_SIZE
  ) {
    const insertBatch = statements.slice(
      j,
      j + INSERT_BATCH_SIZE,
    );

    if (!insertBatch.length) continue;

    await db.batch(insertBatch);

    writtenNodes += insertBatch.length;
  }

  const elapsed =
    (Date.now() - startedAt) / 1000;

  console.log(
    `ways=${processedWays}/${missingWayIds.length} ` +
    `nodes=${writtenNodes} ` +
    `elapsed=${elapsed.toFixed(1)}s`,
  );
}

/*
 * 4. Abschlussstatistik.
 */
const count = await db.execute(`
  SELECT
    COUNT(*) AS rows,
    COUNT(DISTINCT railway_way_id) AS ways
  FROM osm_rail_way_nodes
`);

console.log("\n=== COMPLETE ===");
console.log(
  "corridor ways:",
  allWayIds.length,
);
console.log(
  "already indexed:",
  existingWayIds.size,
);
console.log(
  "newly processed:",
  processedWays,
);
console.log(
  "node mappings written:",
  writtenNodes,
);
console.log(
  "database rows:",
  count.rows[0]?.rows,
);
console.log(
  "indexed ways:",
  count.rows[0]?.ways,
);
console.log(
  "elapsed:",
  ((Date.now() - startedAt) / 1000).toFixed(1) + "s",
);
