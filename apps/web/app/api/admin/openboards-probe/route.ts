import { db } from "../../../../lib/db";
import { fetchOpenBoardsForStations } from "@crossing/db-api-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CROSSING_IDS = [
  "kirchlengern",
  "kirchlengern-bahnhof-lubbecker-str-b8095d49",
  "bahnubergang-strecke-2530-61cb37f1",
  "gelsenkirchen-buer-sud-124cdb91",
];

function parseArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function localizedName(value: any): string | undefined {
  const names = Array.isArray(value?.localizedNames) ? value.localizedNames : [];
  return names.find((item: any) => item?.language === "deu")?.name || names[0]?.name;
}

function summarizeBoard(direction: "arrivals" | "departures", data: any) {
  const rows = Array.isArray(data?.[direction]) ? data[direction] : [];
  return {
    count: rows.length,
    trains: rows.slice(0, 40).map((row: any) => ({
      evaNumber: row.evaNumber,
      journeyId: row.journeyId,
      line: row.transport?.line?.name || row.transport?.journeyDescription || null,
      category: row.transport?.category || row.transport?.type || null,
      journeyNumber: row.transport?.journeyNumber || null,
      time: row.time || null,
      scheduledTime: row.timeSchedule || null,
      timeType: row.timeType || null,
      originEva: row.journeyInfo?.origin?.evaNumber || null,
      destinationEva: row.journeyInfo?.destination?.evaNumber || null,
      viaEvas: Array.isArray(row.transport?.via)
        ? row.transport.via.map((stop: any) => stop.evaNumber).filter(Boolean)
        : [],
      platform: row.platform?.name || null,
    })),
    stopPlaces: (Array.isArray(data?.stopPlaces) ? data.stopPlaces : []).map((place: any) => ({
      evaNumber: place.evaNumber,
      name: localizedName(place),
    })),
  };
}

export async function GET() {
  const startedAt = Date.now();

  if (!process.env.DB_CLIENT_ID || !process.env.DB_API_KEY) {
    return Response.json(
      { ok: false, error: "DB_CLIENT_ID / DB_API_KEY are not configured for this deployment." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const [crossingResult, stationResult] = await Promise.all([
      db.execute({
        sql: `SELECT id, name, eva, observation_evas FROM crossings
              WHERE status = 'active' AND id IN (${CROSSING_IDS.map(() => "?").join(",")})`,
        args: CROSSING_IDS,
      }),
      db.execute({
        sql: `SELECT crossing_id, eva, station_name, role
              FROM crossing_station_links
              WHERE crossing_id IN (${CROSSING_IDS.map(() => "?").join(",")})
              ORDER BY crossing_id, sort_order`,
        args: CROSSING_IDS,
      }),
    ]);

    const stationsByCrossing = new Map<string, any[]>();
    for (const row of stationResult.rows as any[]) {
      const list = stationsByCrossing.get(String(row.crossing_id)) || [];
      list.push(row);
      stationsByCrossing.set(String(row.crossing_id), list);
    }

    const crossings = (crossingResult.rows as any[]).map((row) => {
      const links = stationsByCrossing.get(String(row.id)) || [];
      const evas = Array.from(new Set([
        ...parseArray(row.observation_evas),
        ...links.map((link) => String(link.eva || "").trim()).filter(Boolean),
        String(row.eva || "").trim(),
      ].filter(Boolean)));
      return {
        id: String(row.id),
        name: String(row.name || row.id),
        evas,
        stations: links.map((link) => ({
          eva: String(link.eva || ""),
          name: String(link.station_name || ""),
          role: String(link.role || ""),
        })),
      };
    });

    const allEvas = Array.from(new Set(crossings.flatMap((crossing) => crossing.evas)));
    if (!allEvas.length) {
      return Response.json(
        { ok: false, error: "No observation EVA numbers found for selected active crossings.", crossings },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    const [arrivals, departures] = await Promise.all([
      fetchOpenBoardsForStations("arrivals", allEvas, {
        batchSize: 5,
        maxViaStops: 5,
        maxEntriesPerTransportType: 20,
        languages: ["deu"],
      }),
      fetchOpenBoardsForStations("departures", allEvas, {
        batchSize: 5,
        maxViaStops: 5,
        maxEntriesPerTransportType: 20,
        languages: ["deu"],
      }),
    ]);

    const summarizeBatches = (batches: typeof arrivals, direction: "arrivals" | "departures") =>
      batches.map((batch) => ({
        requestedEvas: batch.evaNumbers,
        ...summarizeBoard(direction, batch.data),
      }));

    return Response.json(
      {
        ok: true,
        source: "DB OpenBoards",
        durationMs: Date.now() - startedAt,
        crossingCount: crossings.length,
        evaCount: allEvas.length,
        crossings,
        arrivals: summarizeBatches(arrivals, "arrivals"),
        departures: summarizeBatches(departures, "departures"),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
