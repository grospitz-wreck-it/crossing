import type { Client } from "@libsql/client";
import type { Crossing } from "../../crossing-model/src/types";

export type SnapshotPrimaryTrain = {
  type: "primary-stop";
  line: string;
  category: string;
  journeyNumber: number;
  journeyRef?: string;
  destination?: string;
  origin?: string;
  platform?: string;
  delayMinutes: number;
  observationEva: string;
  observationStation: string;
  observationActualTime: string;
  observationScheduledTime?: string;
  observationDirection: "arrivals" | "departures" | "unknown";
  crossingTime: string;
  detection: "snapshot-primary-stop";
};

function parseJson(value: unknown, fallback: unknown) {
  try { return value ? JSON.parse(String(value)) : fallback; } catch { return fallback; }
}
function normalizeStation(value: unknown): string {
  return String(value || "").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").replace(/\([^)]*\)/g, " ")
    .replace(/hauptbahnhof|hbf|bahnhof|westf\.?|westfalen/gi, " ")
    .replace(/[^a-z0-9]+/g, "").trim();
}
function normalizeEva(value: unknown): string {
  const raw = String(value || "").trim();
  const match = raw.match(/(?:^|[^0-9])(\d{7})(?:$|[^0-9])/);
  return match?.[1] || raw;
}
function stationCallMatches(call: any, eva: string, stationName?: string) {
  const targetEva = normalizeEva(eva);
  if (targetEva && (normalizeEva(call?.stopPointRef) === targetEva || normalizeEva(call?.stopPlaceRef) === targetEva)) return true;
  const targetName = normalizeStation(stationName);
  const callName = normalizeStation(call?.name || call?.stopPointName || call?.stopPlaceName);
  return Boolean(targetName && callName && (callName === targetName || callName.includes(targetName) || targetName.includes(callName)));
}

export async function getSnapshotPrimaryTrains(db: Client, crossing: Crossing): Promise<SnapshotPrimaryTrain[] | null> {
  // Primary means an explicitly configured reference station only. Automatically
  // discovered observation/context stations must never be promoted to primary.
  const primaryEvas = Array.from(new Set(
    ((crossing as any).referenceStations || []).map((value: unknown) => String(value).trim()).filter(Boolean),
  ));
  if (!primaryEvas.length) return [];

  try {
    const stationResult = await db.execute({
      sql: "SELECT eva,name FROM railway_station_catalog WHERE eva IN (" + primaryEvas.map(() => "?").join(",") + ")",
      args: primaryEvas,
    });
    const stationNames = new Map((stationResult.rows as any[])
      .map((row) => [String(row.eva || "").trim(), String(row.name || "").trim()] as const)
      .filter(([eva, name]) => Boolean(eva && name)));

    const now = Date.now();
    const from = new Date(now - 5 * 60_000).toISOString();
    const to = new Date(now + 3 * 60 * 60_000).toISOString();
    const result = await db.execute({
      sql: `SELECT line,category,journey_number,journey_ref,origin,destination,calls_json,delay_minutes,actual_time,scheduled_time
            FROM mobilithek_train_snapshot WHERE actual_time >= ? AND actual_time <= ? LIMIT 1500`,
      args: [from, to],
    });

    const candidates: SnapshotPrimaryTrain[] = [];
    for (const row of result.rows as any[]) {
      const calls = parseJson(row.calls_json, []);
      if (!Array.isArray(calls) || !calls.length) continue;
      for (const eva of primaryEvas) {
        const stationName = stationNames.get(eva) || "";
        const call = calls.find((entry: any) => stationCallMatches(entry, eva, stationName));
        if (!call) continue;
        const observationTime = call.actual || call.planned || row.actual_time || row.scheduled_time;
        const parsed = new Date(observationTime);
        if (!Number.isFinite(parsed.getTime())) continue;
        const planned = call.plannedArrival || call.plannedDeparture || call.planned || row.scheduled_time;
        const observationDirection = call.actualArrival || call.plannedArrival ? "arrivals"
          : call.actualDeparture || call.plannedDeparture ? "departures" : "unknown";
        candidates.push({
          type: "primary-stop",
          line: String(row.line || "").trim(),
          category: String(row.category || "").trim(),
          journeyNumber: Number(row.journey_number || 0),
          journeyRef: row.journey_ref ? String(row.journey_ref) : undefined,
          origin: row.origin ? String(row.origin) : undefined,
          destination: row.destination ? String(row.destination) : undefined,
          platform: call.platform ? String(call.platform) : undefined,
          delayMinutes: Number(row.delay_minutes || 0),
          observationEva: eva,
          observationStation: stationName || eva,
          observationActualTime: parsed.toISOString(),
          observationScheduledTime: planned ? new Date(planned).toISOString() : undefined,
          observationDirection,
          crossingTime: parsed.toISOString(),
          detection: "snapshot-primary-stop",
        });
        break;
      }
    }
    return Array.from(new Map(candidates.map((train) => [
      train.journeyRef || `${train.category}-${train.journeyNumber}-${train.observationEva}`, train,
    ])).values()).sort((a, b) => Date.parse(a.crossingTime) - Date.parse(b.crossingTime));
  } catch (error) {
    console.warn("[Mobilithek] primary snapshot unavailable", error);
    return null;
  }
}
