import { createClient } from "@libsql/client";

const dbUrl = process.env.TURSO_DATABASE_URL;
const dbToken = process.env.TURSO_AUTH_TOKEN;
const db = dbUrl && dbToken ? createClient({ url: dbUrl, authToken: dbToken }) : null;

function jsonArray(value: unknown): any[] { if (Array.isArray(value)) return value; try { return value ? JSON.parse(String(value)) : []; } catch { return []; } }
function categories(value: unknown): string[] { if (Array.isArray(value)) return value.map(String).filter(Boolean); if (typeof value === "string") return value.split(/[\s,;]+/).map((v) => v.trim()).filter(Boolean); return []; }
function referenceLines(value: unknown): string[] { if (Array.isArray(value)) return Array.from(new Set(value.map((v) => String(v).trim().toUpperCase()).filter(Boolean))); return []; }
function requireDb() { if (!db) throw new Error("TURSO_DATABASE_URL / TURSO_AUTH_TOKEN fehlen."); return db; }

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const client = requireDb();
    const result = await client.execute({ sql: `SELECT id,name,eva,lat,lon,confidence,status,source,observation_evas,context_evas,required_route_stops,reference_lines,reference_stations,close_offset_seconds,open_offset_seconds,rules,through_rules,diversion_rules,reroute_watch_rules,created_at,updated_at FROM crossings WHERE id = ? LIMIT 1`, args: [id] });
    const crossing: any = result.rows[0];
    if (!crossing) return Response.json({ error: "Crossing not found" }, { status: 404 });
    const links = await client.execute({ sql: `SELECT id,eva,station_name,role,categories,direction,fallback_offset_seconds,track_distance_meters,sort_order FROM crossing_station_links WHERE crossing_id = ? ORDER BY sort_order ASC`, args: [id] }).catch(() => ({ rows: [] as any[] }));
    return Response.json({ crossing: { ...crossing, observationEvas: jsonArray(crossing.observation_evas), contextEvas: jsonArray(crossing.context_evas), requiredRouteStops: jsonArray(crossing.required_route_stops), referenceLines: referenceLines(jsonArray(crossing.reference_lines)), referenceStations: jsonArray(crossing.reference_stations), rules: jsonArray(crossing.rules), throughRules: jsonArray(crossing.through_rules), diversionRules: jsonArray(crossing.diversion_rules), rerouteWatchRules: jsonArray(crossing.reroute_watch_rules) }, stationLinks: links.rows });
  } catch (error) { console.error("Failed to load crossing:", error); return Response.json({ error: error instanceof Error ? error.message : "Übergang konnte nicht geladen werden." }, { status: 500 }); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const client = requireDb();
    const body = await request.json();
    const existing = await client.execute({ sql: `SELECT id FROM crossings WHERE id = ? LIMIT 1`, args: [id] });
    if (!existing.rows.length) return Response.json({ error: "Crossing not found" }, { status: 404 });
    const name = String(body.name ?? "").trim(), eva = String(body.eva ?? "").trim(), lat = Number(body.lat), lon = Number(body.lon), closeOffset = Number(body.closeOffsetSeconds), openOffset = Number(body.openOffsetSeconds), confidence = Number(body.confidence), status = body.status === "inactive" ? "inactive" : "active";
    if (!name) return Response.json({ error: "Bitte einen Namen vergeben." }, { status: 400 });
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return Response.json({ error: "Ungültige Koordinaten." }, { status: 400 });
    if (!Number.isFinite(closeOffset) || !Number.isFinite(openOffset) || !Number.isFinite(confidence)) return Response.json({ error: "Ungültige Berechnungswerte." }, { status: 400 });
    const sameName = await client.execute({ sql: `SELECT id,name FROM crossings WHERE LOWER(TRIM(name))=LOWER(TRIM(?)) AND id <> ? LIMIT 1`, args: [name, id] });
    if (sameName.rows.length) return Response.json({ error: `Dieser Name wird bereits verwendet: „${String((sameName.rows[0] as any).name)}“.` }, { status: 409 });

    let observationEvas = Array.isArray(body.observationEvas) ? body.observationEvas.map(String).filter(Boolean) : null;
    let contextEvas = Array.isArray(body.contextEvas) ? body.contextEvas.map(String).filter(Boolean) : null;
    const requiredRouteStops = Array.isArray(body.requiredRouteStops) ? body.requiredRouteStops.map(String).filter(Boolean) : null;
    const selectedReferenceLines = Array.isArray(body.referenceLines) ? referenceLines(body.referenceLines) : null;
    if (Array.isArray(body.stationLinks)) {
      observationEvas = body.stationLinks.map((link: any) => ({ eva: String(link.eva || "").trim(), role: String(link.role || "observation") })).filter((link: any) => link.eva && (link.role === "primary" || link.role === "observation")).map((link: any) => link.eva);
      contextEvas = body.stationLinks.map((link: any) => ({ eva: String(link.eva || "").trim(), role: String(link.role || "observation") })).filter((link: any) => link.eva && link.role === "anchor").map((link: any) => link.eva);
    }
    const fields = [`name = ?`,`eva = ?`,`lat = ?`,`lon = ?`,`close_offset_seconds = ?`,`open_offset_seconds = ?`,`confidence = ?`,`status = ?`,`updated_at = datetime('now')`,...(observationEvas ? [`observation_evas = ?`] : []),...(contextEvas ? [`context_evas = ?`] : []),...(requiredRouteStops ? [`required_route_stops = ?`] : []),...(selectedReferenceLines ? [`reference_lines = ?`] : []),...(body.rules !== undefined ? [`rules = ?`] : []),...(body.throughRules !== undefined ? [`through_rules = ?`] : []),...(body.diversionRules !== undefined ? [`diversion_rules = ?`] : []),...(body.rerouteWatchRules !== undefined ? [`reroute_watch_rules = ?`] : [])];
    const args: any[] = [name,eva,lat,lon,Math.round(closeOffset),Math.round(openOffset),confidence,status];
    if (observationEvas) args.push(JSON.stringify(observationEvas)); if (contextEvas) args.push(JSON.stringify(contextEvas)); if (requiredRouteStops) args.push(JSON.stringify(requiredRouteStops)); if (selectedReferenceLines) args.push(JSON.stringify(selectedReferenceLines)); if (body.rules !== undefined) args.push(JSON.stringify(body.rules ?? [])); if (body.throughRules !== undefined) args.push(JSON.stringify(body.throughRules ?? [])); if (body.diversionRules !== undefined) args.push(JSON.stringify(body.diversionRules ?? [])); if (body.rerouteWatchRules !== undefined) args.push(JSON.stringify(body.rerouteWatchRules ?? [])); args.push(id);
    await client.execute({ sql: `UPDATE crossings SET ${fields.join(", ")} WHERE id = ?`, args });

    if (Array.isArray(body.stationLinks)) {
      for (const link of body.stationLinks) { const linkEva = String(link.eva || "").trim(); if (!linkEva) continue; await client.execute({ sql: `INSERT OR IGNORE INTO railway_stations (eva,name,lat,lon,source) VALUES (?,?,?,?,?)`, args: [linkEva,String(link.station_name || link.stationName || linkEva),Number.isFinite(Number(link.lat)) ? Number(link.lat) : null,Number.isFinite(Number(link.lon)) ? Number(link.lon) : null,"catalog"] }); }
      await client.execute({ sql: `DELETE FROM crossing_station_links WHERE crossing_id = ?`, args: [id] }).catch(() => undefined);
      for (let index=0; index<body.stationLinks.length; index+=1) { const link=body.stationLinks[index], linkEva=String(link.eva||"").trim(); if(!linkEva) continue; await client.execute({ sql:`INSERT INTO crossing_station_links (id,crossing_id,eva,station_name,role,categories,direction,fallback_offset_seconds,track_distance_meters,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)`, args:[String(link.id||`${id}-${linkEva}-${index}`),id,linkEva,String(link.station_name||link.stationName||linkEva),["primary","observation","anchor"].includes(link.role)?link.role:"observation",JSON.stringify(categories(link.categories)),["eastbound","westbound","unknown"].includes(link.direction)?link.direction:"unknown",Number(link.fallback_offset_seconds??link.fallbackOffsetSeconds??0),Number(link.track_distance_meters??link.trackDistanceMeters??0),index] }).catch((error)=>console.error("crossing station link update failed",error)); }
    }
    return Response.json({ ok:true, id });
  } catch (error) { console.error("Failed to update crossing:", error); return Response.json({ error:error instanceof Error?error.message:"Speichern fehlgeschlagen." },{status:500}); }
}
