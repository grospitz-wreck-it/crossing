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

function tagValue(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  return match?.[1]?.trim() || undefined;
}

function boolTag(xml: string, tag: string) {
  const value = tagValue(xml, tag);
  if (value === undefined) return undefined;
  return value.toLowerCase() === "true";
}

function extractCalls(journeyXml: string): S28Call[] {
  const calls: S28Call[] = [];
  const sectionRegex = /<(?:RecordedCalls|EstimatedCalls)(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:RecordedCalls|EstimatedCalls)>/gi;
  let sectionMatch: RegExpExecArray | null;

  while ((sectionMatch = sectionRegex.exec(journeyXml))) {
    const section = sectionMatch[1];
    const callRegex = /<(?:RecordedCall|EstimatedCall)(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:RecordedCall|EstimatedCall)>/gi;
    let callMatch: RegExpExecArray | null;

    while ((callMatch = callRegex.exec(section))) {
      const xml = callMatch[1];
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
  const journeyRegex = /<EstimatedVehicleJourney(?:\\s[^>]*)?>([\\s\\S]*?)<\\/EstimatedVehicleJourney>/gi;
  let match: RegExpExecArray | null;

  while ((match = journeyRegex.exec(body)) && journeys.length < limit) {
    const xml = match[1];
    const lineRef = tagValue(xml, "LineRef");
    if (lineRef?.trim().toUpperCase() !== "S28") continue;

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
      { ok: false, error: "Subscription 4 could not be resolved from the configured Mobilithek settings" },
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
    const totalCalls = journeys.reduce((sum, journey) => sum + journey.calls.length, 0);
    const expectedArrivalCount = journeys.reduce(
      (sum, journey) => sum + journey.calls.filter((call) => Boolean(call.expectedArrival)).length,
      0,
    );
    const expectedDepartureCount = journeys.reduce(
      (sum, journey) => sum + journey.calls.filter((call) => Boolean(call.expectedDeparture)).length,
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
