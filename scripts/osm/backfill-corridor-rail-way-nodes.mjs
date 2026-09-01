import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || process.env.DB_URL,
  authToken: process.env.TURSO_AUTH_TOKEN || process.env.DB_AUTH_TOKEN,
});

const WAY_BATCH_SIZE = 100;
const NODE_BATCH_SIZE = 500;

function placeholders(count) {
  return Array.from({ length: count }, () => "?").join(",");
}

async function main() {
  const corridors = await db.execute(`SELECT railway_way_ids FROM crossing_osm_corridors`);
  const wayIds = new Set();
  for (const row of corridors.rows) {
    try {
      for (const id of JSON.parse(String(row.railway_way_ids || "[]"))) wayIds.add(Number(id));
    } catch {}
  }

  if (!wayIds.size) {
    console.log("No corridor railway ways found.");
    return;
  }

  const existing = new Set();
  for (let i = 0; i < [...wayIds].length; i += WAY_BATCH_SIZE) {
    const batch = [...wayIds].slice(i, i + WAY_BATCH_SIZE);
    const result = await db.execute({
      sql: `SELECT DISTINCT railway_way_id FROM osm_rail_way_nodes WHERE railway_way_id IN (${placeholders(batch.length)})`,
      args: batch,
    });
    for (const row of result.rows) existing.add(Number(row.railway_way_id));
  }

  const missing = [...wayIds].filter((id) => !existing.has(id));
  console.log(`Corridor ways: ${wayIds.size}; already indexed: ${existing.size}; missing: ${missing.length}`);

  let inserted = 0;
  for (let i = 0; i < missing.length; i += WAY_BATCH_SIZE) {
    const batch = missing.slice(i, i + WAY_BATCH_SIZE);
    const ways = await db.execute({
      sql: `SELECT osm_id, node_ids_json FROM osm_rail_ways WHERE osm_id IN (${placeholders(batch.length)})`,
      args: batch.map(String),
    });

    const rows = [];
    for (const way of ways.rows) {
      let nodes = [];
      try { nodes = JSON.parse(String(way.node_ids_json || "[]")); } catch {}
      nodes.forEach((nodeId, nodeIndex) => {
        const node = Number(nodeId);
        const wayId = Number(way.osm_id);
        if (Number.isSafeInteger(node) && Number.isSafeInteger(wayId)) {
          rows.push({ node_id: node, railway_way_id: wayId, node_index: nodeIndex });
        }
      });
    }

    for (let j = 0; j < rows.length; j += NODE_BATCH_SIZE) {
      const chunk = rows.slice(j, j + NODE_BATCH_SIZE);
      await db.batch(
        chunk.map((row) => ({
          sql: `INSERT OR IGNORE INTO osm_rail_way_nodes (node_id, railway_way_id, node_index) VALUES (?, ?, ?)`,
          args: [row.node_id, row.railway_way_id, row.node_index],
        })),
        "write",
      );
      inserted += chunk.length;
    }
    console.log(`Processed ${Math.min(i + batch.length, missing.length)}/${missing.length} ways`);
  }

  console.log(`Inserted ${inserted} node mappings.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
