import { db } from "../../../../../app/lib/db";
import { getStationTimetable } from "../../../../../../../packages/db-api-client/src/getStationTimetable";

function normalize(value: unknown) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

type StationResult = { eva: string; name: string; role: string; lines: string[] };

type CachedResult = {
  expiresAt: number;
  value: {
    options: { line: string; stations: string[]; stationCount: number }[];
    stations: StationResult[];
    referenceStations: { eva: string; name: string; role: string }[];
  };
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const resultCache = new Map<string, CachedResult>();

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const crossingId = String(searchParams.get("crossingId") || "").trim();
  const requestedEvas = searchParams.getAll("eva").map((value) => String(value).trim()).filter(Boolean);
  const selectedLine = normalize(searchParams.get("line") || "");

  try {
    let stations: { eva: string; name: string; role: string }[] = [];
    if (crossingId) {
      const result = await db.execute({
        sql: `SELECT eva,station_name,role FROM crossing_station_links WHERE crossing_id = ? AND role IN ('primary','observation') ORDER BY sort_order ASC LIMIT 8`,
        args: [crossingId],
      });
      stations = (result.rows as any[]).map((row) => ({ eva: String(row.eva || "").trim(), name: String(row.station_name || row.eva || "").trim(), role: String(row.role || "observation") })).filter((station) => station.eva);
    } else {
      // Für die Referenzlinie reichen die beiden nächstgelegenen Stationen.
      // Die Standortsuche liefert sie bereits nach Entfernung sortiert.
      // Vorher wurden bis zu sechs Stationen jeweils mit plan+fchg abgefragt.
      const uniqueEvas = Array.from(new Set(requestedEvas)).slice(0, 2);
      if (!uniqueEvas.length) return Response.json({ options: [], stations: [], referenceStations: [] });
      const result = await db.execute({ sql: `SELECT eva,name FROM railway_station_catalog WHERE eva IN (${uniqueEvas.map(() => "?").join(",")})`, args: uniqueEvas });
      const names = new Map((result.rows as any[]).map((row) => [String(row.eva), String(row.name || row.eva)]));
      stations = uniqueEvas.map((eva) => ({ eva, name: names.get(eva) || eva, role: "observation" }));
    }

    const cacheKey = `${crossingId}|${selectedLine}|${stations.map((station) => station.eva).join(",")}`;
    const cached = resultCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return Response.json(cached.value, { headers: { "Cache-Control": "public, max-age=300" } });

    const results: StationResult[] = await Promise.all(stations.map(async (station) => {
      try {
        const events = await getStationTimetable(station.eva, 1);
        const lines = new Set<string>();
        for (const event of events) {
          if (event.cancelled) continue;
          const line = normalize(event.line);
          if (line && line !== "UNKNOWN") lines.add(line);
        }
        return { ...station, lines: [...lines].sort() };
      } catch {
        return { ...station, lines: [] as string[] };
      }
    }));

    const byLine = new Map<string, { line: string; stations: string[]; stationCount: number }>();
    for (const station of results) {
      for (const line of station.lines) {
        const existing = byLine.get(line) || { line, stations: [], stationCount: 0 };
        if (!existing.stations.includes(station.name)) existing.stations.push(station.name);
        existing.stationCount = existing.stations.length;
        byLine.set(line, existing);
      }
    }

    const lineStations = selectedLine
      ? results.filter((station) => station.lines.includes(selectedLine)).map((station) => ({ eva: station.eva, name: station.name, role: station.role }))
      : [];

    const value = {
      options: [...byLine.values()].sort((a, b) => a.line.localeCompare(b.line, "de", { numeric: true })),
      stations: results,
      referenceStations: lineStations,
    };
    resultCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value });

    return Response.json(value, { headers: { "Cache-Control": "public, max-age=300" } });
  } catch (error) {
    console.error("Failed to load reference line options:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Referenzlinien konnten nicht ermittelt werden." }, { status: 500 });
  }
}
