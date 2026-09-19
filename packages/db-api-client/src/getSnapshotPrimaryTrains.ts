import type { Client } from "@libsql/client";

export type SnapshotPrimaryTrain = {
  line: string;
  category: string;
  journeyNumber: number;
  journeyRef?: string;
  origin?: string;
  destination?: string;
  stationEva: string;
  stationName: string;
  platform?: string;
  delayMinutes: number;
  crossingTime: string;
  arrival: string;
};

function parseJson(value: unknown, fallback: any) {
  try { return value ? JSON.parse(String(value)) : fallback; } catch { return fallback; }
}

function normalizeStation(value: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/hauptbahnhof|hbf|bahnhof|westf\.?|westfalen/gi, " ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function stationMatches(value: string, wanted: string) {
  const a = normalizeStation(value);
  const b = normalizeStation(wanted);
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
}

export async function getSnapshotPrimaryTrains(
  db: Client,
  crossing: any,
): Promise<SnapshotPrimaryTrain[]> {
  const primaryEvas = Array.from(new Set(
    (crossing.referenceStations || [])
      .map((eva: unknown) => String(eva).trim())
      .filter(Boolean),
  ));
  if (!primaryEvas.length) return [];

  const stationResult = await db.execute({
    sql: "SELECT eva,name FROM railway_station_catalog WHERE eva IN (" +
      primaryEvas.map(() => "?").join(",") + ")",
    args: primaryEvas,
  });

  const stationNames = new Map(
    (stationResult.rows as any[])
      .map((row) => [String(row.eva || "").trim(), String(row.name || "").trim()] as const)
      .filter(([eva, name]) => Boolean(eva && name)),
  );

  const now = Date.now();
  const from = new Date(now - 5 * 60_000).toISOString();
  const to = new Date(now + 3 * 60 * 60_000).toISOString();

  const result = await db.execute({
    sql: `SELECT line,category,journey_number,journey_ref,origin,destination,route_json,calls_json,delay_minutes,actual_time,scheduled_time,direction
           FROM mobilithek_train_snapshot
           WHERE actual_time >= ? AND actual_time <= ?
           LIMIT 1500`,
    args: [from, to],
  });

  const candidates: SnapshotPrimaryTrain[] = [];

  for (const row of result.rows as any[]) {
    const calls = parseJson(row.calls_json, []);
    if (!Array.isArray(calls) || !calls.length) continue;

    for (const eva of primaryEvas) {
      const stationName = stationNames.get(eva);
      if (!stationName) continue;

      const call = calls.find((item: any) =>
        stationMatches(String(item?.name || ""), stationName),
      );
      if (!call) continue;

      // A primary candidate must have an explicit call at the declared
      // reference station. We do not infer primary status from nearby stations,
      // route anchors, line hints or automatically discovered observation EVAs.
      const stationTime = call?.actual || call?.planned || row.actual_time;
      const parsedTime = new Date(stationTime);
      if (!Number.isFinite(parsedTime.getTime())) continue;

      const rule = (crossing.throughRules || []).find(
        (item: any) => String(item?.observationEva || "").trim() === eva,
      );
      const offsetSeconds = Math.max(30, Number(rule?.fallbackOffsetSeconds || 300));
      const crossingTime = new Date(parsedTime.getTime() + offsetSeconds * 1000);
      if (crossingTime.getTime() < now - 60_000 || crossingTime.getTime() > now + 3 * 60 * 60_000) continue;

      candidates.push({
        line: String(row.line || ""),
        category: String(row.category || ""),
        journeyNumber: Number(row.journey_number || 0),
        journeyRef: row.journey_ref ? String(row.journey_ref) : undefined,
        origin: row.origin ? String(row.origin) : undefined,
        destination: row.destination ? String(row.destination) : undefined,
        stationEva: eva,
        stationName,
        platform: call?.platform ? String(call.platform) : undefined,
        delayMinutes: Number(row.delay_minutes || 0),
        crossingTime: crossingTime.toISOString(),
        arrival: parsedTime.toISOString(),
      });
      break;
    }
  }

  return Array.from(
    new Map(
      candidates.map((train) => [
        train.journeyRef || `${train.category}-${train.journeyNumber}-${train.stationEva}`,
        train,
      ]),
    ).values(),
  ).sort((a, b) => Date.parse(a.crossingTime) - Date.parse(b.crossingTime));
}
