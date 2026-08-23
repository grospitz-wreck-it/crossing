import { NextResponse } from "next/server";

type Point = { lat: number; lon: number };
type LineRelation = { id: number; routeType: string; ref: string; name: string; from: string; to: string; network?: string; operator?: string };
type Candidate = { kind: "route" | "track"; routeType: "tracks" | "railway" | "track" | "tram" | "light_rail"; infrastructureType: "rail" | "tram" | "light_rail"; ref: string; name: string; from: string; to: string; distanceMeters: number; wayId: number; relationId: number | null; lineRelations: LineRelation[]; source: string; waysCount: number; segments: Point[][] };

const INFRASTRUCTURE_TYPES = new Set(["rail", "tram", "light_rail"]);
const ROUTE_RELATION_TYPES = new Set(["train", "tram", "light_rail", "railway", "tracks"]);

function pointSegmentDistanceMeters(lat: number, lon: number, a: Point, b: Point) { const scale = 111320; const x = (lon - a.lon) * scale * Math.cos((lat * Math.PI) / 180); const y = (lat - a.lat) * scale; const bx = (b.lon - a.lon) * scale * Math.cos((lat * Math.PI) / 180); const by = (b.lat - a.lat) * scale; const denom = bx * bx + by * by; let t = denom ? (x * bx + y * by) / denom : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(x - bx * t, y - by * t); }
function geometryDistanceMeters(lat: number, lon: number, geometry: Point[]) { let best = Infinity; for (let i = 1; i < geometry.length; i += 1) best = Math.min(best, pointSegmentDistanceMeters(lat, lon, geometry[i - 1], geometry[i])); return best; }
function normalizeRouteRef(value: string) { return value.trim().toUpperCase().replace(/\s+/g, " "); }
function normalizeRouteName(value: string) { return value.trim().toLowerCase().replace(/[^a-z0-9äöüß]+/gi, " ").replace(/\s+/g, " ").trim(); }
function makeCandidate(lat: number, lon: number, geometry: Point[], tags: Record<string, string | undefined>, wayId: number, source: string): Candidate | null { const distanceMeters = geometryDistanceMeters(lat, lon, geometry); if (!Number.isFinite(distanceMeters) || distanceMeters > 200) return null; const infrastructureType = tags.railway === "tram" ? "tram" : tags.railway === "light_rail" ? "light_rail" : "rail"; return { kind: "track", routeType: infrastructureType === "tram" ? "tram" : infrastructureType === "light_rail" ? "light_rail" : "track", infrastructureType, ref: String(tags.ref || ""), name: String(tags.name || ""), from: String(tags.from || ""), to: String(tags.to || ""), distanceMeters: Math.round(distanceMeters), wayId, relationId: null, lineRelations: [], source, waysCount: 1, segments: [geometry] }; }
function mergeLineRelations(target: LineRelation[], incoming: LineRelation[]) { const seen = new Set(target.map((relation) => relation.id)); for (const relation of incoming) { if (seen.has(relation.id)) continue; target.push(relation); seen.add(relation.id); } }
function enrichFromRelations(candidate: Candidate) { const relations = candidate.lineRelations; candidate.ref = candidate.ref || relations.map((r) => r.ref).find(Boolean) || ""; candidate.name = candidate.name || relations.map((r) => r.name).find(Boolean) || ""; candidate.from = candidate.from || relations.map((r) => r.from).find(Boolean) || ""; candidate.to = candidate.to || relations.map((r) => r.to).find(Boolean) || ""; candidate.relationId = candidate.relationId ?? relations[0]?.id ?? null; candidate.kind = relations.length ? "route" : "track"; }
function groupCandidates(candidates: Candidate[]) { const grouped = new Map<string, Candidate>(); for (const candidate of candidates) { enrichFromRelations(candidate); if (!candidate.lineRelations.length && !candidate.ref) continue; const ref = normalizeRouteRef(candidate.ref); const relationRefs = candidate.lineRelations.map((r) => normalizeRouteRef(r.ref)).filter(Boolean).sort(); const name = normalizeRouteName(candidate.name); const key = ref ? `ref:${candidate.infrastructureType}:${ref}` : relationRefs.length ? `relations:${candidate.infrastructureType}:${relationRefs.join(",")}` : `name:${candidate.infrastructureType}:${name}`; const existing = grouped.get(key); if (!existing) { grouped.set(key, { ...candidate, segments: [...candidate.segments], lineRelations: [...candidate.lineRelations] }); continue; } existing.kind = "route"; existing.ref = existing.ref || candidate.ref; existing.name = existing.name || candidate.name; existing.from = existing.from || candidate.from; existing.to = existing.to || candidate.to; existing.relationId = existing.relationId ?? candidate.relationId; existing.waysCount += candidate.waysCount; existing.distanceMeters = Math.min(existing.distanceMeters, candidate.distanceMeters); existing.segments.push(...candidate.segments); mergeLineRelations(existing.lineRelations, candidate.lineRelations); enrichFromRelations(existing); } return [...grouped.values()].sort((a, b) => a.distanceMeters - b.distanceMeters).slice(0, 8); }

