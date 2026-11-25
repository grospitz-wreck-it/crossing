#!/usr/bin/env node

import { createClient } from "@libsql/client";

const DATABASE_URL = process.env.TURSO_DATABASE_URL;
const AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!DATABASE_URL || !AUTH_TOKEN) {
  throw new Error("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN");
}

const db = createClient({ url: DATABASE_URL, authToken: AUTH_TOKEN });

const MAX_DISTANCE_METERS = 80;
const MULTI_TRACK_GROUP_METERS = 12;
const MIN_AMBIGUITY_GAP_METERS = 10;

function distanceMeters(aLat, aLon, bLat, bLon) {
  const latScale = 111320;
  const lonScale = 111320 * Math.cos((aLat * Math.PI) / 180);
  const dy = (aLat - bLat) * latScale;
  const dx = (aLon - bLon) * lonScale;
  return Math.hypot(dx, dy);
}

function parseTags(value) {
  try {
    const tags = JSON.parse(String(value || "{}"));
    return tags && typeof tags === "object" ? tags : {};
  } catch {
    return {};
  }
}

function getTrackIdentity(candidate) {
  const refs = new Set();
  const trackCounts = new Set();

  for (const way of candidate.ways) {
    const tags = way.tags;
    if (tags.ref) refs.add(String(tags.ref));
    if (tags.tracks) trackCounts.add(String(tags.tracks));
  }

  if (refs.size !== 1 || trackCounts.size !== 1) return null;
  const tracks = Number([...trackCounts][0]);
  if (!Number.isFinite(tracks) || tracks < 2) return null;

  return { ref: [...refs][0], tracks };
}

function canJoinMultiTrackGroup(anchor, candidate) {
  const anchorIdentity = getTrackIdentity(anchor);
  const candidateIdentity = getTrackIdentity(candidate);
  if (!anchorIdentity || !candidateIdentity) return false;

  return (
    anchorIdentity.ref === candidateIdentity.ref &&
    anchorIdentity.tracks === candidateIdentity.tracks &&
    distanceMeters(anchor.lat, anchor.lon, candidate.lat, candidate.lon) <= MULTI_TRACK_GROUP_METERS
  );
}

async function loadCandidates(crossing) {
  const latDelta = MAX_DISTANCE_METERS / 110000;
  const lonDelta = MAX_DISTANCE_METERS /
    (111320 * Math.max(0.2, Math.cos((Number(crossing.lat) * Math.PI) / 180)));

  const result = await db.execute({
    sql: `
      SELECT
        oc.osm_id,
        oc.lat,
        oc.lon,
        oc.tags_json,
        crw.railway_way_id,
        rw.tags_json AS way_tags_json
      FROM osm_crossings oc
      JOIN osm_crossing_rail_ways crw
        ON crw.crossing_osm_id = oc.osm_id
      JOIN osm_rail_ways rw
        ON rw.osm_id = crw.railway_way_id
      WHERE oc.lat BETWEEN ? AND ?
        AND oc.lon BETWEEN ? AND ?
      ORDER BY oc.osm_id, crw.railway_way_id
    `,
    args: [
      Number(crossing.lat) - latDelta,
      Number(crossing.lat) + latDelta,
      Number(crossing.lon) - lonDelta,
      Number(crossing.lon) + lonDelta,
    ],
  });

  const byId = new Map();
  for (const row of result.rows) {
    const id = Number(row.osm_id);
    let candidate = byId.get(id);
    if (!candidate) {
      candidate = {
        id,
        lat: Number(row.lat),
        lon: Number(row.lon),
        tags: parseTags(row.tags_json),
        ways: [],
        distance: distanceMeters(
          Number(crossing.lat),
          Number(crossing.lon),
          Number(row.lat),
          Number(row.lon),
        ),
      };
      byId.set(id, candidate);
    }
    candidate.ways.push({
      id: Number(row.railway_way_id),
      tags: parseTags(row.way_tags_json),
    });
  }

  return [...byId.values()]
    .filter((candidate) => candidate.distance <= MAX_DISTANCE_METERS)
    .sort((a, b) => a.distance - b.distance);
}

async function loadManualTrackSelection(crossingId) {
  const result = await db.execute({
    sql: "SELECT rules FROM crossings WHERE id = ? LIMIT 1",
    args: [String(crossingId)],
  });
  const rawRules = result.rows[0]?.rules;
  let rules = rawRules;
  if (typeof rawRules === "string") {
    try { rules = JSON.parse(rawRules); } catch { rules = null; }
  }
  if (!rules || typeof rules !== "object" || !Array.isArray(rules.selectedOsmTracks)) {
    return null;
  }
  return [...new Set(rules.selectedOsmTracks
    .map((track) => String(track?.wayId ?? "").trim())
    .filter((wayId) => /^\\d+$/.test(wayId)))];
}

