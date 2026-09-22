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

export async function fetchRelayDiagnostics(
  env: MobilithekEnv,
  subscriptionId: string,
  demand: DemandCrossing[],
): Promise<Record<string, unknown>> {
  const relayUrl = env.MOBILITHEK_RELAY_URL?.trim();
  const relayToken = env.MOBILITHEK_RELAY_TOKEN?.trim();
  if (!relayUrl || !relayToken) throw new Error("Mobilithek Relay ist nicht konfiguriert");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300_000);
  try {
    const diagnosticUrl = relayUrl.includes("?")
      ? relayUrl + "&diagnostic=1"
      : relayUrl + "?diagnostic=1";
    const response = await fetch(diagnosticUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${relayToken}`,
        "content-type": "application/json",
        accept: "application/json",
        "x-mobilithek-diagnostic": "1",
      },
      body: JSON.stringify({
        subscriptionId,
        demand,
        mode: "diagnostic",
      }),
      signal: controller.signal,
    });

    const body = await response.text();
    if (!response.ok) {
      throw new Error(`Mobilithek Relay diagnostic HTTP ${response.status}: ${body.slice(0, 2000)}`);
    }
    if (response.headers.get("x-mobilithek-diagnostic") !== "1") {
      throw new Error(`Mobilithek Relay did not enter diagnostic mode; content-type=${response.headers.get("content-type") || ""}; body=${body.slice(0, 500)}`);
    }
    return JSON.parse(body) as Record<string, unknown>;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchRelayEvents(
  env: MobilithekEnv,
  subscriptionId: string,
  demand: DemandCrossing[],
  onEvents?: (events: Array<{ subscriptionId: string; event: MobilithekTrainEvent }>) => Promise<void>,
): Promise<{
  parsedEvents: number;
  debug?: {
    parsedJourneys: number;
    scopeViolations: number;
    fromNormalFilter: number;
    fromRawFallback: number;
  };
}> {
  const relayUrl = env.MOBILITHEK_RELAY_URL?.trim();
  const relayToken = env.MOBILITHEK_RELAY_TOKEN?.trim();
  if (!relayUrl || !relayToken) throw new Error("Mobilithek Relay ist nicht konfiguriert");
  const controller = new AbortController();
  // Match the relay's 300s max duration. Abort only after the full streaming window.
  const timeout = setTimeout(() => controller.abort(), 300_000);
  let response: Response;
  try {
    response = await fetch(relayUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${relayToken}`,
        "content-type": "application/json",
        accept: "application/x-ndjson",
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
  let debug: {
    parsedJourneys: number;
    scopeViolations: number;
    fromNormalFilter: number;
    fromRawFallback: number;
  } | undefined;
  const batch: Array<{ subscriptionId: string; event: MobilithekTrainEvent }> = [];
  const BATCH_SIZE = 250;
  const flush = async () => {
    if (!batch.length || !onEvents) return;
    const items = batch.splice(0, batch.length);
    await onEvents(items);
  };
  const consumeLine = async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const value = JSON.parse(trimmed) as
      | { subscriptionId: string; event: MobilithekTrainEvent }
      | {
          __meta: "mobilithek-demand-debug";
          subscriptionId: string;
          parsedJourneys: number;
          debugScopeViolations: number;
          fromNormalFilter: number;
          fromRawFallback: number;
        };

    if ("__meta" in value && value.__meta === "mobilithek-demand-debug") {
      console.log("[Mobilithek DEBUG] demand metrics", value);
      debug = {
        parsedJourneys: value.parsedJourneys,
        scopeViolations: value.debugScopeViolations,
        fromNormalFilter: value.fromNormalFilter,
        fromRawFallback: value.fromRawFallback,
      };
      console.log("[Mobilithek DEBUG] demand metrics", value);
      return;
    }

    parsedEvents++;
    batch.push({
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
    if (batch.length >= BATCH_SIZE) await flush();
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        await consumeLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) await consumeLine(buffer);
    await flush();
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }
  return { parsedEvents, debug };
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
  onSubscriptionEvents?: (
    subscriptionId: string,
    events: Array<{ subscriptionId: string; event: MobilithekTrainEvent }>,
  ) => Promise<void>,
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
  for (const subscriptionId of subscriptionIds) {
    const result = await (async () => {
      try {
        console.log(`[Mobilithek] loading ${subscriptionId}`);

        if (
          env.MOBILITHEK_RELAY_URL &&
          env.MOBILITHEK_RELAY_TOKEN &&
          demand.length
        ) {
          const relay = await fetchRelayEvents(
            env,
            subscriptionId,
            demand,
            onSubscriptionEvents
              ? (events) => onSubscriptionEvents(subscriptionId, events)
              : undefined,
          );
          console.log(
            `[Mobilithek] ${subscriptionId}: relay returned ${relay.parsedEvents} demanded events`,
          );
          return {
            subscriptionId,
            successful: true,
            parsedEvents: relay.parsedEvents,
            acceptedEvents: relay.parsedEvents,
            invalidActualTimeEvents: 0,
            events: [] as Array<{ subscriptionId: string; event: MobilithekTrainEvent }>,
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
    parsedEvents += result.parsedEvents;
    acceptedEvents += result.acceptedEvents;
    invalidActualTimeEvents += result.invalidActualTimeEvents;

    if (result.successful) {
      successful++;
      if (onSubscriptionEvents) {
        await onSubscriptionEvents(result.subscriptionId, result.events);
      } else {
        snapshotEvents.push(...result.events);
      }
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
    eventCount: acceptedEvents,
    parsedEvents,
    invalidActualTimeEvents,
    acceptedEvents,
    successful,
    failed,
    errors,
    events: snapshotEvents,
  };
}
