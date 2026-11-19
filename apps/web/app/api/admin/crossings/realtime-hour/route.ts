import { NextResponse } from "next/server";
import { fetchOpenBoardsBoard } from "../../../../../../../packages/db-api-client/src/openBoardsClient";
import { fetchPlanXml, fetchChangesXml } from "../../../../../../../packages/db-api-client/src/officialTimetableClient";
import { mergeStationTimetable } from "../../../../../../../packages/db-api-client/src/parseOfficialTimetable";
import { getMobilithekTrainRegistry } from "../../../../../../../packages/db-api-client/src/mobilithekTimetable";
import { compareStationObservations, toCanonicalOpenBoardsObservation, toMobilithekEvidence, toTimetableEvidence } from "../../../../../../../packages/db-api-client/src/sourceComparison";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_EVA = "8003288";
const DEFAULT_STATION = "Kirchlengern";
const WINDOW_MS = 60 * 60 * 1000;

type JsonObject = Record<string, unknown>;

type OpenBoardsEntry = {
  departureId?: string;
  arrivalId?: string;
  journeyId?: string;
  journeyInfo?: JsonObject;
  transport?: JsonObject;
  platform?: JsonObject;
  time?: string;
  timeSchedule?: string;
  timeType?: string;
  type?: string;
};

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function asText(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number") return String(value);
  const object = asObject(value);
  if (!object) return null;
  for (const key of ["name", "text", "value", "label", "id"]) {
    if (object[key] !== undefined && object[key] !== null) {
      return asText(object[key]);
    }
  }
  return null;
}

function asIso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function stopNameByEva(data: JsonObject): Map<string, string> {
  const names = new Map<string, string>();
  const stopPlaces = Array.isArray(data.stopPlaces) ? data.stopPlaces : [];
  for (const value of stopPlaces) {
    const stop = asObject(value);
    if (!stop || typeof stop.evaNumber !== "string") continue;
    const localizedNames = Array.isArray(stop.localizedNames) ? stop.localizedNames : [];
    const german = localizedNames
      .map(asObject)
      .find((item) => item?.language === "deu" && typeof item.name === "string");
    const fallback = localizedNames.map(asObject).find((item) => typeof item?.name === "string");
    const name = german?.name ?? fallback?.name;
    if (typeof name === "string") names.set(stop.evaNumber, name);
  }
  return names;
}

function resolveStop(value: unknown, names: Map<string, string>): string | null {
  const stop = asObject(value);
  if (!stop) return asText(value);
  const eva = typeof stop.evaNumber === "string" ? stop.evaNumber : null;
  return (eva && names.get(eva)) || eva || asText(stop);
}

function normalizeOpenBoards(
  data: unknown,
  direction: "arrivals" | "departures",
  start: number,
  end: number,
) {
  const root = asObject(data);
  if (!root) return [];
  const entries = Array.isArray(root[direction]) ? root[direction] as unknown[] : [];
  const names = stopNameByEva(root);
  const unique = new Map<string, Record<string, unknown>>();

  for (const value of entries) {
    const entry = asObject(value) as OpenBoardsEntry | null;
    if (!entry) continue;

    const actualTime = asIso(entry.time);
    const scheduledTime = asIso(entry.timeSchedule);
    if (!actualTime) continue;
    const timestamp = Date.parse(actualTime);
    if (timestamp < start || timestamp > end) continue;

    const journeyInfo = asObject(entry.journeyInfo) ?? {};
    const transport = asObject(entry.transport) ??
      asObject(journeyInfo.transportAtStart) ?? {};
    const lineObject = asObject(transport.line);
    const line = asText(transport.journeyDescription) ??
      asText(lineObject?.name) ??
      asText(transport.category);
    const origin = resolveStop(journeyInfo.origin, names);
    const destination = resolveStop(journeyInfo.destination, names);
    const platform = asText(entry.platform);
    const delayMinutes = scheduledTime
      ? Math.round((Date.parse(actualTime) - Date.parse(scheduledTime)) / 60000)
      : null;
    const journeyNumber = typeof transport.journeyNumber === "number"
      ? transport.journeyNumber
      : typeof journeyInfo.headerJourneyNumber === "number"
        ? journeyInfo.headerJourneyNumber
        : null;
    const id = entry.journeyId ??
      entry.departureId ??
      entry.arrivalId ??
      [line, journeyNumber, scheduledTime, actualTime].join("|");

    const row = {
      id,
      source: direction === "departures" ? "DB OpenBoards departures" : "DB OpenBoards arrivals",
      direction,
      time: actualTime,
      actualTime,
      scheduledTime,
      timeType: entry.timeType ?? null,
      line,
      category: asText(transport.category),
      journeyNumber,
      journeyId: entry.journeyId ?? null,
      origin,
      destination,
      platform,
      delayMinutes,
      cancelled: entry.type === "CANCELLED" || entry.type === "CANCELED",
      entryType: entry.type ?? null,
      raw: value,
    };
    const key = [id, actualTime, direction].join("|");
    if (!unique.has(key)) unique.set(key, row);
  }

  return Array.from(unique.values()).sort((a, b) =>
    String(a.time).localeCompare(String(b.time)),
  );
}

