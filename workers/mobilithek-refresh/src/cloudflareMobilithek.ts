import { gunzipSync } from "node:zlib";
import {
  classifyFeed,
  parseBody,
  parseGtfsRtTripUpdates,
  type DemandCrossing,
  type MobilithekTrainEvent,
  type MobilithekFeedKind,
} from "@crossing/db-api-client";

export interface MobilithekEnv {
  MOBILITHEK_SUBSCRIPTION_URL?: string;
  MOBILITHEK_CLIENT: Fetcher;
  MOBILITHEK_RELAY_URL?: string;
  MOBILITHEK_RELAY_TOKEN?: string;
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

async function fetchDirectFeed(
  env: MobilithekEnv,
  subscriptionId: string,
): Promise<{ bytes: Uint8Array; kind: MobilithekFeedKind }> {
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
      throw new Error(
        `Mobilithek ${subscriptionId} HTTP ${response.status} ${JSON.stringify({
          statusText: response.statusText,
          contentType,
          server: response.headers.get("server"),
          cfRay: response.headers.get("cf-ray"),
          bodyPreview: body.slice(0, 1000),
        })}`,
      );
    }

    const raw = new Uint8Array(await response.arrayBuffer());
    const encoding = response.headers.get("content-encoding") || "";
    const bytes = encoding.includes("gzip")
      ? new Uint8Array(gunzipSync(raw))
      : raw;

