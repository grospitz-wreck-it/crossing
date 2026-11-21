import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type IdentifierType = "evaNumbers" | "dhids" | "stationIds";
type Candidate = { name: string; identifierType: IdentifierType; identifier: string };

const BASE_URL = "https://apis.deutschebahn.com/db-api-marketplace/apis/open-boards/v1";
const VALID_TYPES = new Set<IdentifierType>(["evaNumbers", "dhids", "stationIds"]);

function summarize(direction: "arrivals" | "departures", payload: any) {
  const rows = Array.isArray(payload?.[direction]) ? payload[direction] : [];
  const lineCounts = new Map<string, number>();
  const s28Rows: any[] = [];

  for (const row of rows) {
    const transport = row?.transport || {};
    const line = String(transport?.line?.name || transport?.journeyDescription || "").trim();
    if (line) lineCounts.set(line, (lineCounts.get(line) || 0) + 1);
    if (/\bS\s*28\b/i.test(line) || /\bS\s*28\b/i.test(String(transport?.journeyDescription || ""))) {
      s28Rows.push({
        line,
        category: transport?.category || transport?.type || null,
        journeyNumber: transport?.journeyNumber || null,
        time: row?.time || null,
        scheduledTime: row?.timeSchedule || null,
        timeType: row?.timeType || null,
        evaNumber: row?.evaNumber || null,
        origin: row?.journeyInfo?.origin?.name || row?.journeyInfo?.origin?.evaNumber || null,
        destination: row?.journeyInfo?.destination?.name || row?.journeyInfo?.destination?.evaNumber || null,
      });
    }
  }

  return {
    count: rows.length,
    lines: [...lineCounts.entries()].map(([line, count]) => ({ line, count })),
    s28Count: s28Rows.length,
    s28: s28Rows,
    stopPlaces: (Array.isArray(payload?.stopPlaces) ? payload.stopPlaces : []).map((place: any) => ({
      evaNumber: place?.evaNumber || null,
      name: place?.name || place?.localizedNames?.find((item: any) => item?.language === "deu")?.name || null,
    })),
  };
}

async function requestBoard(
  direction: "arrivals" | "departures",
  candidate: Candidate,
  headers: Record<string, string>,
) {
  const body = {
    stopPlaceOrStation: { [candidate.identifierType]: [candidate.identifier] },
    timeWindow: { timeStart: new Date().toISOString() },
    maxViaStops: 10,
    maxEntriesPerTransportType: 40,
    languages: ["deu"],
  };

  const response = await fetch(`${BASE_URL}/${direction}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  const text = await response.text();
  let payload: any = null;
  try { payload = text ? JSON.parse(text) : null; } catch { /* preserve status and short body below */ }

  if (!response.ok) {
    return {
      direction,
      ok: false,
      httpStatus: response.status,
      statusText: response.statusText,
      message: String(payload?.message || payload?.error || text).slice(0, 500),
      ...((payload && typeof payload === "object") ? {} : {}),
    };
  }

  if (!payload || typeof payload !== "object") {
    return { direction, ok: false, httpStatus: response.status, message: "OpenBoards lieferte kein JSON." };
  }

  return { direction, ok: true, httpStatus: response.status, ...summarize(direction, payload) };
}

export async function POST(request: NextRequest) {
  const clientId = process.env.DB_OPENBOARDS_CLIENT_ID || process.env.DB_CLIENT_ID;
  const apiKey = process.env.DB_OPENBOARDS_API_KEY || process.env.DB_API_KEY;
  if (!clientId || !apiKey) {
    return Response.json({ ok: false, error: "OpenBoards-Zugangsdaten sind in diesem Deployment nicht konfiguriert." }, { status: 503 });
  }

  let input: any;
  try { input = await request.json(); } catch {
    return Response.json({ ok: false, error: "Ungültiger JSON-Request." }, { status: 400 });
  }

  const candidates: Candidate[] = Array.isArray(input?.candidates) ? input.candidates.slice(0, 3).map((item: any) => ({
    name: String(item?.name || "").trim().slice(0, 100),
    identifierType: item?.identifierType,
    identifier: String(item?.identifier || "").trim().slice(0, 100),
  })) : [];

  if (!candidates.length || candidates.some((item) => !item.name || !item.identifier || !VALID_TYPES.has(item.identifierType))) {
    return Response.json({
      ok: false,
      error: "Bitte für jeden Haltepunkt einen gültigen Identifier und Typ (EVA, DHID oder DB-Stations-ID) angeben.",
    }, { status: 400 });
  }

  const headers = {
    "DB-Client-Id": clientId,
    "DB-Api-Key": apiKey,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  const results = [];
  for (const candidate of candidates) {
    const directions = [];
    for (const direction of ["arrivals", "departures"] as const) {
      try {
        directions.push(await requestBoard(direction, candidate, headers));
      } catch (error) {
        directions.push({
          direction,
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      // Stay comfortably below the Marketplace rate limit.
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    results.push({
      name: candidate.name,
      identifier: candidate.identifier,
      identifierType: candidate.identifierType,
      arrivals: directions[0],
      departures: directions[1],
      s28Found: directions.some((item: any) => item.ok && item.s28Count > 0),
    });
  }

  return Response.json({
    ok: true,
    source: "DB OpenBoards",
    testedAt: new Date().toISOString(),
    note: "Read-only diagnostic. No queue, database, or forecast data is changed.",
    results,
  }, { headers: { "Cache-Control": "no-store" } });
}
