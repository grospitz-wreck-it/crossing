import { NextResponse } from "next/server";
import { XMLParser } from "fast-xml-parser";
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

function text(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function bool(value: unknown): boolean | undefined {
  const normalized = text(value)?.toLowerCase();
  if (normalized === undefined) return undefined;
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return undefined;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function extractS28Journeys(body: string, limit: number): S28Journey[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: true,
  });

  const parsed = parser.parse(body) as any;
  const deliveries = asArray(parsed?.Siri?.ServiceDelivery?.EstimatedTimetableDelivery);
  const journeys: S28Journey[] = [];

  for (const delivery of deliveries) {
    const frames = asArray(delivery?.EstimatedJourneyVersionFrame);

    for (const frame of frames) {
      const vehicleJourneys = asArray(frame?.EstimatedVehicleJourney);

      for (const journey of vehicleJourneys) {
        if (journeys.length >= limit) return journeys;

        const lineRef = text(journey?.LineRef);
        if (lineRef?.toUpperCase() !== "S28") continue;

        const calls = [
          ...asArray(journey?.RecordedCalls?.RecordedCall),
          ...asArray(journey?.EstimatedCalls?.EstimatedCall),
        ].map((call) => ({
          stopPointRef: text(call?.StopPointRef),
          visitNumber: text(call?.VisitNumber),
          aimedArrival: text(call?.AimedArrivalTime),
          expectedArrival: text(call?.ExpectedArrivalTime),
          actualArrival: text(call?.ActualArrivalTime),
          aimedDeparture: text(call?.AimedDepartureTime),
          expectedDeparture: text(call?.ExpectedDepartureTime),
          actualDeparture: text(call?.ActualDepartureTime),
        }));

        const datedJourneyRef = journey?.FramedVehicleJourneyRef?.DatedVehicleJourneyRef;

        journeys.push({
          recordedAtTime: text(journey?.RecordedAtTime),
          lineRef,
          publishedLineName: text(journey?.PublishedLineName),
          directionRef: text(journey?.DirectionRef),
          directionName: text(journey?.DirectionName),
          productCategoryRef: text(journey?.ProductCategoryRef),
          monitored: bool(journey?.Monitored),
          predictionInaccurate: bool(journey?.PredictionInaccurate),
          datedVehicleJourneyRef: text(datedJourneyRef),
          vehicleJourneyRef: text(journey?.VehicleJourneyRef),
          calls,
        });
      }
    }
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