function isKirchlengernCall(call: { name: string; stopPointRef?: string; stopPlaceRef?: string }) {
  const name = String(call.name || "").toLocaleLowerCase("de");
  return name.includes("kirchlengern") ||
    call.stopPointRef === DEFAULT_EVA ||
    call.stopPlaceRef === DEFAULT_EVA;
}

export async function GET(request: Request) {
  const startedAt = Date.now();
  const { searchParams } = new URL(request.url);
  const eva = (searchParams.get("eva") || DEFAULT_EVA).trim();
  const station = searchParams.get("station")?.trim() || DEFAULT_STATION;

  if (!/^\d{5,8}$/.test(eva)) {
    return NextResponse.json({ ok: false, error: "Invalid EVA number." }, { status: 400 });
  }

  const start = new Date();
  const end = new Date(start.getTime() + WINDOW_MS);
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  const [openBoardsResult, timetableResult, mobilithekResult] = await Promise.allSettled([
    Promise.all([
      fetchOpenBoardsBoard("departures", [eva], {
        timeStart: startIso,
        maxViaStops: 10,
        maxEntriesPerTransportType: 25,
        languages: ["deu"],
      }),
      fetchOpenBoardsBoard("arrivals", [eva], {
        timeStart: startIso,
        maxViaStops: 10,
        maxEntriesPerTransportType: 25,
        languages: ["deu"],
      }),
      fetchOpenBoardsBoard("departures", [eva], {
        timeStart: new Date(start.getTime() + 30 * 60 * 1000).toISOString(),
        maxViaStops: 10,
        maxEntriesPerTransportType: 25,
        languages: ["deu"],
      }),
      fetchOpenBoardsBoard("arrivals", [eva], {
        timeStart: new Date(start.getTime() + 30 * 60 * 1000).toISOString(),
        maxViaStops: 10,
        maxEntriesPerTransportType: 25,
        languages: ["deu"],
      }),
    ]),
    (async () => {
      if (!process.env.DB_CLIENT_ID || !process.env.DB_API_KEY) {
        throw new Error("DB Timetables credentials are not configured.");
      }
      const [plans, changes] = await Promise.all([
        fetchPlanXml(eva, 2, false),
        fetchChangesXml(eva, false),
      ]);
      return mergeStationTimetable(eva, plans, changes).filter((event) => {
        const time = event.actualTime.getTime();
        const arrival = event.actualArrival?.getTime();
        const departure = event.actualDeparture?.getTime();
        return (time >= start.getTime() && time <= end.getTime()) ||
          (arrival !== undefined && arrival >= start.getTime() && arrival <= end.getTime()) ||
          (departure !== undefined && departure >= start.getTime() && departure <= end.getTime());
      });
    })(),
    getMobilithekTrainRegistry(),
  ]);

  const mergeOpenBoardsRows = (
    first: Array<Record<string, unknown>>,
    second: Array<Record<string, unknown>>,
  ) => {
    const unique = new Map<string, Record<string, unknown>>();
    for (const row of [...first, ...second]) {
      const key = [row.direction, row.id, row.time].join("|");
      if (!unique.has(key)) unique.set(key, row);
    }
    return Array.from(unique.values()).sort((a, b) =>
      String(a.time).localeCompare(String(b.time)),
    );
  };

  const openBoards = openBoardsResult.status === "fulfilled"
    ? {
        source: "DB OpenBoards v1",
        departures: mergeOpenBoardsRows(
          normalizeOpenBoards(openBoardsResult.value[0], "departures", start.getTime(), end.getTime()),
          normalizeOpenBoards(openBoardsResult.value[2], "departures", start.getTime(), end.getTime()),
        ),
        arrivals: mergeOpenBoardsRows(
          normalizeOpenBoards(openBoardsResult.value[1], "arrivals", start.getTime(), end.getTime()),
          normalizeOpenBoards(openBoardsResult.value[3], "arrivals", start.getTime(), end.getTime()),
        ),
        raw: { departuresFirstWindow: openBoardsResult.value[0], arrivalsFirstWindow: openBoardsResult.value[1], departuresSecondWindow: openBoardsResult.value[2], arrivalsSecondWindow: openBoardsResult.value[3] },
      }
    : { source: "DB OpenBoards v1", error: String(openBoardsResult.reason) };

  const timetable = timetableResult.status === "fulfilled"
    ? {
        source: "DB Timetables v1",
        count: timetableResult.value.length,
        events: timetableResult.value.map((event) => ({
          id: event.id,
          line: event.line,
          journeyNumber: event.journeyNumber,
          origin: event.origin || null,
          destination: event.destination || null,
          scheduledTime: event.scheduledTime.toISOString(),
          actualTime: event.actualTime.toISOString(),
          scheduledArrival: event.scheduledArrival?.toISOString() || null,
          actualArrival: event.actualArrival?.toISOString() || null,
          scheduledDeparture: event.scheduledDeparture?.toISOString() || null,
          actualDeparture: event.actualDeparture?.toISOString() || null,
          delayMinutes: event.delayMinutes,
          platform: event.platform || null,
          cancelled: event.cancelled,
          route: event.route,
        })),
      }
    : { source: "DB Timetables v1", error: String(timetableResult.reason) };

  const mobilithek = mobilithekResult.status === "fulfilled"
    ? (() => {
        const events = mobilithekResult.value.flatMap((train) => {
          const calls = train.calls.filter(isKirchlengernCall);
          return calls.flatMap((call) => {
            const planned = call.planned;
            const actual = call.actual || call.planned;
            if (!actual) return [];
            const time = actual.getTime();
            if (time < start.getTime() || time > end.getTime()) return [];
            return [{
              id: train.id,
              line: train.line,
              category: train.category,
              journeyNumber: train.journeyNumber,
              journeyRef: train.journeyRef,
              origin: train.origin || null,
              destination: train.destination || null,
              stationCall: call.name,
              stopPointRef: call.stopPointRef || null,
              stopPlaceRef: call.stopPlaceRef || null,
              scheduledTime: planned?.toISOString() || null,
              actualTime: actual.toISOString(),
              delayMinutes: planned ? Math.round((actual.getTime() - planned.getTime()) / 60000) : null,
              direction: train.direction || null,
            }];
          });
        }).sort((a, b) => a.actualTime.localeCompare(b.actualTime));
        return {
          source: "Mobilithek live subscription",
          totalParsedJourneys: mobilithekResult.value.length,
          stationEventCount: events.length,
          events,
        };
      })()
    : { source: "Mobilithek live subscription", error: String(mobilithekResult.reason) };

  // OpenBoards is the only canonical station-event collection.
  // Timetables and Mobilithek are attached as supporting evidence only.
  const openBoardsRows = [
    ...(Array.isArray((openBoards as any).departures) ? (openBoards as any).departures : []),
    ...(Array.isArray((openBoards as any).arrivals) ? (openBoards as any).arrivals : []),
  ];

  const canonicalObservations = openBoardsRows
    .map((row: any) => toCanonicalOpenBoardsObservation({
      id: row.id,
      eva,
      direction: row.direction,
      time: row.time,
      scheduledTime: row.scheduledTime,
      timeType: row.timeType,
      line: row.line,
      category: row.category,
      journeyNumber: row.journeyNumber,
      journeyId: row.journeyId,
      origin: row.origin,
      destination: row.destination,
      platform: row.platform,
      cancelled: row.cancelled,
      raw: row.raw,
    }))
    .filter((observation: any) => Boolean(observation));

  const timetableEvidence = timetableResult.status === "fulfilled"
    ? timetableResult.value.map((event) => toTimetableEvidence({
        id: event.id,
        eva,
        journeyNumber: event.journeyNumber,
        line: event.line,
        scheduledTime: event.scheduledTime.toISOString(),
        actualTime: event.actualTime.toISOString(),
        platform: event.platform,
        cancelled: event.cancelled,
      }))
    : [];

  const mobilithekEvidence = Array.isArray((mobilithek as any).events)
    ? (mobilithek as any).events.map((event: any) => toMobilithekEvidence({
        id: event.id,
        stationEva: event.stopPointRef || event.stopPlaceRef || (event.stationCall === station ? eva : null),
        journeyNumber: event.journeyNumber,
        line: event.line,
        scheduledTime: event.scheduledTime,
        actualTime: event.actualTime,
        platform: event.platform,
        cancelled: event.cancelled,
      }))
    : [];

  const observations = compareStationObservations(
    canonicalObservations,
    timetableEvidence,
    mobilithekEvidence,
  );

  return NextResponse.json({
    ok: [openBoardsResult, timetableResult, mobilithekResult].some((result) => result.status === "fulfilled"),
    station,
    eva,
    generatedAt: new Date().toISOString(),
    window: { start: startIso, end: endIso, minutes: 60 },
    durationMs: Date.now() - startedAt,
    eventCount: observations.length,
    events: observations,
    sources: { openBoards, timetable, mobilithek },
    notes: [
      "Read-only diagnostic: no Turso writes, no snapshot updates and no forecast/matching changes.",
      "OpenBoards is requested in two consecutive 30-minute windows per direction (the documented default window), covering the next 60 minutes. Rows are normalized from the documented top-level arrivals/departures arrays; line, journey, stop names, platform and schedule/forecast times are read from their explicit OpenBoards fields.",
      "Mobilithek rows are included only when an EstimatedCall explicitly identifies Kirchlengern by stop name or EVA reference; no route-name-only regional heuristic is used.",
      "OpenBoards is the canonical station observation. DB Timetables and Mobilithek are supporting evidence only and are not duplicated as separate event collections.",
      "Evidence matching requires the same journey number; line and scheduled-time agreement are reported separately and are not silently assumed.",
    ],
  }, { headers: { "Cache-Control": "no-store" } });
}
