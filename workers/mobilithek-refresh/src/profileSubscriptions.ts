import https from "node:https";
import { gunzipSync } from "node:zlib";

import {
  classifyFeed,
  parseBody,
  parseGtfsRtTripUpdates,
  type MobilithekTrainEvent,
} from "@crossing/db-api-client";

import { config, validateConfig } from "./config.js";
import { loadDemandCrossings } from "./demand.js";

type DemandCrossing = Awaited<ReturnType<typeof loadDemandCrossings>>[number];

const DEFAULT_TARGETS = [
  "Bünde (Westf)",
  "Bünde",
  "Osnabrück Hbf",
  "Osnabrück",
  "Hannover Hbf",
  "Hannover",
  "Bielefeld Hbf",
  "Bielefeld",
  "8003288",
  "8000059",
  "8000036",
  "8000152",
  "8000294",
];

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

function normalize(value: string): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/hauptbahnhof|hbf|bahnhof|westf\.?|westfalen/gi, " ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function targetMatchesValue(value: string | undefined, target: string): boolean {
  if (!value) return false;
  const needle = normalize(target);
  const normalized = normalize(value);
  if (!needle || !normalized) return false;
  return normalized === needle || normalized.includes(needle) || needle.includes(normalized);
}

function targetMatchesEvent(event: MobilithekTrainEvent, target: string): boolean {
  const values = [
    event.origin,
    event.destination,
    ...event.route,
    ...event.calls.map((call) => call.name),
  ];
  return values.some((value) => targetMatchesValue(value, target));
}

function profileEvents(events: MobilithekTrainEvent[], targets: string[]) {
  // Runtime only needs the subscription → target coverage mapping.
  // Do not persist the full feed inventory (lines/stations/categories/counts),
  // which can grow to several megabytes and is not needed by the selector.
  const targetMatches = targets.filter((target) =>
    events.some((event) => targetMatchesEvent(event, target)),
  );

  return {
    parsedEvents: events.length,
    targetMatches,
  };
}

async function loadTargetsFromDemand(): Promise<{ targets: string[]; demand: DemandCrossing[] }> {
  const demand = await loadDemandCrossings();
  const targets = unique(
    demand.flatMap((crossing) => [
      ...crossing.requiredRouteStops,
      ...crossing.observationStations,
    ]),
  );
  return { targets, demand };
}

async function main() {
  validateConfig();

  const useDemand = process.argv.includes("--demand");
  const { targets, demand } = useDemand
    ? await loadTargetsFromDemand()
    : { targets: DEFAULT_TARGETS, demand: [] as DemandCrossing[] };

  console.log("\n==============================================");
  console.log(" Mobilithek Subscription Profiling");
  console.log(" EINMALIGE INVENTUR – KEIN SNAPSHOT-WRITE");
  console.log("==============================================\n");
  console.log(`Subscriptions: ${config.subscriptionIds.length}`);
  console.log(`Mode: ${useDemand ? "LIVE DEMAND" : "DEFAULT TARGETS"}`);
  if (useDemand) console.log(`Demand crossings: ${demand.length}`);
  console.log(`Targets: ${targets.length}`);
  console.log(`Target list: ${targets.join(" | ")}\n`);

  if (useDemand && targets.length === 0) {
    console.log("Keine aktuell nachgefragten Targets; nichts zu profilieren.");
    return;
  }

  const profiles: Array<{
    subscriptionId: string;
    feedKind?: ReturnType<typeof classifyFeed>;
    parsedEvents?: number;
    targetMatches?: string[];
    error?: string;
  }> = [];

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
        parsedEvents: events.length,
        targetMatches: profileEvents(events, targets).targetMatches,
      };

      profiles.push(profile);
      console.log(`  feed:       ${profile.feedKind}`);
      console.log(`  bytes:      ${feed.bytes.length}`);
      console.log(`  duration:   ${elapsedMs} ms`);
      console.log(`  events:     ${profile.parsedEvents}`);
      console.log(
        `  TARGET MATCHES: ${profile.targetMatches.length ? profile.targetMatches.join(" | ") : "NONE"}`,
      );
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