import https from "node:https";
import { gunzipSync } from "node:zlib";

import {
  classifyFeed,
  parseBody,
  parseGtfsRtTripUpdates,
  type MobilithekTrainEvent,
} from "@crossing/db-api-client";

import { config, validateConfig } from "./config.js";

async function fetchFeed(subscriptionId: string): Promise<{
  bytes: Buffer;
  kind: ReturnType<typeof classifyFeed>;
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

        response.on("data", (chunk) =>
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
        );

        response.on("end", () => {
          try {
            const raw = Buffer.concat(chunks);
            if ((response.statusCode || 0) < 200 || (response.statusCode || 0) >= 300) {
              throw new Error(`Mobilithek ${subscriptionId} HTTP ${response.statusCode}`);
            }

            const encoding = String(response.headers["content-encoding"] || "");
            const bytes = encoding.includes("gzip") ? gunzipSync(raw) : raw;
            resolve({ bytes, kind: classifyFeed(bytes) });
          } catch (error) {
            reject(error);
          }
        });
      },
    );

    request.on("timeout", () =>
      request.destroy(new Error(`Mobilithek ${subscriptionId} request timed out`)),
    );
    request.on("error", reject);
    request.end();
  });
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "de"));
}

function textValues(xml: string, tag: string): string[] {
  const escaped = tag.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
  const regex = new RegExp(
    `<(?:[\\w-]+:)?${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${escaped}>`,
    "gi",
  );
  return [...xml.matchAll(regex)].map((match) =>
    match[1].replace(/<[^>]+>/g, " ").replace(/\\s+/g, " ").trim(),
  ).filter(Boolean);
}

function profileEvents(events: MobilithekTrainEvent[]) {
  const lines = unique(events.flatMap((event) => [event.line, ...event.route]));
  const categories = unique(events.map((event) => event.category));
  const stations = unique(events.flatMap((event) => [
    event.origin,
    event.destination,
    ...event.route,
    ...event.calls.map((call) => call.name),
  ]));
  const times = events.map((event) => event.actualTime).filter((value) => value instanceof Date && !Number.isNaN(value.getTime()));

  return {
    parsedEvents: events.length,
    lines,
    categories,
    stations,
    minActualTime: times.length ? new Date(Math.min(...times.map((d) => d.getTime()))).toISOString() : null,
    maxActualTime: times.length ? new Date(Math.max(...times.map((d) => d.getTime()))).toISOString() : null,
  };
}

async function main() {
  validateConfig();
  console.log("\n==============================================");
  console.log(" Mobilithek Subscription Profiling");
  console.log(" EINMALIGE INVENTUR – KEIN SNAPSHOT-WRITE");
  console.log("==============================================\n");
  console.log(`Subscriptions: ${config.subscriptionIds.length}\n`);

  const profiles: unknown[] = [];

  for (const [index, subscriptionId] of config.subscriptionIds.entries()) {
    console.log(`[${index + 1}/${config.subscriptionIds.length}] ${subscriptionId}`);

    try {
      const started = Date.now();
      const feed = await fetchFeed(subscriptionId);
      const elapsedMs = Date.now() - started;
      let events: MobilithekTrainEvent[] = [];

      if (feed.kind === "siri-journey") {
        events = parseBody(feed.bytes.toString("utf8"));
      } else if (feed.kind === "gtfs-rt") {
        events = parseGtfsRtTripUpdates(feed.bytes);
      }

      const profile = {
        subscriptionId,
        feedKind: feed.kind,
        bytes: feed.bytes.length,
        elapsedMs,
        ...profileEvents(events),
      };

      profiles.push(profile);
      console.log(`  feed:       ${profile.feedKind}`);
      console.log(`  bytes:      ${profile.bytes}`);
      console.log(`  duration:   ${profile.elapsedMs} ms`);
      console.log(`  events:     ${profile.parsedEvents}`);
      console.log(`  lines:      ${profile.lines.length}`);
      console.log(`  categories: ${profile.categories.length}`);
      console.log(`  stations:   ${profile.stations.length}`);
      console.log(`  actualTime: ${profile.minActualTime ?? "-"} → ${profile.maxActualTime ?? "-"}`);
      console.log(`  line sample: ${profile.lines.slice(0, 40).join(", ")}`);
      console.log(`  category sample: ${profile.categories.slice(0, 20).join(", ")}`);
      console.log(`  station sample: ${profile.stations.slice(0, 40).join(" | ")}`);
      console.log("");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      profiles.push({ subscriptionId, error: message });
      console.log(`  ERROR: ${message}\n`);
    }
  }

  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile("subscription-profiles.json", JSON.stringify(profiles, null, 2), "utf8"),
  );

  console.log("==============================================");
  console.log("Profiling abgeschlossen.");
  console.log("Geschrieben: subscription-profiles.json");
  console.log("==============================================");
}

main().catch((error) => {
  console.error("[profileSubscriptions] fatal", error);
  process.exit(1);
});
