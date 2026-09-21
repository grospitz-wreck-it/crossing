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
  crossingTime: string;
  detection: "snapshot-primary-stop";
};

function parseJson(value: unknown, fallback: unknown) {
  try {
    return value ? JSON.parse(String(value)) : fallback;
  } catch {
    return fallback;
  }
}

function normalizeStation(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\\u0300-\\u036f]/g, "")
    .replace(/hauptbahnhof|hbf|bahnhof|westf\\.?|westfalen/gi, " ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function normalizeEva(value: unknown): string {
  const raw = String(value || "").trim();
  const match = raw.match(/(?:^|[^0-9])(\\d{7})(?:$|[^0-9])/);
  return match?.[1] || raw;
}

function stationCallMatches(call: any, eva: string, stationName?: string) {
  const targetEva = normalizeEva(eva);
  const stopPoint = normalizeEva(call?.stopPointRef);
  const stopPlace = normalizeEva(call?.stopPlaceRef);
  if (targetEva && (stopPoint === targetEva || stopPlace === targetEva)) return true;

  const targetName = normalizeStation(stationName);
  if (!targetName) return false;
  const callName = normalizeStation(call?.name || call?.stopPointName || call?.stopPlaceName);
  return Boolean(callName && (callName === targetName || callName.includes(targetName) || targetName.includes(callName)));
}

export async function getSnapshotPrimaryTrains(
  db: Client,
  crossing: Crossing,
): Promise<SnapshotPrimaryTrain[] | null> {
  const observationEvas = Array.from(
    new Set(
      (crossing.observationEvas || [])
        .map(String)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );

  if (!observationEvas.length) return [];

  const primaryObservationStations = Array.isArray((crossing as any).primaryObservationStations)
    ? (crossing as any).primaryObservationStations.map(String).map((value: string) => value.trim()).filter(Boolean)
    : [];

  try {
    const now = Date.now();
    const from = new Date(now - 5 * 60_000).toISOString();
    const to = new Date(now + 3 * 60 * 60_000).toISOString();

    const result = await db.execute({
      sql: `SELECT line,category,journey_number,journey_ref,origin,destination,calls_json,delay_minutes,actual_time,scheduled_time
            FROM mobilithek_train_snapshot
            WHERE actual_time >= ? AND actual_time <= ?
            ORDER BY actual_time ASC
            LIMIT 5000`,
      args: [from, to],
    });

    const stationNames = new Map<string, string>();
    for (const eva of observationEvas) {
      stationNames.set(eva, primaryObservationStations[stationNames.size] || eva);
    }

    const candidates: SnapshotPrimaryTrain[] = [];

    for (const row of result.rows as any[]) {
      const calls = parseJson(row.calls_json, []);
      if (!Array.isArray(calls)) continue;

      for (let evaIndex = 0; evaIndex < observationEvas.length; evaIndex += 1) {
        const eva = observationEvas[evaIndex];
        const stationName = primaryObservationStations[evaIndex];
        const call = calls.find((entry: any) => stationCallMatches(entry, eva, stationName));
        if (!call) continue;

        const observationTime =
          call.actual ||
          call.planned ||
          row.actual_time ||
          row.scheduled_time;

        const parsed = new Date(observationTime);
        if (!Number.isFinite(parsed.getTime())) continue;

        const line = String(row.line || "").trim();
        const category = String(row.category || "").trim();
        const journeyNumber = Number(row.journey_number || 0);

        candidates.push({
          type: "primary-stop",
          line,
          category,
          journeyNumber,
          journeyRef: row.journey_ref ? String(row.journey_ref) : undefined,
          destination: row.destination ? String(row.destination) : undefined,
          origin: row.origin ? String(row.origin) : undefined,
          delayMinutes: Number(row.delay_minutes || 0),
          observationEva: eva,
          observationStation: stationNames.get(eva) || eva,
          observationActualTime: parsed.toISOString(),
          crossingTime: parsed.toISOString(),
          detection: "snapshot-primary-stop",
        });

        break;
      }
    }

    const unique = Array.from(
      new Map(
        candidates.map((train) => [
          `${train.category}-${train.journeyNumber}-${train.journeyRef || ""}-${train.observationEva}`,
          train,
        ]),
      ).values(),
    );

    return unique;
  } catch (error) {
    console.warn("[Mobilithek] primary snapshot unavailable", error);
    return null;
  }
}
