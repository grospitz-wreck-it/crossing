import { fetchChangesXml, fetchPlanXml } from "../../../../../../../../../packages/db-api-client/src/officialTimetableClient";
import { mergeStationTimetable } from "../../../../../../../../../packages/db-api-client/src/parseOfficialTimetable";
import { db } from "../../../../../../../../app/lib/db";

function jsonArray(value: unknown): string[] {
  try {
    const parsed = Array.isArray(value) ? value : JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.map(String).map((v) => v.trim()).filter(Boolean) : [];
  } catch { return []; }
}

function rootSummary(xml: string) {
  const root = xml.match(/<timetable\b([^>]*)>/i)?.[1] || "";
  const station = root.match(/\bstation="([^"]*)"/i)?.[1] || "";
  const elements = (xml.match(/<s\b/g) || []).length;
  return { bytes: xml.length, station, stopElements: elements, hasTimetableRoot: /<timetable\b/i.test(xml) };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const result = await db.execute({ sql: "SELECT id,name,reference_stations,reference_lines,observation_evas FROM crossings WHERE id = ? LIMIT 1", args: [id] });
    const row: any = result.rows[0];
    if (!row) return Response.json({ error: "Crossing not found" }, { status: 404 });
    const evas = jsonArray(row.reference_stations).length ? jsonArray(row.reference_stations) : jsonArray(row.observation_evas);
    const results = await Promise.all(evas.slice(0, 8).map(async (eva) => {
      const startedAt = Date.now();
      try {
        const [plans, changes] = await Promise.all([fetchPlanXml(eva, 2, true), fetchChangesXml(eva, true)]);
        const events = mergeStationTimetable(eva, plans, changes);
        return { eva, ok: true, elapsedMs: Date.now() - startedAt, plans: plans.map(rootSummary), changes: rootSummary(changes), parsedEventCount: events.length, sample: events.slice(0, 8).map((event) => ({ id: event.id, line: event.line, category: event.category, journeyNumber: event.journeyNumber, actualTime: event.actualTime.toISOString(), route: event.route.slice(0, 8), cancelled: event.cancelled })) };
      } catch (error) {
        return { eva, ok: false, elapsedMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) };
      }
    }));
    return Response.json({ crossing: { id: row.id, name: row.name }, referenceStations: jsonArray(row.reference_stations), observationEvas: jsonArray(row.observation_evas), referenceLines: jsonArray(row.reference_lines), results }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Timetable-Diagnose fehlgeschlagen" }, { status: 500 });
  }
}
