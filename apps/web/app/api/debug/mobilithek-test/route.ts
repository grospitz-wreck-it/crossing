import { NextResponse } from "next/server";
import {
  fetchMobilithekSubscription,
  getMobilithekConfigs,
} from "../../../lib/mobilithek";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type S28Call = {
  stopPointRef?: string;
  visitNumber?: string;
  aimedArrival?: string;
  expectedArrival?: string;
  actualArrival?: string;
  aimedDeparture?: string;
  expectedDeparture?: string;
  actualDeparture?: string;
};

type S28Journey = {
  recordedAtTime?: string;
  lineRef?: string;
  publishedLineName?: string;
  directionRef?: string;
  directionName?: string;
  productCategoryRef?: string;
  monitored?: boolean;
  predictionInaccurate?: boolean;
  datedVehicleJourneyRef?: string;
  vehicleJourneyRef?: string;
  calls: S28Call[];
};

function tagValue(xml: string, tag: string): string | undefined {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const start = xml.indexOf(open);
  if (start < 0) return undefined;
  const valueStart = start + open.length;
  const end = xml.indexOf(close, valueStart);
  if (end < 0) return undefined;
  const value = xml.slice(valueStart, end).trim();
  return value || undefined;
}

function boolTag(xml: string, tag: string): boolean | undefined {
  const value = tagValue(xml, tag)?.toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function extractBlocks(xml: string, openTag: string, closeTag: string): string[] {
  const blocks: string[] = [];
  let cursor = 0;
  while (true) {
    const start = xml.indexOf(openTag, cursor);
    if (start < 0) break;
    const contentStart = start + openTag.length;
    const end = xml.indexOf(closeTag, contentStart);
    if (end < 0) break;
    blocks.push(xml.slice(contentStart, end));
    cursor = end + closeTag.length;
  }
  return blocks;
}

function extractCalls(journeyXml: string): S28Call[] {
  const calls: S28Call[] = [];
  const sections = [
    ...extractBlocks(journeyXml, "<RecordedCalls>", "</RecordedCalls>"),
    ...extractBlocks(journeyXml, "<EstimatedCalls>", "</EstimatedCalls>"),
  ];

  for (const section of sections) {
    const callBlocks = [
      ...extractBlocks(section, "<RecordedCall>", "</RecordedCall>"),
      ...extractBlocks(section, "<EstimatedCall>", "</EstimatedCall>"),
    ];

    for (const xml of callBlocks) {
      calls.push({
        stopPointRef: tagValue(xml, "StopPointRef"),
        visitNumber: tagValue(xml, "VisitNumber"),
        aimedArrival: tagValue(xml, "AimedArrivalTime"),
        expectedArrival: tagValue(xml, "ExpectedArrivalTime"),
        actualArrival: tagValue(xml, "ActualArrivalTime"),
        aimedDeparture: tagValue(xml, "AimedDepartureTime"),
        expectedDeparture: tagValue(xml, "ExpectedDepartureTime"),
        actualDeparture: tagValue(xml, "ActualDepartureTime"),
      });
    }
  }

  return calls;
}

function extractS28Journeys(body: string, limit: number): S28Journey[] {
  const journeys: S28Journey[] = [];
  let cursor = 0;
  const openTag = "<EstimatedVehicleJourney>";
  const closeTag = "</EstimatedVehicleJourney>";

  while (journeys.length < limit) {
    const start = body.indexOf(openTag, cursor);
    if (start < 0) break;
    const contentStart = start + openTag.length;
    const end = body.indexOf(closeTag, contentStart);
    if (end < 0) break;

    const xml = body.slice(contentStart, end);
    const lineRef = tagValue(xml, "LineRef");
    if (lineRef?.trim().toUpperCase() === "S28") {
      journeys.push({
        recordedAtTime: tagValue(xml, "RecordedAtTime"),
        lineRef,
        publishedLineName: tagValue(xml, "PublishedLineName"),
        directionRef: tagValue(xml, "DirectionRef"),
        directionName: tagValue(xml, "DirectionName"),
        productCategoryRef: tagValue(xml, "ProductCategoryRef"),
        monitored: boolTag(xml, "Monitored"),
        predictionInaccurate: boolTag(xml, "PredictionInaccurate"),
        datedVehicleJourneyRef: tagValue(xml, "DatedVehicleJourneyRef"),
        vehicleJourneyRef: tagValue(xml, "VehicleJourneyRef"),
        calls: extractCalls(xml),
      });
    }

    cursor = end + closeTag.length;
  }

  return journeys;
}

export async function GET(request: Request) {
  const subscriptionId = process.env.MOBILITHEK_SUBSCRIPTION_ID_4?.trim();
  if (!subscriptionId) {
    return NextResponse.json(
      { ok: false, error: "MOBILITHEK_SUBSCRIPTION_ID_4 is not configured" },
      { status: 500 },
    );
  }

  const config = getMobilithekConfigs().find(
    (entry) => entry.subscriptionId === subscriptionId,
  );
  if (!config) {
    return NextResponse.json(
      { ok: false, error: "Subscription 4 could not be resolved" },
      { status: 500 },
    );
  }

  const url = new URL(request.url);
  const requestedLimit = Number(url.searchParams.get("limit") || "20");
  const limit = Math.min(
    Math.max(Number.isFinite(requestedLimit) ? Math.trunc(requestedLimit) : 20, 1),
    100,
  );

  try {
    const result = await fetchMobilithekSubscription(config);
    const body = result.body || "";
    const journeys = extractS28Journeys(body, limit);
    const totalCalls = journeys.reduce(
      (sum, journey) => sum + journey.calls.length,
      0,
    );
    const expectedArrivalCount = journeys.reduce(
      (sum, journey) =>
        sum + journey.calls.filter((call) => Boolean(call.expectedArrival)).length,
      0,
    );
    const expectedDepartureCount = journeys.reduce(
      (sum, journey) =>
        sum + journey.calls.filter((call) => Boolean(call.expectedDeparture)).length,
      0,
    );

    return NextResponse.json({
      ok: true,
      subscriptionId,
      status: result.status,
      contentType: result.contentType,
      bodyLength: body.length,
      requestedLimit: limit,
      returnedJourneys: journeys.length,
      totalCalls,
      expectedArrivalCount,
      expectedDepartureCount,
      journeys,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        subscriptionId,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
}
