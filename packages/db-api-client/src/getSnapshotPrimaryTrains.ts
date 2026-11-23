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
  scheduledTime: string;
  route: string[];
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

function refMatches(value: unknown, eva: string) {
  const raw = String(value ?? "").trim();
  if (!raw || !eva) return false;
  const normalizeRef = (v: string) => {
    const evaMatch = v.match(/(?:^|\D)(\d{7})(?:\D|$)/);
    if (evaMatch) return evaMatch[1];
    return v.replace(/\D/g, "");
  };
  const a = normalizeRef(raw);
  const b = normalizeRef(eva);
  return Boolean(a && b && (a === b || raw === eva));
}

export async function getSnapshotPrimaryTrains(
  db: any,
  crossing: any,
  snapshotRows?: any[],
): Promise<SnapshotPrimaryTrain[]> {
  const primaryEvas: string[] = Array.from(new Set<string>(
    (crossing.referenceStations || [])
      .map((eva: unknown) => String(eva).trim())
      .filter((eva: string) => Boolean(eva)),
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
  // The status route may pass a shared, bounded snapshot read so primary and
  // through candidates are derived from exactly the same set of journeys.
  let rows = snapshotRows;
  if (!rows) {
    // Keep standalone callers compatible. The shared status path loads a wider
    // 24h window once, because actual_time can describe the journey's first call.
    const from = new Date(now - 6 * 60 * 60_000).toISOString();
    const to = new Date(now + 3 * 60 * 60_000).toISOString();
    const result = await db.execute({
      sql: `SELECT line,category,journey_number,journey_ref,origin,destination,route_json,calls_json,delay_minutes,actual_time,scheduled_time,direction
             FROM mobilithek_train_snapshot
             WHERE actual_time >= ? AND actual_time <= ?
             LIMIT 1500`,
      args: [from, to],
    });
    rows = result.rows as any[];
  }

  const candidates: SnapshotPrimaryTrain[] = [];

  for (const row of rows || []) {
    const calls = parseJson(row.calls_json, []);
    if (!Array.isArray(calls) || !calls.length) continue;

    for (const eva of primaryEvas) {
      const stationName = stationNames.get(eva) || eva;

      const call = calls.find((item: any) =>
        refMatches(item?.stopPointRef, eva) ||
        refMatches(item?.stopPlaceRef, eva) ||
        (stationNames.has(eva) && stationMatches(String(item?.name || ""), stationName)),
      );
      if (!call) continue;

      // A primary candidate must have an explicit call at the declared
      // reference station. Prefer the Mobilithek EVA/reference match; station-name
      // matching remains a compatibility fallback for older snapshot rows that
      // were written before stopPointRef/stopPlaceRef was persisted.
      // We do not infer primary status from nearby stations, route anchors,
      // line hints or automatically discovered observation EVAs.
      const stationTime = call?.actual || call?.planned || row.actual_time;
      const parsedTime = new Date(stationTime);
      if (!Number.isFinite(parsedTime.getTime())) continue;

      const rule = (crossing.throughRules || []).find(
        (item: any) => String(item?.observationEva || "").trim() === eva,
      );
      // A call at the crossing's own EVA is the closest available event timestamp.
      // Do not add a neighbouring-station travel offset to it.
      const offsetSeconds = eva === String(crossing.eva || "").trim()
        ? 0
        : Math.max(30, Number(rule?.fallbackOffsetSeconds || 300));
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
        scheduledTime: String(call?.plannedDeparture || call?.plannedArrival || call?.planned || stationTime),
        // Mobilithek calls preserve the ordered journey path needed by OSM matching.
        route: (Array.isArray(calls) ? calls.map((item: any) => String(item?.name || "").trim()).filter(Boolean) : []).length >= 2
          ? calls.map((item: any) => String(item?.name || "").trim()).filter(Boolean)
          : parseJson(row.route_json, []).map(String).filter(Boolean),
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
