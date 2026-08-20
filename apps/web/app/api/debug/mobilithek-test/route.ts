import { NextResponse } from "next/server";
import { fetchMobilithekSubscription, getMobilithekConfigs } from "../../../lib/mobilithek";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type JourneySummary = {
  lineRef?: string;
  publishedLineName?: string;
  directionName?: string;
  originName?: string;
  destinationName?: string;
  operatorRef?: string;
  productCategoryRef?: string;
};

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

function extractJourneySummaries(body: string, limit: number): JourneySummary[] {
  const journeys: JourneySummary[] = [];
  let cursor = 0;
  while (journeys.length < limit) {
    const start = body.indexOf("<EstimatedVehicleJourney", cursor);
    if (start < 0) break;
    const openEnd = body.indexOf(">", start);
    if (openEnd < 0) break;
    const end = body.indexOf("</EstimatedVehicleJourney>", openEnd + 1);
    if (end < 0) break;
    const xml = body.slice(openEnd + 1, end);
    journeys.push({
      lineRef: findTagValue(xml, "LineRef"),
      publishedLineName: findTagValue(xml, "PublishedLineName"),
      directionName: findTagValue(xml, "DirectionName"),
      originName: findTagValue(xml, "OriginName"),
      destinationName: findTagValue(xml, "DestinationName") || findTagValue(xml, "DestinationShortName"),
      operatorRef: findTagValue(xml, "OperatorRef"),
      productCategoryRef: findTagValue(xml, "ProductCategoryRef"),
    });
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
  const requestedLimit = Number(url.searchParams.get("limit") || "100");
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? Math.trunc(requestedLimit) : 100, 1), 1000);

  try {
    const result = await fetchMobilithekSubscription(config);
    const body = result.body || "";
    const summaries = extractJourneySummaries(body, limit);
    const publishedLineNames = [...new Set(summaries.map((j) => j.publishedLineName).filter(Boolean))].sort();
    const lineRefs = [...new Set(summaries.map((j) => j.lineRef).filter(Boolean))].sort();
    const matchingS28Names = publishedLineNames.filter((name) => /S.?28/i.test(name || ""));
    const matchingS28Refs = lineRefs.filter((ref) => /S.?28/i.test(ref || ""));

    return NextResponse.json({
      ok: true,
      subscriptionId,
      status: result.status,
      contentType: result.contentType,
      bodyLength: body.length,
      diagnostics: {
        estimatedVehicleJourneyTags: countOccurrences(body, "<EstimatedVehicleJourney"),
        sampledJourneys: summaries.length,
        matchingS28PublishedLineNames: matchingS28Names,
        matchingS28LineRefs: matchingS28Refs,
      },
      uniquePublishedLineNames: publishedLineNames,
      uniqueLineRefs: lineRefs,
      journeys: summaries,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, subscriptionId, error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
