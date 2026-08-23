import https from "node:https";
import { gunzipSync } from "node:zlib";

import {
  classifyFeed,
  parseBody,
  parseGtfsRtTripUpdates,
  type MobilithekTrainEvent,
  type MobilithekFeedKind,
} from "@crossing/db-api-client";

import { config } from "./config.js";

async function fetchFeed(
  subscriptionId: string,
): Promise<{
  bytes: Buffer;
  kind: MobilithekFeedKind;
}> {
  if (!config.p12Base64) {
    throw new Error("MOBILITHEK_CLIENT_P12_BASE64 fehlt");
  }

  const url = new URL(config.mobilithekUrl);
  url.searchParams.set("subscriptionID", subscriptionId);

  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: "GET",
        pfx: Buffer.from(config.p12Base64, "base64"),
        passphrase: config.p12Password || undefined,
        headers: {
          accept: "application/xml, text/xml, */*",
          "accept-encoding": "gzip",
          "user-agent": "Crossings/1.0 (meineschranke.com)",
        },
        timeout: 60_000,
      },
      (response) => {
        const chunks: Buffer[] = [];

        response.on("data", (chunk) => {
          chunks.push(
            Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
          );
        });

        response.on("end", () => {
          try {
            const raw = Buffer.concat(chunks);

            if (
              (response.statusCode || 0) < 200 ||
              (response.statusCode || 0) >= 300
            ) {
              throw new Error(
                `Mobilithek ${subscriptionId} HTTP ${response.statusCode}`,
              );
            }

            const encoding = String(
              response.headers["content-encoding"] || "",
            );

            const bytes = encoding.includes("gzip")
              ? gunzipSync(raw)
              : raw;

            resolve({
              bytes,
              kind: classifyFeed(bytes),
            });
          } catch (error) {
            reject(error);
          }
        });
      },
    );

    request.on("timeout", () => {
      request.destroy(
        new Error(
          `Mobilithek ${subscriptionId} request timed out`,
        ),
      );
    });

    request.on("error", reject);
    request.end();
  });
}

function isValidTrainTime(value: Date): boolean {
  const timestamp = value.getTime();

  if (!Number.isFinite(timestamp)) {
    return false;
  }

  // Reject clearly impossible dates, but do not impose a
  // business-level "live window" on the timetable feed.
  const year = value.getUTCFullYear();

  return year >= 2020 && year <= 2100;
}

export async function refreshOnce(): Promise<{
  subscriptionCount: number;
  eventCount: number;
  parsedEvents: number;
  invalidActualTimeEvents: number;
  acceptedEvents: number;
  successful: number;
  failed: number;
  events: Array<{
    subscriptionId: string;
    event: MobilithekTrainEvent;
  }>;
}> {
  const snapshotEvents: Array<{
    subscriptionId: string;
    event: MobilithekTrainEvent;
  }> = [];

  let successful = 0;
  let failed = 0;
  let parsedEvents = 0;
  let invalidActualTimeEvents = 0;
  let acceptedEvents = 0;

  for (const subscriptionId of config.subscriptionIds) {
    try {
      console.log(`[Mobilithek] loading ${subscriptionId}`);

      const feed = await fetchFeed(subscriptionId);

      console.log(
        `[Mobilithek] ${subscriptionId}: ${feed.kind}`,
      );

      let events: MobilithekTrainEvent[] = [];

      if (feed.kind === "siri-journey") {
        events = parseBody(feed.bytes.toString("utf8"));

        const s28 = events.filter((event) => event.line === "S28");

        if (s28.length > 0) {
          const calls = s28.flatMap((event) => event.calls);
          const withPlanned = calls.filter((call) => call.planned);
          const withActual = calls.filter((call) => call.actual);
          const withBoth = calls.filter(
            (call) => call.planned && call.actual,
          );

          const delayed = s28.filter(
            (event) => event.delayMinutes > 0,
          );
          const early = s28.filter(
            (event) => event.delayMinutes < 0,
          );
          const onTime = s28.filter(
            (event) => event.delayMinutes === 0,
          );

          const routes = s28
            .map((event) => event.route.length)
            .filter((length) => length > 0);

          console.log(
            "[Mobilithek SIRI DIAGNOSTIC] S28",
            JSON.stringify(
              {
                journeys: s28.length,
                calls: calls.length,
                withPlanned: withPlanned.length,
                withActual: withActual.length,
                withBoth: withBoth.length,
                delayed: delayed.length,
                early: early.length,
                onTime: onTime.length,
                shortestRoute: routes.length
                  ? Math.min(...routes)
                  : 0,
                longestRoute: routes.length
                  ? Math.max(...routes)
                  : 0,
                samples: s28.slice(0, 3).map((event) => ({
                  id: event.id,
                  journeyRef: event.journeyRef,
                  origin: event.origin,
                  destination: event.destination,
                  direction: event.direction,
                  delayMinutes: event.delayMinutes,
                  route: event.route,
                  calls: event.calls.map((call) => ({
                    stop: call.name,
                    planned: call.planned?.toISOString() ?? null,
                    actual: call.actual?.toISOString() ?? null,
                    delayMinutes:
                      call.planned && call.actual
                        ? Math.round(
                            (call.actual.getTime() -
                              call.planned.getTime()) /
                              60000,
                          )
                        : null,
                  })),
                })),
              },
              null,
              2,
            ),
          );
        }
      } else if (feed.kind === "gtfs-rt") {
        events = parseGtfsRtTripUpdates(feed.bytes);
      }

      successful++;
      parsedEvents += events.length;

      let subscriptionAccepted = 0;

      for (const event of events) {
        const actualValid = isValidTrainTime(event.actualTime);

        if (!actualValid) {
          invalidActualTimeEvents++;

          console.warn(
            `[Mobilithek] dropping invalid timestamp`,
            JSON.stringify({
              subscriptionId,
              id: event.id,
              journeyRef: event.journeyRef,
              actualTime: event.actualTime?.toISOString?.(),
              scheduledTime: event.scheduledTime?.toISOString?.(),
            }),
          );

          continue;
        }

        snapshotEvents.push({
          subscriptionId,
          event,
        });

        acceptedEvents++;
        subscriptionAccepted++;
      }

      console.log(
        `[Mobilithek] ${subscriptionId}: ${events.length} parsed, ` +
          `${subscriptionAccepted} accepted`,
      );
    } catch (error) {
      failed++;

      console.error(
        `[Mobilithek] ${subscriptionId} failed`,
        error instanceof Error
          ? error.message
          : String(error),
      );
    }
  }

  console.log(
    `[Mobilithek] refresh stats: ` +
      `parsed=${parsedEvents} ` +
      `invalidActualTime=${invalidActualTimeEvents} ` +
      `accepted=${acceptedEvents}`,
  );

  return {
    subscriptionCount: config.subscriptionIds.length,
    eventCount: snapshotEvents.length,
    parsedEvents,
    invalidActualTimeEvents,
    acceptedEvents,
    successful,
    failed,
    events: snapshotEvents,
  };
}
