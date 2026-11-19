import { NextResponse } from "next/server";
import { fetchPlanXml, fetchChangesXml } from "../../../../../../../packages/db-api-client/src/officialTimetableClient";
import { mergeStationTimetable } from "../../../../../../../packages/db-api-client/src/parseOfficialTimetable";
import { getMobilithekTrainRegistry } from "../../../../../../../packages/db-api-client/src/mobilithekTimetable";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_EVA = "8003288";
const RELEVANT_STOPS = [
  "kirchlengern", "buende", "bünde", "herford", "loehne", "löhne",
  "bielefeld", "osnabrueck", "osnabrück", "minden", "bad oeynhausen",
];
const RAIL_CATEGORIES = new Set(["ICE", "EC", "IC", "IRE", "RE", "RB", "RS", "S"]);

function isRelevantMobilithekTrain(train: Awaited<ReturnType<typeof getMobilithekTrainRegistry>>[number]) {
  const routeText = [train.origin, train.destination, train.direction, train.line, ...train.route]
    .filter(Boolean).join(" ").toLocaleLowerCase("de");
  const hasRegionalStop = RELEVANT_STOPS.some((name) => routeText.includes(name));
  const category = String(train.category || "").toUpperCase();
  const isRail = RAIL_CATEGORIES.has(category) || /^(ICE|EC|IC|IRE|RE|RB|RS|S)\s?\d/i.test(train.line);
  return hasRegionalStop && isRail;
}

export async function GET(request: Request) {
  const startedAt = Date.now();
  const { searchParams } = new URL(request.url);
  const eva = (searchParams.get("eva") || DEFAULT_EVA).trim();

  if (!/^\d{5,8}$/.test(eva)) {
    return NextResponse.json({ ok: false, error: "Invalid EVA number." }, { status: 400 });
  }
  if (!process.env.DB_CLIENT_ID || !process.env.DB_API_KEY) {
    return NextResponse.json({ ok: false, error: "DB Timetables credentials are not configured." }, { status: 503 });
  }

  const sourceResults = await Promise.allSettled([
    (async () => {
      // Bypass the persistent Turso timetable cache: this diagnostic is read-only.
      const [planXmls, changesXml] = await Promise.all([
        fetchPlanXml(eva, 1, false),
        fetchChangesXml(eva, false),
      ]);
      return mergeStationTimetable(eva, planXmls, changesXml);
    })(),
    getMobilithekTrainRegistry(),
  ]);

  const timetableResult = sourceResults[0];
  const mobilithekResult = sourceResults[1];
  const timetableEvents = timetableResult.status === "fulfilled" ? timetableResult.value : [];
  const allMobilithek = mobilithekResult.status === "fulfilled" ? mobilithekResult.value : [];
  const relevantMobilithek = allMobilithek
    .filter(isRelevantMobilithekTrain)
    .sort((a, b) => a.actualTime.getTime() - b.actualTime.getTime());

  return NextResponse.json({
    ok: timetableResult.status === "fulfilled" || mobilithekResult.status === "fulfilled",
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    criteria: {
      timetable: "DB Timetables v1, plan + fchg, one hour ahead, EVA-specific",
      mobilithek: "All parsed journeys in the live subscription feed; rail categories plus route/name match against Kirchlengern, Bünde, Herford, Löhne, Bielefeld, Osnabrück, Minden and Bad Oeynhausen",
      note: "Mobilithek route/name filter is a diagnostic heuristic, not proof that a train passes the crossing.",
    },
    timetable: timetableResult.status === "fulfilled"
      ? {
          source: "DB Timetables v1",
          eva,
          count: timetableEvents.length,
          events: timetableEvents.map((event) => ({
            id: event.id,
            line: event.line,
            category: event.category,
            journeyNumber: event.journeyNumber,
            administration: event.administration,
            origin: event.origin || null,
            destination: event.destination || null,
            route: event.route,
            platform: event.platform || null,
            cancelled: event.cancelled,
            scheduledTime: event.scheduledTime.toISOString(),
            actualTime: event.actualTime.toISOString(),
            delayMinutes: event.delayMinutes,
            scheduledArrival: event.scheduledArrival?.toISOString() || null,
            actualArrival: event.actualArrival?.toISOString() || null,
            scheduledDeparture: event.scheduledDeparture?.toISOString() || null,
            actualDeparture: event.actualDeparture?.toISOString() || null,
          })),
        }
      : { source: "DB Timetables v1", eva, error: String(timetableResult.reason) },
    mobilithek: mobilithekResult.status === "fulfilled"
      ? {
          source: "Mobilithek live subscription",
          totalParsedJourneys: allMobilithek.length,
          relevantCount: relevantMobilithek.length,
          events: relevantMobilithek.slice(0, 300).map((train) => ({
            id: train.id,
            line: train.line,
            category: train.category,
            journeyNumber: train.journeyNumber,
            journeyRef: train.journeyRef,
            origin: train.origin || null,
            destination: train.destination || null,
            route: train.route,
            direction: train.direction,
            scheduledTime: train.scheduledTime.toISOString(),
            actualTime: train.actualTime.toISOString(),
            delayMinutes: train.delayMinutes,
          })),
        }
      : { source: "Mobilithek live subscription", error: String(mobilithekResult.reason) },
  }, { headers: { "Cache-Control": "no-store" } });
}
