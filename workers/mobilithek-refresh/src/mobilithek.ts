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

export async function refreshOnce(): Promise<{
  subscriptionCount: number;
  eventCount: number;
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
      } else if (feed.kind === "gtfs-rt") {
        events = parseGtfsRtTripUpdates(feed.bytes);
      }

      successful++;

      for (const event of events) {
        snapshotEvents.push({
          subscriptionId,
          event,
        });
      }

      console.log(
        `[Mobilithek] ${subscriptionId}: ${events.length} events`,
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

  return {
    subscriptionCount: config.subscriptionIds.length,
    eventCount: snapshotEvents.length,
    successful,
    failed,
    events: snapshotEvents,
  };
}
