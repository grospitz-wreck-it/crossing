import { NextResponse } from "next/server";

type Point = { lat: number; lon: number };
type LineRelation = {
  id: number;
  routeType: string;
  ref: string;
  name: string;
  from: string;
  to: string;
  network?: string;
  operator?: string;
};
type Candidate = {
  kind: "route" | "track";
  routeType: "tracks" | "railway" | "track";
  ref: string;
  name: string;
  from: string;
  to: string;
  distanceMeters: number;
  wayId: number;
  relationId: number | null;
  lineRelations: LineRelation[];
  source: string;
  waysCount: number;
  segments: Point[][];
};

function pointSegmentDistanceMeters(lat: number, lon: number, a: Point, b: Point) {
  const scale = 111320;
  const x = (lon - a.lon) * scale * Math.cos((lat * Math.PI) / 180);
  const y = (lat - a.lat) * scale;
  const bx = (b.lon - a.lon) * scale * Math.cos((lat * Math.PI) / 180);
  const by = (b.lat - a.lat) * scale;
  const denom = bx * bx + by * by;
  let t = denom ? (x * bx + y * by) / denom : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - bx * t, y - by * t);
}

function geometryDistanceMeters(lat: number, lon: number, geometry: Point[]) {
  let best = Infinity;
  for (let i = 1; i < geometry.length; i += 1) best = Math.min(best, pointSegmentDistanceMeters(lat, lon, geometry[i - 1], geometry[i]));
  return best;
}

function makeCandidate(lat: number, lon: number, geometry: Point[], tags: Record<string, string | undefined>, wayId: number, source: string): Candidate | null {
  const distanceMeters = geometryDistanceMeters(lat, lon, geometry);
  if (!Number.isFinite(distanceMeters) || distanceMeters > 200) return null;
  return {
    kind: "track",
    routeType: "track",
    ref: String(tags.ref || ""),
    name: String(tags.name || ""),
    from: String(tags.from || ""),
    to: String(tags.to || ""),
    distanceMeters: Math.round(distanceMeters),
    wayId,
    relationId: null,
    lineRelations: [],
    source,
    waysCount: 1,
    segments: [geometry],
  };
}

function normalizeRouteRef(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, " ");
}

function normalizeRouteName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9äöüß]+/gi, " ").replace(/\s+/g, " ").trim();
}

function mergeLineRelations(target: LineRelation[], incoming: LineRelation[]) {
  const seen = new Set(target.map((relation) => relation.id));
  for (const relation of incoming) {
    if (seen.has(relation.id)) continue;
    target.push(relation);
    seen.add(relation.id);
  }
  return target;
}

function groupCandidates(candidates: Candidate[]) {
  const grouped = new Map<string, Candidate>();

  for (const candidate of candidates) {
    const ref = normalizeRouteRef(candidate.ref);
    const name = normalizeRouteName(candidate.name);
    // The physical OSM way/railway ref is the identity of the infrastructure.
    // Passenger train relations are metadata attached to that physical track;
    // they must never replace the physical ref (e.g. 2982/2992).
    const key = ref
      ? `ref:${ref}`
      : name
        ? `name:${candidate.routeType}:${name}`
        : `way:${candidate.routeType}:${candidate.wayId}`;

    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...candidate, segments: [...candidate.segments], lineRelations: [...candidate.lineRelations] });
      continue;
    }

    existing.kind = existing.kind === "route" || candidate.kind === "route" ? "route" : "track";
    existing.routeType = existing.routeType === "track" && candidate.routeType !== "track" ? candidate.routeType : existing.routeType;
    existing.ref = existing.ref || candidate.ref;
    existing.name = existing.name || candidate.name;
    existing.from = existing.from || candidate.from;
    existing.to = existing.to || candidate.to;
    existing.relationId = existing.relationId ?? candidate.relationId;
    existing.waysCount += candidate.waysCount;
    existing.distanceMeters = Math.min(existing.distanceMeters, candidate.distanceMeters);
    existing.segments.push(...candidate.segments);
    mergeLineRelations(existing.lineRelations, candidate.lineRelations);
  }

  const groupedCandidates = [...grouped.values()];
  const referencedCandidates = groupedCandidates.filter((candidate) => normalizeRouteRef(candidate.ref).length > 0);
  const visibleCandidates = referencedCandidates.length > 0 ? referencedCandidates : groupedCandidates;

  return visibleCandidates
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, 8);
}