async function tryOverpass(lat: number, lon: number) {
  // Resolve route relations FROM THE LOCAL RAILWAY WAYS only. This is the important distinction: nearby lines are not candidates.
  const query = `[out:json][timeout:5];way(around:220,${lat},${lon})[railway~"^(rail|tram|light_rail)$"]->.localWays;.localWays out geom tags;rel(bw.localWays)[type=route][route~"^(train|tram|light_rail|railway|tracks)$"]->.localRoutes;.localRoutes out tags members;`;
  // One small, bounded request is preferable here to waiting through multiple Overpass fallbacks.
  const endpoint = "https://overpass-api.de/api/interpreter";
  try {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(`${endpoint}?${new URLSearchParams({ data: query }).toString()}`, { cache: "no-store", signal: controller.signal, headers: { accept: "application/json", "user-agent": "Crossings/1.0 (meineschranke.com)" } });
      if (!response.ok) return { status: "OVERPASS_ERROR" as const, error: `${endpoint} HTTP_${response.status}`, candidates: [] as Candidate[] };
      const data = await response.json(); const elements = Array.isArray(data?.elements) ? data.elements : [];
      const ways = elements.filter((e: any) => e?.type === "way" && Array.isArray(e?.geometry)); const relations = elements.filter((e: any) => e?.type === "relation");
      const localWayIds = new Set(ways.filter((w: any) => INFRASTRUCTURE_TYPES.has(String(w.tags?.railway || ""))).map((w: any) => Number(w.id)));
      const relationByWay = new Map<number, LineRelation[]>();
      for (const relation of relations) {
        const routeType = String(relation.tags?.route || ""); if (relation.tags?.type !== "route" || !ROUTE_RELATION_TYPES.has(routeType)) continue;
        const lineRelation: LineRelation = { id: Number(relation.id), routeType, ref: String(relation.tags?.ref || ""), name: String(relation.tags?.name || ""), from: String(relation.tags?.from || ""), to: String(relation.tags?.to || ""), network: relation.tags?.network ? String(relation.tags.network) : undefined, operator: relation.tags?.operator ? String(relation.tags.operator) : undefined };
        for (const member of relation.members || []) { if (member.type !== "way") continue; const wayId = Number(member.ref); if (!localWayIds.has(wayId)) continue; const list = relationByWay.get(wayId) || []; list.push(lineRelation); relationByWay.set(wayId, list); }
      }
      const candidates: Candidate[] = [];
      for (const way of ways) {
        const geometry: Point[] = way.geometry.map((p: any) => ({ lat: Number(p.lat), lon: Number(p.lon) })).filter((p: Point) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
        if (geometry.length < 2 || !INFRASTRUCTURE_TYPES.has(String(way.tags?.railway || ""))) continue;
        const local = makeCandidate(lat, lon, geometry, way.tags || {}, Number(way.id), "openstreetmap"); if (!local) continue;
        local.lineRelations = relationByWay.get(Number(way.id)) || []; enrichFromRelations(local); candidates.push(local);
      }
      return { status: "OK" as const, candidates: groupCandidates(candidates), endpoint, wayCount: ways.length, relationCount: relations.length };
    } finally { clearTimeout(timeout); }
  } catch (error) { return { status: "OVERPASS_ERROR" as const, error: error instanceof Error ? error.message : String(error), candidates: [] as Candidate[] }; }
}

export async function GET(request: Request) { const { searchParams } = new URL(request.url); const lat = Number(searchParams.get("lat")); const lon = Number(searchParams.get("lon")); if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return NextResponse.json({ status: "INVALID_COORDINATES", candidates: [] }, { status: 400 }); const overpass = await tryOverpass(lat, lon); if (overpass.status === "OK") return NextResponse.json(overpass); return NextResponse.json({ status: "OSM_ERROR", error: overpass.error || "OSM-Bahnlinien konnten nicht ermittelt werden.", candidates: [] }); }
