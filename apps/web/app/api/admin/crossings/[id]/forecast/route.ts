import { db } from "../../../../../lib/db";
import { getStationTimetable } from "../../../../../../../../packages/db-api-client/src/getStationTimetable";
import { getThroughTrains } from "../../../../../../../../packages/db-api-client/src/getThroughTrains";

function jsonArray(value: unknown): any[] { if (Array.isArray(value)) return value; try { return value ? JSON.parse(String(value)) : []; } catch { return []; } }

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await db.execute({ sql: `SELECT id,name,eva,lat,lon,close_offset_seconds,open_offset_seconds,confidence,status,observation_evas,context_evas,required_route_stops,through_rules,diversion_rules,reroute_watch_rules FROM crossings WHERE id = ? LIMIT 1`, args: [id] });
  const crossing: any = result.rows[0];
  if (!crossing) return Response.json({ error: "Crossing not found" }, { status: 404 });

  const observationEvas = jsonArray(crossing.observation_evas).map((value) => String(value || "").trim()).filter(Boolean);
  if (crossing.eva && !observationEvas.includes(String(crossing.eva))) observationEvas.unshift(String(crossing.eva));
  const contextEvas = jsonArray(crossing.context_evas).map((value) => String(value || "").trim()).filter(Boolean);
  const throughRules = jsonArray(crossing.through_rules);
  const requiredRouteStops = jsonArray(crossing.required_route_stops).map((value) => String(value || "").trim()).filter(Boolean);

  const now = Date.now();
  const trainsByKey = new Map<string, any>();
  const stationResults: any[] = [];

  // Direkte Beobachtungsbahnhöfe: aktuelle DB-Fahrplanereignisse.
  for (const eva of observationEvas) {
    try {
      const events = await getStationTimetable(eva, 4);
      stationResults.push({ eva, stationName: eva, role: "observation", count: events.length, ok: true });
      for (const train of events) {
        if (train.cancelled || train.actualTime.getTime() <= now - 60_000) continue;
        const crossingTime = train.actualTime;
        const key = `${train.category}-${train.journeyNumber}`;
        const candidate = {
          id: `${key}-${eva}`,
          line: train.line,
          category: train.category,
          journeyNumber: train.journeyNumber,
          origin: train.origin,
          destination: train.destination,
          platform: train.platform,
          delayMinutes: train.delayMinutes,
          observationStation: eva,
          observationEva: eva,
          crossingTime: crossingTime.toISOString(),
          closeAt: new Date(crossingTime.getTime() - Number(crossing.close_offset_seconds || 80) * 1000).toISOString(),
          openAt: new Date(crossingTime.getTime() + Number(crossing.open_offset_seconds || 20) * 1000).toISOString(),
          etaSeconds: Math.floor((crossingTime.getTime() - now) / 1000),
          direction: "unknown",
          route: train.route,
          source: "observation",
        };
        const existing = trainsByKey.get(key);
        if (!existing || candidate.etaSeconds < existing.etaSeconds) trainsByKey.set(key, candidate);
      }
    } catch (error) {
      stationResults.push({ eva, stationName: eva, role: "observation", count: 0, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  // Automatisch erzeugte throughRules nutzen die OSM-Strecke und die
  // automatisch gefundenen Beobachtungs-/Kontextbahnhöfe. Dadurch können
  // ICE/IC-Züge erkannt werden, obwohl sie am nächstgelegenen Bahnhof nicht
  // halten, sondern beispielsweise an einem größeren Hbf in der Umgebung.
  if (throughRules.length) {
    try {
      const predictionCrossing = {
        id: String(crossing.id),
        name: String(crossing.name),
        eva: String(crossing.eva || ""),
        observationEvas,
        requiredRouteStops,
        lat: Number(crossing.lat),
        lon: Number(crossing.lon),
        closeOffsetSeconds: Number(crossing.close_offset_seconds || 80),
        openOffsetSeconds: Number(crossing.open_offset_seconds || 20),
        rules: [],
        throughRules,
        diversionRules: jsonArray(crossing.diversion_rules),
        rerouteWatchRules: jsonArray(crossing.reroute_watch_rules),
        confidence: Number(crossing.confidence || 0.5),
      };
      const throughTrains = await getThroughTrains(predictionCrossing as any);
      for (const station of new Map(throughRules.map((rule: any) => [String(rule.observationEva), rule])).values()) {
        stationResults.push({ eva: String((station as any).observationEva), stationName: String((station as any).observationStation || (station as any).observationEva), role: "context", rule: true, ok: true });
      }
      for (const train of throughTrains) {
        const crossingTime = new Date(train.crossingTime);
        const etaSeconds = Math.floor((crossingTime.getTime() - now) / 1000);
        if (etaSeconds <= 0) continue;
        const key = `${train.category}-${train.journeyNumber}`;
        const candidate = {
          id: `${key}-through`,
          line: train.line,
          category: train.category,
          journeyNumber: train.journeyNumber,
          origin: train.origin,
          destination: train.destination,
          platform: undefined,
          delayMinutes: train.delayMinutes,
          observationStation: train.observationStation,
          observationEva: train.observationEva,
          crossingTime: crossingTime.toISOString(),
          closeAt: new Date(crossingTime.getTime() - Number(crossing.close_offset_seconds || 80) * 1000).toISOString(),
          openAt: new Date(crossingTime.getTime() + Number(crossing.open_offset_seconds || 20) * 1000).toISOString(),
          etaSeconds,
          direction: train.direction,
          route: train.route,
          source: "through-rule",
        };
        const existing = trainsByKey.get(key);
        if (!existing || candidate.etaSeconds < existing.etaSeconds) trainsByKey.set(key, candidate);
      }
    } catch (error) {
      stationResults.push({ role: "context", ok: false, count: 0, error: error instanceof Error ? error.message : String(error) });
    }
  }

  // Kontext-EVAs ohne passende Regel werden trotzdem als Datenbasis
  // ausgewiesen. Die eigentliche Erkennung erfolgt ausschließlich über die
  // gespeicherten rules, damit nicht jeder Hbf im Umkreis blind einen Zug
  // auslöst.
  const knownRuleEvas = new Set(throughRules.map((rule: any) => String(rule.observationEva)));
  for (const eva of contextEvas) {
    if (!knownRuleEvas.has(eva)) stationResults.push({ eva, stationName: eva, role: "context", rule: false, ok: true });
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
    crossing: { id: String(crossing.id), name: String(crossing.name), lat: Number(crossing.lat), lon: Number(crossing.lon), route: requiredRouteStops },
    state,
    nextClosure: nextClosure ? { start: nextClosure.start.toISOString(), end: nextClosure.end.toISOString(), closeInSeconds: Math.max(0, Math.floor((nextClosure.start.getTime() - now) / 1000)), openInSeconds: Math.max(0, Math.floor((nextClosure.end.getTime() - now) / 1000)), trains: nextClosure.trains } : null,
    closures: closures.slice(0, 30).map((closure) => ({ start: closure.start.toISOString(), end: closure.end.toISOString(), durationMinutes: Math.round((closure.end.getTime() - closure.start.getTime()) / 60000), trainCount: closure.trains.length, trains: closure.trains })),
    trains,
    stations: stationResults,
    rules: { requiredRouteStops, throughRules, diversionRules: jsonArray(crossing.diversion_rules), rerouteWatchRules: jsonArray(crossing.reroute_watch_rules) },
  });
}
