import { db } from "../../../../../lib/db";
import { getStationTimetable } from "../../../../../../../../packages/db-api-client/src/getStationTimetable";

function jsonArray(value: unknown): any[] { if (Array.isArray(value)) return value; try { return value ? JSON.parse(String(value)) : []; } catch { return []; } }

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await db.execute({ sql: `SELECT id,name,eva,lat,lon,close_offset_seconds,open_offset_seconds,confidence,status,observation_evas,required_route_stops FROM crossings WHERE id = ? LIMIT 1`, args: [id] });
  const crossing: any = result.rows[0];
  if (!crossing) return Response.json({ error: "Crossing not found" }, { status: 404 });

  const observationEvas = jsonArray(crossing.observation_evas).map((value) => String(value || "").trim()).filter(Boolean);
  if (crossing.eva && !observationEvas.includes(String(crossing.eva))) observationEvas.unshift(String(crossing.eva));
  if (!observationEvas.length) return Response.json({ crossing: { id: String(crossing.id), name: String(crossing.name), lat: Number(crossing.lat), lon: Number(crossing.lon), route: jsonArray(crossing.required_route_stops) }, state: "UNKNOWN", nextClosure: null, closures: [], trains: [], stations: [], message: "Noch keine DB-Beobachtungsstation für diesen Übergang verknüpft." });

  const observations = observationEvas.map((eva) => ({ eva, stationName: eva, role: "observation", categories: [] as string[], direction: "unknown", fallbackOffsetSeconds: 0 }));
  const trainsByKey = new Map<string, any>();
  const stationResults: any[] = [];
  const now = Date.now();

  for (const observation of observations) {
    try {
      const events = await getStationTimetable(observation.eva, 4);
      stationResults.push({ eva: observation.eva, stationName: observation.stationName, count: events.length, ok: true });
      for (const train of events) {
        if (train.cancelled || train.actualTime.getTime() <= now - 60_000) continue;
        const crossingTime = new Date(train.actualTime.getTime() + observation.fallbackOffsetSeconds * 1000);
        const key = `${train.category}-${train.journeyNumber}`;
        const candidate = { id: `${key}-${observation.eva}`, line: train.line, category: train.category, journeyNumber: train.journeyNumber, origin: train.origin, destination: train.destination, platform: train.platform, delayMinutes: train.delayMinutes, observationStation: observation.stationName, observationEva: observation.eva, crossingTime: crossingTime.toISOString(), closeAt: new Date(crossingTime.getTime() - Number(crossing.close_offset_seconds || 80) * 1000).toISOString(), openAt: new Date(crossingTime.getTime() + Number(crossing.open_offset_seconds || 20) * 1000).toISOString(), etaSeconds: Math.floor((crossingTime.getTime() - now) / 1000), direction: observation.direction, route: train.route };
        const existing = trainsByKey.get(key);
        if (!existing || candidate.etaSeconds < existing.etaSeconds) trainsByKey.set(key, candidate);
      }
    } catch (error) {
      stationResults.push({ eva: observation.eva, stationName: observation.stationName, count: 0, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const trains = [...trainsByKey.values()].filter((train) => train.etaSeconds > 0).sort((a, b) => a.etaSeconds - b.etaSeconds);
  const closures: any[] = [];
  for (const train of trains) {
    const start = new Date(train.closeAt), end = new Date(train.openAt), last = closures[closures.length - 1];
    if (!last || start.getTime() > last.end.getTime() + 30_000) closures.push({ start, end, trains: [train] });
    else { if (end.getTime() > last.end.getTime()) last.end = end; last.trains.push(train); }
  }
  const nextClosure = closures.find((closure) => closure.end.getTime() > now) || null;
  let state = "OPEN";
  if (nextClosure && now >= nextClosure.start.getTime() && now < nextClosure.end.getTime()) state = "CLOSED";

  return Response.json({
    crossing: { id: String(crossing.id), name: String(crossing.name), lat: Number(crossing.lat), lon: Number(crossing.lon), route: jsonArray(crossing.required_route_stops) },
    state,
    nextClosure: nextClosure ? { start: nextClosure.start.toISOString(), end: nextClosure.end.toISOString(), closeInSeconds: Math.max(0, Math.floor((nextClosure.start.getTime() - now) / 1000)), openInSeconds: Math.max(0, Math.floor((nextClosure.end.getTime() - now) / 1000)), trains: nextClosure.trains } : null,
    closures: closures.slice(0, 30).map((closure) => ({ start: closure.start.toISOString(), end: closure.end.toISOString(), durationMinutes: Math.round((closure.end.getTime() - closure.start.getTime()) / 60000), trainCount: closure.trains.length, trains: closure.trains })),
    trains,
    stations: stationResults,
  });
}
