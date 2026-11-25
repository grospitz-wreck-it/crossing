import { createClient } from "@libsql/client";
import { invalidateCrossingOsmCaches } from "../../../../lib/crossingOsmFilter";

const dbUrl = process.env.TURSO_DATABASE_URL;
const dbToken = process.env.TURSO_AUTH_TOKEN;
const db = dbUrl && dbToken ? createClient({ url: dbUrl, authToken: dbToken }) : null;

function jsonArray(value: unknown): any[] { if (Array.isArray(value)) return value; try { const parsed = value ? JSON.parse(String(value)) : []; return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
function jsonValue(value: unknown, fallback: any = {}) { if (value && typeof value === "object") return value; try { return value ? JSON.parse(String(value)) : fallback; } catch { return fallback; } }
function categories(value: unknown, depth = 0): string[] {
  if (depth > 12 || value == null) return [];
  if (Array.isArray(value)) return value.flatMap((item) => categories(item, depth + 1));
  if (typeof value !== "string") return [];
  const text = value.trim();
  if (!text) return [];
  // Older edits accidentally JSON-encoded the category array multiple times.
  if (text.startsWith("[") || text.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed !== value) return categories(parsed, depth + 1);
    } catch {}
  }
  return text.split(/[\s,;]+/).map((item) => item.trim().replace(/^["'\[]+|["'\]]+$/g, "")).filter((item) => /^(ICE|IC|EC|RE|RB|S|U|TGV|RJ|NJ|EN|D|IR|FLX)$/i.test(item));
}
function requireDb() { if (!db) throw new Error("TURSO_DATABASE_URL / TURSO_AUTH_TOKEN fehlen."); return db; }

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const client = requireDb();
    const result = await client.execute({ sql: `SELECT id,name,eva,lat,lon,confidence,status,source,train_source_mode,observation_evas,context_evas,required_route_stops,close_offset_seconds,open_offset_seconds,rules,through_rules,diversion_rules,reroute_watch_rules,created_at,updated_at FROM crossings WHERE id = ? LIMIT 1`, args: [id] });
    const crossing: any = result.rows[0];
    if (!crossing) return Response.json({ error: "Crossing not found" }, { status: 404 });
    const links = await client.execute({ sql: `SELECT id,eva,station_name,role,categories,direction,fallback_offset_seconds,track_distance_meters,sort_order FROM crossing_station_links WHERE crossing_id = ? ORDER BY sort_order ASC`, args: [id] }).catch(() => ({ rows: [] as any[] }));
    const stationLinks = links.rows.map((row: any) => { let parsed: unknown = row.categories; try { const value = JSON.parse(String(row.categories || '[]')); if (Array.isArray(value)) parsed = value; } catch {} return { ...row, categories: Array.isArray(parsed) ? parsed.map(String).join(',') : String(row.categories || '') }; });
    return Response.json({ crossing: { ...crossing, observationEvas: jsonArray(crossing.observation_evas), contextEvas: jsonArray(crossing.context_evas), requiredRouteStops: jsonArray(crossing.required_route_stops), rules: jsonValue(crossing.rules, {}), throughRules: jsonArray(crossing.through_rules), diversionRules: jsonArray(crossing.diversion_rules), rerouteWatchRules: jsonArray(crossing.reroute_watch_rules) }, stationLinks });
  } catch (error) { console.error("Failed to load crossing:", error); return Response.json({ error: error instanceof Error ? error.message : "Übergang konnte nicht geladen werden." }, { status: 500 }); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const client = requireDb();
    const body = await request.json();
    const existing = await client.execute({ sql: `SELECT id FROM crossings WHERE id = ? LIMIT 1`, args: [id] });
    if (!existing.rows.length) return Response.json({ error: "Crossing not found" }, { status: 404 });
    const name = String(body.name ?? "").trim(), eva = String(body.eva ?? "").trim(), lat = Number(body.lat), lon = Number(body.lon), closeOffset = Number(body.closeOffsetSeconds), openOffset = Number(body.openOffsetSeconds), confidence = Number(body.confidence), status = body.status === "inactive" ? "inactive" : "active", trainSourceMode = ["openboards","mobilithek","hybrid"].includes(String(body.trainSourceMode)) ? String(body.trainSourceMode) : "hybrid";
    if (!name) return Response.json({ error: "Bitte einen Namen vergeben." }, { status: 400 });
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return Response.json({ error: "Ungültige Koordinaten." }, { status: 400 });
    if (!Number.isFinite(closeOffset) || !Number.isFinite(openOffset) || !Number.isFinite(confidence)) return Response.json({ error: "Ungültige Berechnungswerte." }, { status: 400 });
    const sameName = await client.execute({ sql: `SELECT id,name FROM crossings WHERE LOWER(TRIM(name))=LOWER(TRIM(?)) AND id <> ? LIMIT 1`, args: [name, id] });
    if (sameName.rows.length) return Response.json({ error: `Dieser Name wird bereits verwendet: „${String((sameName.rows[0] as any).name)}“.` }, { status: 409 });

    // Keep the admin's physical-track selection and the OSM matcher corridor in
    // sync. Only accept ways that are already indexed and attached to an OSM
    // level-crossing node within 15m of this crossing. Never trust Overpass UI
    // candidates as proof of a persisted/imported mapping.
    const selectedTrackRows = body.rules && typeof body.rules === "object" &&
      Array.isArray(body.rules.selectedOsmTracks)
      ? body.rules.selectedOsmTracks
      : null;
    if (selectedTrackRows && selectedTrackRows.length > 0) {
      const selectedWayIds = [...new Set(selectedTrackRows
        .map((track: any) => String(track?.wayId ?? "").trim())
        .filter((wayId: string) => /^\d+$/.test(wayId)))];
      if (!selectedWayIds.length || selectedWayIds.length !== new Set(selectedTrackRows.map((track: any) => String(track?.wayId ?? "").trim()).filter(Boolean)).size) {
        return Response.json({ error: "Die Gleisauswahl enthält ungültige OSM-Way-IDs. Bitte Gleise erneut auswählen." }, { status: 400 });
      }

      const latDelta = 15 / 110_000;
      const lonDelta = 15 / (111_320 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
      const placeholders = selectedWayIds.map(() => "?").join(",");
      const verifiedWays = await client.execute(
        `SELECT DISTINCT crw.railway_way_id
          FROM osm_crossings oc
          JOIN osm_crossing_rail_ways crw ON crw.crossing_osm_id = oc.osm_id
          JOIN osm_rail_ways rw ON rw.osm_id = crw.railway_way_id
          WHERE oc.lat BETWEEN ? AND ? AND oc.lon BETWEEN ? AND ?
            AND crw.railway_way_id IN (${placeholders})`,
        [lat - latDelta, lat + latDelta, lon - lonDelta, lon + lonDelta, ...selectedWayIds.map((wayId) => String(wayId))],
      );
      const verifiedIds = new Set((verifiedWays.rows as any[]).map((row) => String(row.railway_way_id)));
      const unverified = selectedWayIds.filter((wayId) => !verifiedIds.has(wayId));
      if (unverified.length) {
        return Response.json({
          error: "Die ausgewählten Gleise sind im importierten OSM-Datenbestand nicht eindeutig diesem Bahnübergang zugeordnet. Bitte OSM-Zuordnung prüfen, bevor gespeichert wird.",
          code: "OSM_TRACK_SELECTION_UNVERIFIED",
          unverifiedWayIds: unverified,
        }, { status: 409 });
      }

      const corridor = await client.execute({
        sql: "SELECT crossing_id FROM crossing_osm_corridors WHERE crossing_id = ? LIMIT 1",
        args: [id],
      });
      if (!corridor.rows.length) {
        return Response.json({
          error: "Für diesen Bahnübergang fehlt der gespeicherte OSM-Korridor. Bitte zuerst die OSM-Zuordnung vorbereiten.",
          code: "OSM_CORRIDOR_MISSING",
        }, { status: 409 });
      }
      await client.execute({
        sql: `UPDATE crossing_osm_corridors
          SET railway_way_ids_json = ?, profile_json = NULL, profile_version = 0,
              profile_built_at = NULL, updated_at = datetime('now')
          WHERE crossing_id = ?`,
        args: [JSON.stringify(selectedWayIds), id],
      });
      invalidateCrossingOsmCaches(id);
    }

    let observationEvas = Array.isArray(body.observationEvas) ? body.observationEvas.map(String).filter(Boolean) : null;
    let contextEvas = Array.isArray(body.contextEvas) ? body.contextEvas.map(String).filter(Boolean) : null;
    let referenceStations = Array.isArray(body.referenceStations) ? body.referenceStations.map(String).map((value: string) => value.trim()).filter(Boolean) : null;
    const requiredRouteStops = Array.isArray(body.requiredRouteStops) ? body.requiredRouteStops.map(String).filter(Boolean) : null;
    if (Array.isArray(body.stationLinks)) {
      const normalizedLinks = body.stationLinks.map((link: any) => ({ eva: String(link.eva || "").trim(), role: String(link.role || "observation") })).filter((link: any) => link.eva);
      observationEvas = normalizedLinks.filter((link: any) => link.role === "primary" || link.role === "observation").map((link: any) => link.eva);
      contextEvas = normalizedLinks.filter((link: any) => link.role === "anchor" || link.role === "context").map((link: any) => link.eva);
      referenceStations = normalizedLinks.filter((link: any) => link.role === "primary" || link.role === "observation").map((link: any) => link.eva);
    }
    const fields = [`name = ?`,`eva = ?`,`lat = ?`,`lon = ?`,`close_offset_seconds = ?`,`open_offset_seconds = ?`,`confidence = ?`,`status = ?`,`train_source_mode = ?`,`updated_at = datetime('now')`,...(observationEvas ? [`observation_evas = ?`] : []),...(contextEvas ? [`context_evas = ?`] : []),...(referenceStations ? [`reference_stations = ?`] : []),...(requiredRouteStops ? [`required_route_stops = ?`] : []),...(body.rules !== undefined ? [`rules = ?`] : []),...(body.throughRules !== undefined ? [`through_rules = ?`] : []),...(body.diversionRules !== undefined ? [`diversion_rules = ?`] : []),...(body.rerouteWatchRules !== undefined ? [`reroute_watch_rules = ?`] : [])];
    const args: any[] = [name,eva,lat,lon,Math.round(closeOffset),Math.round(openOffset),confidence,status,trainSourceMode];
    if (observationEvas) args.push(JSON.stringify(observationEvas)); if (contextEvas) args.push(JSON.stringify(contextEvas)); if (referenceStations) args.push(JSON.stringify(referenceStations)); if (requiredRouteStops) args.push(JSON.stringify(requiredRouteStops)); if (body.rules !== undefined) args.push(JSON.stringify(body.rules ?? [])); if (body.throughRules !== undefined) args.push(JSON.stringify(body.throughRules ?? [])); if (body.diversionRules !== undefined) args.push(JSON.stringify(body.diversionRules ?? [])); if (body.rerouteWatchRules !== undefined) args.push(JSON.stringify(body.rerouteWatchRules ?? [])); args.push(id);
    await client.execute({ sql: `UPDATE crossings SET ${fields.join(", ")} WHERE id = ?`, args });

    if (Array.isArray(body.stationLinks)) {
      for (const link of body.stationLinks) { const linkEva = String(link.eva || "").trim(); if (!linkEva) continue; await client.execute({ sql: `INSERT OR IGNORE INTO railway_stations (eva,name,lat,lon,source) VALUES (?,?,?,?,?)`, args: [linkEva,String(link.station_name || link.stationName || linkEva),Number.isFinite(Number(link.lat)) ? Number(link.lat) : null,Number.isFinite(Number(link.lon)) ? Number(link.lon) : null,"catalog"] }); }
      await client.execute({ sql: `DELETE FROM crossing_station_links WHERE crossing_id = ?`, args: [id] }).catch(() => undefined);
      for (let index=0; index<body.stationLinks.length; index+=1) { const link=body.stationLinks[index], linkEva=String(link.eva||"").trim(); if(!linkEva) continue; await client.execute({ sql:`INSERT INTO crossing_station_links (id,crossing_id,eva,station_name,role,categories,direction,fallback_offset_seconds,track_distance_meters,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)`, args:[String(link.id||`${id}-${linkEva}-${index}`),id,linkEva,String(link.station_name||link.stationName||linkEva),["primary","observation","anchor"].includes(link.role)?link.role:"observation",JSON.stringify(categories(link.categories)),["eastbound","westbound","unknown"].includes(link.direction)?link.direction:"unknown",Number(link.fallback_offset_seconds??link.fallbackOffsetSeconds??0),Number(link.track_distance_meters??link.trackDistanceMeters??0),index] }).catch((error)=>console.error("crossing station link update failed",error)); }
    }
    return Response.json({ ok:true, id });
  } catch (error) { console.error("Failed to update crossing:",error); return Response.json({ error:error instanceof Error?error.message:"Speichern fehlgeschlagen." },{status:500}); }
}
