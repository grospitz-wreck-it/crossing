import { NextResponse } from "next/server";
import { fetchMobilithekSubscription, getMobilithekConfigs } from "../../../lib/mobilithek";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type S28Call = { stopPointRef?: string; visitNumber?: string; aimedArrival?: string; expectedArrival?: string; actualArrival?: string; aimedDeparture?: string; expectedDeparture?: string; actualDeparture?: string; stopPointName?: string };
type S28Journey = { recordedAtTime?: string; lineRef?: string; publishedLineName?: string; directionRef?: string; directionName?: string; productCategoryRef?: string; monitored?: boolean; predictionInaccurate?: boolean; datedVehicleJourneyRef?: string; vehicleJourneyRef?: string; calls: S28Call[] };

function findTagValue(xml: string, tag: string): string | undefined {
  const marker = `<${tag}`;
  let start = xml.indexOf(marker);
  while (start >= 0) {
    const afterName = start + marker.length;
    const next = xml[afterName];
    if (next === ">" || next === " ") {
      const close = xml.indexOf(">", afterName);
      if (close >= 0) {
        const valueStart = close + 1;
        const end = xml.indexOf(`</${tag}>`, valueStart);
        if (end >= 0) return xml.slice(valueStart, end).trim() || undefined;
      }
    }
    start = xml.indexOf(marker, afterName);
  }
  return undefined;
}

function boolTag(xml: string, tag: string): boolean | undefined {
  const value = findTagValue(xml, tag)?.toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function extractBlocks(xml: string, openName: string, closeName: string): string[] {
  const blocks: string[] = [];
  let cursor = 0;
  while (true) {
    const start = xml.indexOf(openName, cursor);
    if (start < 0) break;
    const openEnd = xml.indexOf(">", start);
    if (openEnd < 0) break;
    const contentStart = openEnd + 1;
    const end = xml.indexOf(closeName, contentStart);
    if (end < 0) break;
    blocks.push(xml.slice(contentStart, end));
    cursor = end + closeName.length;
  }
  return blocks;
}

function extractCalls(journeyXml: string): S28Call[] {
  const calls: S28Call[] = [];
  const sections = [...extractBlocks(journeyXml, "<RecordedCalls", "</RecordedCalls>"), ...extractBlocks(journeyXml, "<EstimatedCalls", "</EstimatedCalls>")];
  for (const section of sections) {
    const callBlocks = [...extractBlocks(section, "<RecordedCall", "</RecordedCall>"), ...extractBlocks(section, "<EstimatedCall", "</EstimatedCall>")];
    for (const xml of callBlocks) {
      calls.push({
        stopPointRef: findTagValue(xml, "StopPointRef"),
        visitNumber: findTagValue(xml, "VisitNumber"),
        stopPointName: findTagValue(xml, "StopPointName"),
        aimedArrival: findTagValue(xml, "AimedArrivalTime"),
        expectedArrival: findTagValue(xml, "ExpectedArrivalTime"),
        actualArrival: findTagValue(xml, "ActualArrivalTime"),
        aimedDeparture: findTagValue(xml, "AimedDepartureTime"),
        expectedDeparture: findTagValue(xml, "ExpectedDepartureTime"),
        actualDeparture: findTagValue(xml, "ActualDepartureTime"),
      });
    }
  }
  return calls;
}

function extractS28Journeys(body: string, limit: number): S28Journey[] {
  const journeys: S28Journey[] = [];
  let cursor = 0;
  while (journeys.length < limit) {
    const start = body.indexOf("<EstimatedVehicleJourney", cursor);
    if (start < 0) break;
    const openEnd = body.indexOf(">", start);
    if (openEnd < 0) break;
    const end = body.indexOf("</EstimatedVehicleJourney>", openEnd + 1);
    if (end < 0) break;
    const xml = body.slice(openEnd + 1, end);
    const lineRef = findTagValue(xml, "LineRef");
    if (lineRef?.replace(/\s+/g, "").toUpperCase() === "S28") {
      journeys.push({
        recordedAtTime: findTagValue(xml, "RecordedAtTime"),
        lineRef,
        publishedLineName: findTagValue(xml, "PublishedLineName"),
        directionRef: findTagValue(xml, "DirectionRef"),
        directionName: findTagValue(xml, "DirectionName"),
        productCategoryRef: findTagValue(xml, "ProductCategoryRef"),
        monitored: boolTag(xml, "Monitored"),
        predictionInaccurate: boolTag(xml, "PredictionInaccurate"),
        datedVehicleJourneyRef: findTagValue(xml, "DatedVehicleJourneyRef"),
        vehicleJourneyRef: findTagValue(xml, "VehicleJourneyRef"),
        calls: extractCalls(xml),
      });
    }
    cursor = end + "</EstimatedVehicleJourney>".length;
  }
  return journeys;
}

function countOccurrences(body: string, needle: string): number {
  let count = 0;
  let cursor = 0;
  while (true) {
    const index = body.indexOf(needle, cursor);
    if (index < 0) return count;
    count++;
    cursor = index + needle.length;
  }
}

export async function GET(request: Request) {
  const subscriptionId = process.env.MOBILITHEK_SUBSCRIPTION_ID_4?.trim();
  if (!subscriptionId) return NextResponse.json({ ok: false, error: "MOBILITHEK_SUBSCRIPTION_ID_4 is not configured" }, { status: 500 });
  const config = getMobilithekConfigs().find((entry) => entry.subscriptionId === subscriptionId);
  if (!config) return NextResponse.json({ ok: false, error: "Subscription 4 could not be resolved" }, { status: 500 });

  const url = new URL(request.url);
  const requestedLimit = Number(url.searchParams.get("limit") || "20");
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? Math.trunc(requestedLimit) : 20, 1), 100);

  try {
    const result = await fetchMobilithekSubscription(config);
    const body = result.body || "";
    const journeys = extractS28Journeys(body, limit);
    const totalCalls = journeys.reduce((sum, journey) => sum + journey.calls.length, 0);
    const expectedArrivalCount = journeys.reduce((sum, journey) => sum + journey.calls.filter((call) => Boolean(call.expectedArrival)).length, 0);
    const expectedDepartureCount = journeys.reduce((sum, journey) => sum + journey.calls.filter((call) => Boolean(call.expectedDeparture)).length, 0);
    const firstS28Index = body.indexOf("<LineRef>S28</LineRef>");
    const firstS28Context = firstS28Index >= 0 ? body.slice(Math.max(0, firstS28Index - 300), firstS28Index + 700) : null;

    return NextResponse.json({
      ok: true,
      subscriptionId,
      status: result.status,
      contentType: result.contentType,
      bodyLength: body.length,
      requestedLimit: limit,
      diagnostics: {
        estimatedVehicleJourneyTags: countOccurrences(body, "<EstimatedVehicleJourney"),
        exactS28LineRefTags: countOccurrences(body, "<LineRef>S28</LineRef>"),
        s28TextOccurrences: countOccurrences(body, "S28"),
        firstS28Context,
      },
      returnedJourneys: journeys.length,
      totalCalls,
      expectedArrivalCount,
      expectedDepartureCount,
      journeys,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, subscriptionId, error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