async function tryOverpass(lat: number, lon: number) {
  // Railway infrastructure and passenger-line relations are different OSM
  // concepts. route=train is the important one for RB/RE/IC/ICE line mapping;
  // route=railway/tracks remains useful for physical infrastructure.
  const query = `[out:json][timeout:20];way(around:200,${lat},${lon})[railway=rail];out geom tags;rel(bw)[type=route][route~"^(train|light_rail|railway|tracks)$"];out tags;`;
  const endpoints = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
  let lastError = "";

  for (const endpoint of endpoints) {
    try {
      const url = `${endpoint}?${new URLSearchParams({ data: query }).toString()}`;
      const response = await fetch(url, { cache: "no-store", headers: { accept: "application/json", "user-agent": "Crossings/1.0 (meineschranke.com)" } });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        lastError = `${endpoint} HTTP_${response.status}${body ? ` ${body.slice(0, 180)}` : ""}`;
        continue;
      }
      const data = await response.json();
      const elements = Array.isArray(data?.elements) ? data.elements : [];
      const ways = elements.filter((element: any) => element?.type === "way" && Array.isArray(element?.geometry));
      const relations = elements.filter((element: any) => element?.type === "relation");
      const relationByWay = new Map<number, LineRelation[]>();

      for (const relation of relations) {
        const routeType = String(relation.tags?.route || "");
        if (relation.tags?.type !== "route" || !["train", "light_rail", "railway", "tracks"].includes(routeType)) continue;
        const lineRelation: LineRelation = {
          id: Number(relation.id),
          routeType,
          ref: String(relation.tags?.ref || ""),
          name: String(relation.tags?.name || ""),
          from: String(relation.tags?.from || ""),
          to: String(relation.tags?.to || ""),
          network: relation.tags?.network ? String(relation.tags.network) : undefined,
          operator: relation.tags?.operator ? String(relation.tags.operator) : undefined,
        };
        for (const member of relation.members || []) {
          if (member.type !== "way") continue;
          const list = relationByWay.get(Number(member.ref)) || [];
          list.push(lineRelation);
          relationByWay.set(Number(member.ref), list);
        }
      }

      const candidates: Candidate[] = [];
      for (const way of ways) {
        const geometry: Point[] = way.geometry.map((point: any) => ({ lat: Number(point.lat), lon: Number(point.lon) })).filter((point: Point) => Number.isFinite(point.lat) && Number.isFinite(point.lon));
        if (geometry.length < 2) continue;
        const local = makeCandidate(lat, lon, geometry, way.tags || {}, Number(way.id), "openstreetmap");
        if (!local) continue;
        const relationsForWay = relationByWay.get(Number(way.id)) || [];
        local.lineRelations = relationsForWay;
        if (!relationsForWay.length) {
          candidates.push(local);
          continue;
        }
        // Keep the physical OSM candidate intact and attach every passenger
        // line relation to it. This is what lets us distinguish two parallel
        // tracks such as 2982 and 2992 even when different lines use them.
        candidates.push({
          ...local,
          lineRelations: relationsForWay,
          relationId: relationsForWay[0]?.id ?? null,
        });
      }
      return { status: "OK" as const, candidates: groupCandidates(candidates), endpoint, wayCount: ways.length, relationCount: relations.length };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  return { status: "OVERPASS_ERROR" as const, error: lastError, candidates: [] as Candidate[] };
}

function parseOsmMap(xml: string, lat: number, lon: number) {
  const nodes = new Map<string, Point>();
  for (const match of xml.matchAll(/<node\b[^>]*\bid="(\d+)"[^>]*\blat="([+-]?[\d.]+)"[^>]*\blon="([+-]?[\d.]+)"[^>]*\/>/g)) nodes.set(match[1], { lat: Number(match[2]), lon: Number(match[3]) });
  const candidates: Candidate[] = [];
  for (const wayMatch of xml.matchAll(/<way\b[^>]*\bid="(\d+)"[^>]*>([\s\S]*?)<\/way>/g)) {
    const body = wayMatch[2];
    const tags: Record<string, string> = {};
    for (const tagMatch of body.matchAll(/<tag\b[^>]*\bk="([^"]+)"[^>]*\bv="([^"]*)"[^>]*\/>/g)) tags[tagMatch[1]] = tagMatch[2];
    if (tags.railway !== "rail") continue;
    const geometry: Point[] = [];
    for (const nodeMatch of body.matchAll(/<nd\b[^>]*\bref="(\d+)"[^>]*\/>/g)) {
      const point = nodes.get(nodeMatch[1]);
      if (point) geometry.push(point);
    }
    if (geometry.length < 2) continue;
    const candidate = makeCandidate(lat, lon, geometry, tags, Number(wayMatch[1]), "openstreetmap-map-api");
    if (candidate) candidates.push(candidate);
  }
  return groupCandidates(candidates);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return NextResponse.json({ status: "INVALID_COORDINATES", candidates: [] }, { status: 400 });
  const overpass = await tryOverpass(lat, lon);
  if (overpass.status === "OK") return NextResponse.json(overpass);
  try {
    const delta = 0.0022;
    const bbox = `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`;
    const mapUrl = `https://api.openstreetmap.org/api/0.6/map?bbox=${encodeURIComponent(bbox)}`;
    const response = await fetch(mapUrl, { cache: "no-store", headers: { accept: "application/xml", "user-agent": "Crossings/1.0 (meineschranke.com)" } });
    if (response.ok) {
      const xml = await response.text();
      const candidates = parseOsmMap(xml, lat, lon);
      return NextResponse.json({ status: "OK", candidates, endpoint: "openstreetmap-map-api", fallbackFrom: overpass.error || "OVERPASS_ERROR", wayCount: candidates.length });
    }
    const body = await response.text().catch(() => "");
    return NextResponse.json({ status: "OSM_ERROR", error: `OpenStreetMap map API HTTP_${response.status}${body ? ` ${body.slice(0, 180)}` : ""}`, overpassError: overpass.error, candidates: [] });
  } catch (error) {
    return NextResponse.json({ status: "OSM_ERROR", error: error instanceof Error ? error.message : String(error), overpassError: overpass.error, candidates: [] });
  }
}
