import { NextResponse } from "next/server";
import { db } from "../../../../../lib/db";
import { prepareCrossingOsmProfile } from "../../../../../lib/crossingOsmFilter";

const OVERPASS_ENDPOINTS = [
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

function distanceMeters(aLat: number, aLon: number, bLat: number, bLon: number) {
  const latScale = 111320;
  const lonScale = 111320 * Math.cos((aLat * Math.PI) / 180);
  return Math.hypot((aLat - bLat) * latScale, (aLon - bLon) * lonScale);
}

async function fetchOverpass(query: string) {
  let lastError: unknown;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetch(`${endpoint}?${new URLSearchParams({ data: query })}`, {
        cache: "no-store",
        headers: { accept: "application/json", "user-agent": "Crossings/1.0 (meineschranke.com)" },
      });
      if (!response.ok) throw new Error(`Overpass HTTP ${response.status}`);
      return await response.json() as { elements?: any[] };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("All Overpass endpoints failed");
}

/**
 * Admin-only, explicit OSM import for one crossing. This endpoint writes the
 * OSM link and physical corridor; it is never called by live status requests.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const crossingId = String(id || "").trim();
  if (!crossingId) return NextResponse.json({ error: "Crossing-ID fehlt." }, { status: 400 });

  try {
    const crossingResult = await db.execute({
      sql: `SELECT id, name, lat, lon FROM crossings WHERE id = ? LIMIT 1`,
      args: [crossingId],
    });
    const crossing: any = crossingResult.rows[0];
    if (!crossing) return NextResponse.json({ error: "Bahnübergang nicht gefunden." }, { status: 404 });

    const lat = Number(crossing.lat);
    const lon = Number(crossing.lon);
    const query = `[out:json][timeout:60];node[railway=level_crossing](around:100,${lat},${lon})->.crossings;(.crossings;way(bn.crossings)[railway=rail];);out body geom;`;
    const payload = await fetchOverpass(query);
    const elements = Array.isArray(payload.elements) ? payload.elements : [];
    const candidates = elements
      .filter((element: any) => element.type === "node" && element.tags?.railway === "level_crossing")
      .map((element: any) => ({
        element,
        distance: distanceMeters(lat, lon, Number(element.lat), Number(element.lon)),
      }))
      .sort((a: any, b: any) => a.distance - b.distance);
    const nearest = candidates[0];
    const MAX_DISTANCE_METERS = 35;
    if (!nearest || nearest.distance > MAX_DISTANCE_METERS) {
      return NextResponse.json({
        error: "Kein eindeutig naher OSM-Bahnübergang gefunden.",
        nearestDistanceMeters: nearest ? Number(nearest.distance.toFixed(1)) : null,
        maxDistanceMeters: MAX_DISTANCE_METERS,
      }, { status: 422 });
    }

    const osmCrossing = nearest.element;
    const ways = elements.filter((element: any) =>
      element.type === "way" &&
      element.tags?.railway === "rail" &&
      Array.isArray(element.nodes) &&
      element.nodes.includes(Number(osmCrossing.id)) &&
      Array.isArray(element.geometry) &&
      element.geometry.length >= 2
    );
    if (!ways.length) {
      return NextResponse.json({ error: "Am OSM-Bahnübergang wurden keine zugehörigen Gleiswege gefunden." }, { status: 422 });
    }

    await db.execute({
      sql: `INSERT INTO osm_crossings (osm_id, lat, lon, tags_json, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(osm_id) DO UPDATE SET lat=excluded.lat, lon=excluded.lon,
          tags_json=excluded.tags_json, updated_at=datetime('now')`,
      args: [Number(osmCrossing.id), Number(osmCrossing.lat), Number(osmCrossing.lon), JSON.stringify(osmCrossing.tags || {})],
    });

    const wayIds: number[] = [];
    for (const way of ways) {
      const nodes = way.nodes.map(Number);
      const geometry = way.geometry.map((point: any) => ({ lat: Number(point.lat), lon: Number(point.lon) }));
      const crossingNodeIndex = nodes.indexOf(Number(osmCrossing.id));
      if (crossingNodeIndex < 0 || geometry.length !== nodes.length) continue;
      wayIds.push(Number(way.id));
      await db.execute({
        sql: `INSERT INTO osm_rail_ways (osm_id, tags_json, node_ids_json, geometry_json, osm_version, osm_timestamp, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(osm_id) DO UPDATE SET tags_json=excluded.tags_json,
            node_ids_json=excluded.node_ids_json, geometry_json=excluded.geometry_json,
            osm_version=excluded.osm_version, osm_timestamp=excluded.osm_timestamp, updated_at=datetime('now')`,
        args: [Number(way.id), JSON.stringify(way.tags || {}), JSON.stringify(nodes), JSON.stringify(geometry), way.version ?? null, way.timestamp ?? null],
      });
      await db.execute({
        sql: `INSERT INTO osm_crossing_rail_ways
          (crossing_osm_id, railway_way_id, crossing_node_index, way_direction, updated_at)
          VALUES (?, ?, ?, 'both', datetime('now'))
          ON CONFLICT(crossing_osm_id, railway_way_id) DO UPDATE SET
            crossing_node_index=excluded.crossing_node_index, updated_at=datetime('now')`,
        args: [Number(osmCrossing.id), Number(way.id), crossingNodeIndex],
      });
      for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
        await db.execute({
          sql: `INSERT INTO osm_rail_way_nodes (node_id, railway_way_id, node_index)
            VALUES (?, ?, ?)
            ON CONFLICT(node_id, railway_way_id) DO UPDATE SET node_index=excluded.node_index`,
          args: [nodes[nodeIndex], Number(way.id), nodeIndex],
        });
      }
    }

    if (!wayIds.length) return NextResponse.json({ error: "Die gefundenen Gleiswege konnten nicht importiert werden." }, { status: 422 });

    const confidence = nearest.distance <= 10 ? 0.99 : 0.95;
    await db.execute({
      sql: `INSERT INTO crossing_osm_links (crossing_id, osm_crossing_id, match_method, confidence, updated_at)
        VALUES (?, ?, 'nearest_local_admin_import', ?, datetime('now'))
        ON CONFLICT(crossing_id) DO UPDATE SET osm_crossing_id=excluded.osm_crossing_id,
          match_method=excluded.match_method, confidence=excluded.confidence, updated_at=datetime('now')`,
      args: [crossingId, Number(osmCrossing.id), confidence],
    });
    await db.execute({
      sql: `INSERT INTO crossing_osm_corridors
        (crossing_id, osm_crossing_id, railway_way_ids_json, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(crossing_id) DO UPDATE SET osm_crossing_id=excluded.osm_crossing_id,
          railway_way_ids_json=excluded.railway_way_ids_json, profile_json=NULL,
          profile_version=0, profile_built_at=NULL, updated_at=datetime('now')`,
      args: [crossingId, Number(osmCrossing.id), JSON.stringify([...new Set(wayIds)])],
    });

    const profile = await prepareCrossingOsmProfile(crossingId);
    return NextResponse.json({
      ok: true,
      crossingId,
      crossingName: String(crossing.name),
      osmCrossingId: Number(osmCrossing.id),
      distanceMeters: Number(nearest.distance.toFixed(1)),
      confidence,
      railwayWayIds: [...new Set(wayIds)],
      profile,
    });
  } catch (error) {
    console.error(`[OSM IMPORT API] crossing=${crossingId} failed:`, error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "OSM-Import fehlgeschlagen.",
    }, { status: 500 });
  }
}
