import { db } from "../../../../../app/lib/db";
import { getStationTimetable } from "../../../../../../../packages/db-api-client/src/getStationTimetable";

function normalize(value: unknown) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

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
      const uniqueEvas = Array.from(new Set(requestedEvas)).slice(0, 8);
      if (!uniqueEvas.length) return Response.json({ options: [], stations: [] });
      const result = await db.execute({ sql: `SELECT eva,name FROM railway_station_catalog WHERE eva IN (${uniqueEvas.map(() => "?").join(",")})`, args: uniqueEvas });
      const names = new Map((result.rows as any[]).map((row) => [String(row.eva), String(row.name || row.eva)]));
      stations = uniqueEvas.map((eva) => ({ eva, name: names.get(eva) || eva, role: "observation" }));
    }

    const results = await Promise.all(stations.map(async (station) => {
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

    return Response.json({
      options: [...byLine.values()].sort((a, b) => a.line.localeCompare(b.line, "de", { numeric: true })),
      stations: results,
      referenceStations: lineStations,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Failed to load reference line options:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Referenzlinien konnten nicht ermittelt werden." }, { status: 500 });
  }
}
