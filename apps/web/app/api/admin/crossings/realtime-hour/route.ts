import { NextResponse } from "next/server";
import { fetchOpenBoardsBoard } from "../../../../../../../packages/db-api-client/src/openBoardsClient";
import { fetchPlanXml, fetchChangesXml } from "../../../../../../../packages/db-api-client/src/officialTimetableClient";
import { mergeStationTimetable } from "../../../../../../../packages/db-api-client/src/parseOfficialTimetable";
import { getMobilithekTrainRegistry } from "../../../../../../../packages/db-api-client/src/mobilithekTimetable";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_EVA = "8003288";
const DEFAULT_STATION = "Kirchlengern";
const WINDOW_MS = 60 * 60 * 1000;

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function collectObjects(value: unknown, output: JsonObject[] = [], seen = new Set<unknown>()) {
  if (!value || typeof value !== "object" || seen.has(value)) return output;
  seen.add(value);
  if (!Array.isArray(value)) output.push(value as JsonObject);
  for (const child of Object.values(value as JsonObject)) {
    if (Array.isArray(child)) child.forEach((item) => collectObjects(item, output, seen));
    else collectObjects(child, output, seen);
  }
  return output;
}

function firstDeep(objects: JsonObject[], keys: string[]): unknown {
  for (const object of objects) {
    for (const key of keys) {
      if (object[key] !== undefined && object[key] !== null) return object[key];
    }
  }
  return undefined;
}

function asText(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value && typeof value === "object") {
    const object = value as JsonObject;
    for (const key of ["name", "text", "value", "label", "id"]) {
      if (object[key] !== undefined) return asText(object[key]);
    }
  }
  return null;
}

function asIso(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function normalizeOpenBoards(data: unknown, source: "DB OpenBoards arrivals" | "DB OpenBoards departures", start: number, end: number) {
  const objects = collectObjects(data);
  const rows: Array<Record<string, unknown>> = [];
  const timeKeys = [
    "timeForecast", "forecastTime", "actualTime", "estimatedTime",
    "time", "dateTime", "departureTime", "arrivalTime", "scheduledTime",
    "timeScheduled", "timeExpected", "timeEstimated",
  ];
  for (const object of objects) {
    const nested = collectObjects(object);
    const rawTime = firstDeep(nested, timeKeys);
    const time = asIso(rawTime);
    if (!time) continue;
    const timestamp = new Date(time).getTime();
    if (timestamp < start || timestamp > end) continue;
    const line = asText(firstDeep(nested, ["line", "lineName", "publishedLineName", "trainNumber", "journeyNumber", "serviceNumber", "name"]));
    const destination = asText(firstDeep(nested, ["destination", "destinationName", "direction", "directionText", "to"]));
    const origin = asText(firstDeep(nested, ["origin", "originName", "from", "start"]));
    const platform = asText(firstDeep(nested, ["platform", "platformName", "track", "trackName"]));
    const delay = firstDeep(nested, ["delayMinutes", "delay", "delayInMinutes"]);
    rows.push({
      source,
      time,
      line,
      origin,
      destination,
      platform,
      delayMinutes: typeof delay === "number" ? delay : null,
      raw: object,
    });
  }
  const unique = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const key = [row.time, row.line, row.origin, row.destination, row.platform].join("|");
    if (!unique.has(key)) unique.set(key, row);
  }
  return Array.from(unique.values()).sort((a, b) => String(a.time).localeCompare(String(b.time)));
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

  const openBoards = openBoardsResult.status === "fulfilled"
    ? {
        source: "DB OpenBoards v1",
        departures: [
          ...normalizeOpenBoards(openBoardsResult.value[0], "DB OpenBoards departures", start.getTime(), end.getTime()),
          ...normalizeOpenBoards(openBoardsResult.value[2], "DB OpenBoards departures", start.getTime(), end.getTime()),
        ],
        arrivals: [
          ...normalizeOpenBoards(openBoardsResult.value[1], "DB OpenBoards arrivals", start.getTime(), end.getTime()),
          ...normalizeOpenBoards(openBoardsResult.value[3], "DB OpenBoards arrivals", start.getTime(), end.getTime()),
        ],
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

  const combined = [
    ...(Array.isArray((openBoards as any).departures) ? (openBoards as any).departures : []),
    ...(Array.isArray((openBoards as any).arrivals) ? (openBoards as any).arrivals : []),
    ...(Array.isArray((timetable as any).events) ? (timetable as any).events.map((event: any) => ({ ...event, source: "DB Timetables v1" })) : []),
    ...(Array.isArray((mobilithek as any).events) ? (mobilithek as any).events.map((event: any) => ({ ...event, source: "Mobilithek live subscription" })) : []),
  ].sort((a: any, b: any) => String(a.time || a.actualTime || a.scheduledTime || "").localeCompare(String(b.time || b.actualTime || b.scheduledTime || "")));

  return NextResponse.json({
    ok: [openBoardsResult, timetableResult, mobilithekResult].some((result) => result.status === "fulfilled"),
    station,
    eva,
    generatedAt: new Date().toISOString(),
    window: { start: startIso, end: endIso, minutes: 60 },
    durationMs: Date.now() - startedAt,
    eventCount: combined.length,
    events: combined,
    sources: { openBoards, timetable, mobilithek },
    notes: [
      "Read-only diagnostic: no Turso writes, no snapshot updates and no forecast/matching changes.",
      "OpenBoards is requested in two consecutive 30-minute windows per direction (the documented default window), covering the next 60 minutes. Its raw payload is retained alongside best-effort normalized rows so the response schema can be verified against the live response.",
      "Mobilithek rows are included only when an EstimatedCall explicitly identifies Kirchlengern by stop name or EVA reference; no route-name-only regional heuristic is used.",
      "Timetables and OpenBoards events are listed independently; cross-source journey matching is intentionally not inferred in this first comparison.",
    ],
  }, { headers: { "Cache-Control": "no-store" } });
}
