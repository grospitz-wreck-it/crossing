import { gunzipSync } from "node:zlib";
import {
  classifyFeed,
  parseBody,
  parseGtfsRtTripUpdates,
  type MobilithekTrainEvent,
  type MobilithekFeedKind,
} from "@crossing/db-api-client";

export interface MobilithekEnv {
  MOBILITHEK_SUBSCRIPTION_URL?: string;
  MOBILITHEK_CLIENT: Fetcher;
}

type RefreshResult = {
  subscriptionCount: number;
  eventCount: number;
  parsedEvents: number;
  invalidActualTimeEvents: number;
  acceptedEvents: number;
  successful: number;
  failed: number;
  errors: Array<{ subscriptionId: string; error: string }>;
  events: Array<{ subscriptionId: string; event: MobilithekTrainEvent }>;
};

async function fetchFeed(env: MobilithekEnv, subscriptionId: string): Promise<{ bytes: Uint8Array; kind: MobilithekFeedKind }> {
  const url = new URL(
    env.MOBILITHEK_SUBSCRIPTION_URL?.trim() ||
      "https://mobilithek.info:8443/mobilithek/api/v1.0/container/subscription",
  );
  url.searchParams.set("subscriptionID", subscriptionId);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await env.MOBILITHEK_CLIENT.fetch(url.toString(), {
      method: "GET",
      headers: {
        accept: "application/xml",
        "accept-encoding": "gzip",
        "user-agent": "Crossings/1.0 (meineschranke.com)",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = (await response.text()).slice(0, 4000);
      const contentType = response.headers.get("content-type") || "";
      const metadata = {
        status: response.status,
        statusText: response.statusText,
        contentType,
        server: response.headers.get("server"),
        cfRay: response.headers.get("cf-ray"),
        cfError: response.headers.get("cf-error"),
        contentLength: response.headers.get("content-length"),
        date: response.headers.get("date"),
        bodyLength: body.length,
        bodyPreview: body.slice(0, 1000),
      };
      console.error(`[Mobilithek] ${subscriptionId} HTTP response`, JSON.stringify(metadata));
      throw new Error(`Mobilithek ${subscriptionId} HTTP ${response.status} ${JSON.stringify(metadata)}`);
    }

    const raw = new Uint8Array(await response.arrayBuffer());
    const encoding = response.headers.get("content-encoding") || "";
    const bytes = encoding.includes("gzip")
      ? new Uint8Array(gunzipSync(raw))
      : raw;

    return { bytes, kind: classifyFeed(bytes) };
  } catch (error) {
    console.error(
      `[Mobilithek] ${subscriptionId} fetch exception`,
      JSON.stringify({
        name: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      }),
    );
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Mobilithek ${subscriptionId} request timed out`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function isValidTrainTime(value: Date): boolean {
  const timestamp = value.getTime();
  if (!Number.isFinite(timestamp)) return false;
  const year = value.getUTCFullYear();
  return year >= 2020 && year <= 2100;
}

export async function refreshOnce(env: MobilithekEnv, subscriptionIds: string[]): Promise<RefreshResult> {
  const snapshotEvents: Array<{ subscriptionId: string; event: MobilithekTrainEvent }> = [];
  const errors: Array<{ subscriptionId: string; error: string }> = [];
  let successful = 0;
  let failed = 0;
  let parsedEvents = 0;
  let invalidActualTimeEvents = 0;
  let acceptedEvents = 0;

  for (const subscriptionId of subscriptionIds) {
    try {
      console.log(`[Mobilithek] loading ${subscriptionId}`);
      const feed = await fetchFeed(env, subscriptionId);
      console.log(`[Mobilithek] ${subscriptionId}: ${feed.kind}`);

      let events: MobilithekTrainEvent[] = [];
      if (feed.kind === "siri-journey") {
        events = parseBody(new TextDecoder().decode(feed.bytes));
      } else if (feed.kind === "gtfs-rt") {
        events = parseGtfsRtTripUpdates(feed.bytes);
      }

      successful++;
      parsedEvents += events.length;
      let subscriptionAccepted = 0;

      for (const event of events) {
        if (!isValidTrainTime(event.actualTime)) {
          invalidActualTimeEvents++;
          continue;
        }
        snapshotEvents.push({ subscriptionId, event });
        acceptedEvents++;
        subscriptionAccepted++;
      }

      console.log(`[Mobilithek] ${subscriptionId}: ${events.length} parsed, ${subscriptionAccepted} accepted`);
    } catch (error) {
      failed++;
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ subscriptionId, error: message });
      console.error(`[Mobilithek] ${subscriptionId} failed`, message);
    }
  }

  return {
    subscriptionCount: subscriptionIds.length,
    eventCount: snapshotEvents.length,
    parsedEvents,
    invalidActualTimeEvents,
    acceptedEvents,
    successful,
    failed,
    errors,
    events: snapshotEvents,
  };
}
