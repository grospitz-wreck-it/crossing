import { db } from "../../../../../lib/db";

function jsonArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  try { return value ? JSON.parse(String(value)) : []; } catch { return []; }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await db.execute({
    sql: `SELECT id,name,eva,lat,lon,confidence,status,source,observation_evas,context_evas,required_route_stops,close_offset_seconds,open_offset_seconds,rules,through_rules,diversion_rules,reroute_watch_rules,created_at,updated_at FROM crossings WHERE id = ? LIMIT 1`,
    args: [id],
  });
  const crossing: any = result.rows[0];
  if (!crossing) return Response.json({ error: "Crossing not found" }, { status: 404 });
  const links = await db.execute({
    sql: `SELECT id,eva,station_name,role,categories,direction,fallback_offset_seconds,track_distance_meters,sort_order FROM crossing_station_links WHERE crossing_id = ? ORDER BY sort_order ASC`,
    args: [id],
  }).catch(() => ({ rows: [] as any[] }));
  return Response.json({
    crossing: {
      ...crossing,
      observationEvas: jsonArray(crossing.observation_evas),
      contextEvas: jsonArray(crossing.context_evas),
      requiredRouteStops: jsonArray(crossing.required_route_stops),
      rules: jsonArray(crossing.rules),
      throughRules: jsonArray(crossing.through_rules),
      diversionRules: jsonArray(crossing.diversion_rules),
      rerouteWatchRules: jsonArray(crossing.reroute_watch_rules),
    },
    stationLinks: links.rows,
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await request.json();
    const existing = await db.execute({ sql: `SELECT id FROM crossings WHERE id = ? LIMIT 1`, args: [id] });
    if (!existing.rows.length) return Response.json({ error: "Crossing not found" }, { status: 404 });

    const name = String(body.name ?? "").trim();
    const eva = String(body.eva ?? "").trim();
    const lat = Number(body.lat);
    const lon = Number(body.lon);
    const closeOffset = Number(body.closeOffsetSeconds);
    const openOffset = Number(body.openOffsetSeconds);
    const confidence = Number(body.confidence);
    const status = body.status === "inactive" ? "inactive" : "active";
    if (!name) return Response.json({ error: "Bitte einen Namen vergeben." }, { status: 400 });
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return Response.json({ error: "Ungültige Koordinaten." }, { status: 400 });
    if (!Number.isFinite(closeOffset) || !Number.isFinite(openOffset)) return Response.json({ error: "Ungültige Offset-Werte." }, { status: 400 });
    if (!Number.isFinite(confidence)) return Response.json({ error: "Ungültige Konfidenz." }, { status: 400 });

    const sameName = await db.execute({ sql: `SELECT id,name FROM crossings WHERE LOWER(TRIM(name))=LOWER(TRIM(?)) AND id <> ? LIMIT 1`, args: [name, id] });
    if (sameName.rows.length) return Response.json({ error: `Dieser Name wird bereits verwendet: „${String((sameName.rows[0] as any).name)}“.` }, { status: 409 });

    const observationEvas = Array.isArray(body.observationEvas) ? body.observationEvas.map(String).filter(Boolean) : null;
    const contextEvas = Array.isArray(body.contextEvas) ? body.contextEvas.map(String).filter(Boolean) : null;
    const requiredRouteStops = Array.isArray(body.requiredRouteStops) ? body.requiredRouteStops.map(String).filter(Boolean) : null;
    const fields = [
      `name = ?`, `eva = ?`, `lat = ?`, `lon = ?`, `close_offset_seconds = ?`, `open_offset_seconds = ?`, `confidence = ?`, `status = ?`, `updated_at = datetime('now')`,
      ...(observationEvas ? [`observation_evas = ?`] : []),
      ...(contextEvas ? [`context_evas = ?`] : []),
      ...(requiredRouteStops ? [`required_route_stops = ?`] : []),
      ...(body.rules !== undefined ? [`rules = ?`] : []),
      ...(body.throughRules !== undefined ? [`through_rules = ?`] : []),
      ...(body.diversionRules !== undefined ? [`diversion_rules = ?`] : []),
      ...(body.rerouteWatchRules !== undefined ? [`reroute_watch_rules = ?`] : []),
    ];
    const args: any[] = [name, eva, lat, lon, Math.round(closeOffset), Math.round(openOffset), confidence, status];
    if (observationEvas) args.push(JSON.stringify(observationEvas));
    if (contextEvas) args.push(JSON.stringify(contextEvas));
    if (requiredRouteStops) args.push(JSON.stringify(requiredRouteStops));
    if (body.rules !== undefined) args.push(JSON.stringify(body.rules ?? []));
    if (body.throughRules !== undefined) args.push(JSON.stringify(body.throughRules ?? []));
    if (body.diversionRules !== undefined) args.push(JSON.stringify(body.diversionRules ?? []));
    if (body.rerouteWatchRules !== undefined) args.push(JSON.stringify(body.rerouteWatchRules ?? []));
    args.push(id);
    await db.execute({ sql: `UPDATE crossings SET ${fields.join(", ")} WHERE id = ?`, args });

    if (Array.isArray(body.stationLinks)) {
      for (const link of body.stationLinks) {
        const linkEva = String(link.eva || "").trim();
        if (!linkEva) continue;
        await db.execute({ sql: `INSERT OR IGNORE INTO railway_stations (eva,name,lat,lon,source) VALUES (?,?,?,?,?)`, args: [linkEva, String(link.station_name || link.stationName || linkEva), Number.isFinite(Number(link.lat)) ? Number(link.lat) : null, Number.isFinite(Number(link.lon)) ? Number(link.lon) : null, "catalog"] });
      }
      await db.execute({ sql: `DELETE FROM crossing_station_links WHERE crossing_id = ?`, args: [id] }).catch(() => undefined);
      for (let index = 0; index < body.stationLinks.length; index += 1) {
        const link = body.stationLinks[index];
        const linkEva = String(link.eva || "").trim();
        if (!linkEva) continue;
        await db.execute({
          sql: `INSERT INTO crossing_station_links (id,crossing_id,eva,station_name,role,categories,direction,fallback_offset_seconds,track_distance_meters,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)`,
          args: [String(link.id || `${id}-${linkEva}-${index}`), id, linkEva, String(link.station_name || link.stationName || linkEva), ["primary","observation","anchor"].includes(link.role) ? link.role : "observation", JSON.stringify(Array.isArray(link.categories) ? link.categories : []), ["eastbound","westbound","unknown"].includes(link.direction) ? link.direction : "unknown", Number(link.fallback_offset_seconds ?? link.fallbackOffsetSeconds ?? 0), Number(link.track_distance_meters ?? link.trackDistanceMeters ?? 0), index],
        }).catch(() => undefined);
      }
    }

    return Response.json({ ok: true, id });
  } catch (error) {
    console.error("Failed to update crossing:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Speichern fehlgeschlagen." }, { status: 500 });
  }
}