async function linkCandidate(crossing, anchor, group) {
  const osmIds = group.map((candidate) => candidate.id);
  const importedWayIds = [...new Set(group.flatMap((candidate) =>
    candidate.ways.map((way) => way.id),
  ))];
  const manualWayIds = await loadManualTrackSelection(crossing.id);
  // Preserve an explicit admin selection, including an intentional empty set.
  const wayIds = manualWayIds ?? importedWayIds;

  if (!importedWayIds.length) {
    throw new Error("Selected OSM crossing group has no associated railway ways");
  }

  const occupied = await db.execute({
    sql: `
      SELECT crossing_id, osm_crossing_id
      FROM crossing_osm_links
      WHERE crossing_id <> ?
        AND osm_crossing_id IN (${osmIds.map(() => "?").join(",")})
      LIMIT 1
    `,
    args: [String(crossing.id), ...osmIds],
  });

  if (occupied.rows.length) {
    const row = occupied.rows[0];
    throw new Error(
      `OSM node ${row.osm_crossing_id} is already linked to crossing ${row.crossing_id}`,
    );
  }

  const existing = await db.execute({
    sql: "SELECT osm_crossing_id FROM crossing_osm_links WHERE crossing_id = ?",
    args: [String(crossing.id)],
  });
  if (existing.rows.length) {
    throw new Error("Crossing already has an OSM link; refusing to overwrite it");
  }

  const confidence = anchor.distance <= 20 ? 0.99 : 0.9;

  await db.batch([
    {
      sql: `
        INSERT INTO crossing_osm_links
          (crossing_id, osm_crossing_id, match_method, confidence, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `,
      args: [
        String(crossing.id),
        anchor.id,
        group.length > 1 ? "local_multitrack_osm" : "local_osm_network",
        confidence,
      ],
    },
    {
      sql: `
        INSERT INTO crossing_osm_corridors
          (crossing_id, osm_crossing_id, railway_way_ids_json, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(crossing_id) DO UPDATE SET
          osm_crossing_id = excluded.osm_crossing_id,
          railway_way_ids_json = excluded.railway_way_ids_json,
          profile_json = NULL,
          profile_version = 0,
          profile_built_at = NULL,
          updated_at = excluded.updated_at
      `,
      args: [String(crossing.id), anchor.id, JSON.stringify(wayIds)],
    },
  ]);

  console.log(
    `LINK ${crossing.name}: anchor=OSM ${anchor.id}, ` +
    `nodes=[${osmIds.join(",")}], ways=[${wayIds.join(",")}], ` +
    `distance=${anchor.distance.toFixed(1)}m, confidence=${confidence}`,
  );
}

async function main() {
  const crossings = await db.execute({
    sql: `
      SELECT c.id, c.name, c.lat, c.lon
      FROM crossings c
      LEFT JOIN crossing_osm_links l ON l.crossing_id = c.id
      LEFT JOIN crossing_osm_corridors cr ON cr.crossing_id = c.id
      WHERE c.status = 'active'
        AND (l.crossing_id IS NULL OR cr.crossing_id IS NULL)
      ORDER BY c.name
    `,
    args: [],
  });

  let linked = 0;
  let reviewed = 0;

  console.log(`Local OSM resolver: ${crossings.rows.length} active crossing(s) need links/corridors`);

  for (const crossing of crossings.rows) {
    try {
      const candidates = await loadCandidates(crossing);
      if (!candidates.length) {
        throw new Error(`No locally indexed OSM crossing with associated rail ways within ${MAX_DISTANCE_METERS}m`);
      }

      const anchor = candidates[0];
      const group = [anchor];

      for (const candidate of candidates.slice(1)) {
        if (canJoinMultiTrackGroup(anchor, candidate)) {
          group.push(candidate);
        }
      }

      const groupedIds = new Set(group.map((candidate) => candidate.id));
      const alternatives = candidates.filter((candidate) => !groupedIds.has(candidate.id));
      const secondDistance = alternatives[0]?.distance ?? Infinity;

      if (secondDistance - anchor.distance < MIN_AMBIGUITY_GAP_METERS) {
        throw new Error(
          `Ambiguous local OSM match: nearest=${anchor.distance.toFixed(1)}m, ` +
          `next unrelated candidate=${secondDistance.toFixed(1)}m; manual review required`,
        );
      }

      await linkCandidate(crossing, anchor, group);
      linked += 1;
    } catch (error) {
      reviewed += 1;
      console.error(
        `REVIEW ${crossing.name} (${crossing.id}):`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  console.log(
    `LOCAL OSM RESOLUTION COMPLETE: linked=${linked} review=${reviewed} total=${crossings.rows.length}`,
  );

  if (reviewed > 0) {
    throw new Error(`${reviewed} crossing(s) need review; see log entries above`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
