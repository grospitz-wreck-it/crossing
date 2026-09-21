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

function stationCallMatches(call: any, eva: string) {
  const target = String(eva).trim();
  if (!target) return false;
  return String(call?.stopPointRef || "").trim() === target
    || String(call?.stopPlaceRef || "").trim() === target;
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
      stationNames.set(eva, eva);
    }

    const candidates: SnapshotPrimaryTrain[] = [];

    for (const row of result.rows as any[]) {
      const calls = parseJson(row.calls_json, []);
      if (!Array.isArray(calls)) continue;

      for (const eva of observationEvas) {
        const call = calls.find((entry: any) => stationCallMatches(entry, eva));
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
