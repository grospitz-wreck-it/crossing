import { createClient } from "@libsql/client";

export function buildRailwayGraph(rows) {
  const graph = new Map();
  const ways = new Map();
  for (const row of rows) {
    const nodes = JSON.parse(row.node_ids_json || "[]").map(Number);
    const geometry = JSON.parse(row.geometry_json || "[]");
    if (nodes.length < 2) continue;
    ways.set(Number(row.osm_id), { id: Number(row.osm_id), nodes, geometry });
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      if (!graph.has(node)) graph.set(node, []);
      if (i > 0) graph.get(node).push({ node: nodes[i - 1], wayId: Number(row.osm_id) });
      if (i < nodes.length - 1) graph.get(node).push({ node: nodes[i + 1], wayId: Number(row.osm_id) });
    }
  }
  return { graph, ways };
}

export function findPath(graph, start, targets) {
  const targetSet = new Set([...targets].map(Number));
  const queue = [Number(start)];
  const previous = new Map([[Number(start), null]]);
  const viaWay = new Map();
  while (queue.length) {
    const node = queue.shift();
    if (targetSet.has(node)) {
      const path = [];
      let cur = node;
      while (cur !== null) {
        path.push({ node: cur, wayId: viaWay.get(cur) ?? null });
        cur = previous.get(cur);
      }
      return path.reverse();
    }
    for (const edge of graph.get(node) ?? []) {
      if (previous.has(edge.node)) continue;
      previous.set(edge.node, node);
      viaWay.set(edge.node, edge.wayId);
      queue.push(edge.node);
    }
  }
  return null;
}

export async function diagnose(db, southCrossingId, northCrossingId) {
  const waysResult = await db.execute("SELECT osm_id,node_ids_json,geometry_json FROM osm_rail_ways");
  const links = await db.execute({
    sql: "SELECT crossing_osm_id,railway_way_id,crossing_node_index FROM osm_crossing_rail_ways WHERE crossing_osm_id IN (?,?)",
    args: [southCrossingId, northCrossingId],
  });
  const { graph } = buildRailwayGraph(waysResult.rows);
  const southWays = links.rows.filter((r) => Number(r.crossing_osm_id) === Number(southCrossingId));
  const northWays = links.rows.filter((r) => Number(r.crossing_osm_id) === Number(northCrossingId));
  const southTargets = new Set();
  const northTargets = new Set();
  const crossingNodes = new Map();
  for (const link of links.rows) {
    const row = waysResult.rows.find((w) => Number(w.osm_id) === Number(link.railway_way_id));
    if (!row) continue;
    const nodes = JSON.parse(row.node_ids_json || "[]").map(Number);
    const node = nodes[Number(link.crossing_node_index)];
    crossingNodes.set(Number(link.crossing_osm_id), node);
    if (Number(link.crossing_osm_id) === Number(southCrossingId)) southTargets.add(node);
    else northTargets.add(node);
  }
  const start = [...southTargets][0];
  const path = findPath(graph, start, northTargets);
  const wayIds = [...new Set((path ?? []).map((p) => p.wayId).filter(Boolean))];
  return { start, path, wayIds, southWays, northWays, crossingNodes };
}

if (process.argv[1]?.endsWith("railway-graph.mjs")) {
  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;
  if (!url || !token) throw new Error("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN");
  const [south = "21303992", north = "201170629"] = process.argv.slice(2);
  const db = createClient({ url, authToken: token });
  const result = await diagnose(db, Number(south), Number(north));
  console.log("OSM RAIL GRAPH");
  console.log(`South crossing: ${south}`);
  console.log(`North crossing: ${north}`);
  console.log(`South ways: ${result.southWays.map((r) => r.railway_way_id).join(", ")}`);
  console.log(`North ways: ${result.northWays.map((r) => r.railway_way_id).join(", ")}`);
  console.log(`Path ways: ${result.wayIds.join(" -> ")}`);
  console.log(`Path nodes: ${(result.path ?? []).map((p) => p.node).join(" -> ")}`);
}