    return { bytes, kind: classifyFeed(bytes) };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchRelayEvents(
  env: MobilithekEnv,
  subscriptionId: string,
  demand: DemandCrossing[],
): Promise<{
  events: Array<{ subscriptionId: string; event: MobilithekTrainEvent }>;
  parsedEvents: number;
}> {
  const relayUrl = env.MOBILITHEK_RELAY_URL?.trim();
  const relayToken = env.MOBILITHEK_RELAY_TOKEN?.trim();
  if (!relayUrl || !relayToken) {
    throw new Error("Mobilithek Relay ist nicht konfiguriert");
  }

  const controller = new AbortController();
  // The relay streams large Mobilithek feeds; 20s truncates slow subscriptions before later journeys arrive.
  const timeout = setTimeout(() => controller.abort(), 120_000);

  let response: Response;
  try {
    response = await fetch(relayUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${relayToken}`,
        "content-type": "application/json",
        accept: "application/x-ndjson",
        // Do not let the platform transparently gzip/decode the large NDJSON
        // relay response. The feed is already streamed line-by-line and
        // compression here can force a large decode buffer in Workers.
        "accept-encoding": "identity",
      },
      body: JSON.stringify({ subscriptionId, demand }),
      signal: controller.signal,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Mobilithek Relay ${subscriptionId} request failed: ${message}`);
  }

  if (!response.ok || !response.body) {
    clearTimeout(timeout);
    const body = (await response.text()).slice(0, 2000);
    throw new Error(`Mobilithek Relay HTTP ${response.status}: ${body}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let parsedEvents = 0;
  const events: Array<{
    subscriptionId: string;
    event: MobilithekTrainEvent;
  }> = [];

  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const value = JSON.parse(trimmed) as {
      subscriptionId: string;
      event: MobilithekTrainEvent;
    };
    parsedEvents++;
    events.push({
      subscriptionId: value.subscriptionId,
      event: {
        ...value.event,
        actualTime: new Date(value.event.actualTime),
        scheduledTime: new Date(value.event.scheduledTime),
        calls: (value.event.calls || []).map((call) => ({
          ...call,
          planned: call.planned ? new Date(call.planned) : undefined,
          actual: call.actual ? new Date(call.actual) : undefined,
        })),
      },
    });
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        consumeLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) consumeLine(buffer);
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }

  return { events, parsedEvents };
}

function isValidTrainTime(value: Date): boolean {
  const timestamp = value.getTime();
  if (!Number.isFinite(timestamp)) return false;
  const year = value.getUTCFullYear();
  return year >= 2020 && year <= 2100;
}

export async function refreshOnce(
  env: MobilithekEnv,
  subscriptionIds: string[],
  demand: DemandCrossing[] = [],
): Promise<RefreshResult> {
  const snapshotEvents: Array<{
    subscriptionId: string;
    event: MobilithekTrainEvent;
  }> = [];
  const errors: Array<{ subscriptionId: string; error: string }> = [];
  let successful = 0;
  let failed = 0;
  let parsedEvents = 0;
  let invalidActualTimeEvents = 0;
  let acceptedEvents = 0;

  // Process subscriptions sequentially. Promise.all() kept every subscription's full
  // relay result in memory at once and caused scheduled runs to hit Cloudflare's
  // memory limit when the feeds returned tens of thousands of events.
  const results: Array<{
    subscriptionId: string;
    successful: boolean;
    parsedEvents: number;
    acceptedEvents: number;
    invalidActualTimeEvents: number;
    events: Array<{ subscriptionId: string; event: MobilithekTrainEvent }>;
    error?: string;
  }> = [];

  for (const subscriptionId of subscriptionIds) {
    const result = await (async () => {
      try {
        console.log(`[Mobilithek] loading ${subscriptionId}`);

        if (
          env.MOBILITHEK_RELAY_URL &&
          env.MOBILITHEK_RELAY_TOKEN &&
          demand.length
        ) {
          const relay = await fetchRelayEvents(env, subscriptionId, demand);
          console.log(
            `[Mobilithek] ${subscriptionId}: relay returned ${relay.parsedEvents} demanded events`,
          );
          return {
            subscriptionId,
            successful: true,
            parsedEvents: relay.parsedEvents,
            acceptedEvents: relay.events.length,
            invalidActualTimeEvents: 0,
            events: relay.events,
          };
        }

        const feed = await fetchDirectFeed(env, subscriptionId);
        console.log(`[Mobilithek] ${subscriptionId}: ${feed.kind}`);

        let events: MobilithekTrainEvent[] = [];
        if (feed.kind === "siri-journey") {
          events = parseBody(new TextDecoder().decode(feed.bytes));
        } else if (feed.kind === "gtfs-rt") {
          events = parseGtfsRtTripUpdates(feed.bytes);
        }

        let subscriptionAccepted = 0;
        let subscriptionInvalid = 0;
        const acceptedEvents: Array<{
          subscriptionId: string;
          event: MobilithekTrainEvent;
        }> = [];

        for (const event of events) {
          if (!isValidTrainTime(event.actualTime)) {
            subscriptionInvalid++;
            continue;
          }
          acceptedEvents.push({ subscriptionId, event });
          subscriptionAccepted++;
        }

        console.log(
          `[Mobilithek] ${subscriptionId}: ${events.length} parsed, ${subscriptionAccepted} accepted`,
        );

        return {
          subscriptionId,
          successful: true,
          parsedEvents: events.length,
          acceptedEvents: subscriptionAccepted,
          invalidActualTimeEvents: subscriptionInvalid,
          events: acceptedEvents,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[Mobilithek] ${subscriptionId} failed`, message);
        return {
          subscriptionId,
          successful: false,
          parsedEvents: 0,
          acceptedEvents: 0,
          invalidActualTimeEvents: 0,
          events: [] as Array<{
            subscriptionId: string;
            event: MobilithekTrainEvent;
          }>,
          error: message,
        };
      }
    })();
    results.push(result);
  }

  for (const result of results) {
    parsedEvents += result.parsedEvents;
    acceptedEvents += result.acceptedEvents;
    invalidActualTimeEvents += result.invalidActualTimeEvents;
    snapshotEvents.push(...result.events);

    if (result.successful) {
      successful++;
    } else {
      failed++;
      errors.push({
        subscriptionId: result.subscriptionId,
        error: result.error || "unknown error",
      });
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
