import https from "node:https";
import { createHash } from "node:crypto";
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

const SUBSCRIPTION_LABELS: Record<string, string> = {
  "1027363179037855744": "DELFI-Realtime SIRI ET Oberelbe",
  "1024486200127131648": "DELFI-Realtime GTFS-RT Trip Updates",
  "1027363384068018176": "DELFI-Realtime SIRI ET Bremen, Niedersachsen, Hamburg und Rostock/VVW",
  "1027312851625926656": "DELFI-Realtime SIRI ET Rhein-Ruhr",
  "1027362883041628160": "DELFI-Realtime SIRI ET Hessen",
  "1024488922196914176": "DELFI-Realtime SIRI ET Bahndaten",
  "1027362992668151808": "DELFI-Realtime SIRI ET Bayern",
  "1027363323942670336": "DELFI-Realtime SIRI ET Sachsen-Anhalt",
  "1027362933037555712": "DELFI-Realtime SIRI ET Berlin-Brandenburg",
  "1027362816998158336": "DELFI-Realtime SIRI ET Mecklenburg-Vorpommern",
  "1027363044509749248": "DELFI-Realtime SIRI ET Schleswig-Holstein",
  "1027363247962677248": "DELFI-Realtime SIRI ET Baden-Württemberg",
  "1027362616334266368": "DELFI-Realtime SIRI ET Rhein-Sieg",
  "1027363211925434368": "DELFI-Realtime SIRI ET Mittelthüringen",
  "1027363132866998272": "DELFI-Realtime SIRI ET Rhein-Neckar-Dreieck",
  "1027363088155500544": "DELFI-Realtime SIRI ET Saarland",
  "1027363432285736960": "SIRI-ET Niedersachsen und Bremen (VBN)",
};

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
  // Only persist the subscription → target coverage mapping, not the full feed.
  const targetMatches = targets.filter((target) =>
    events.some((event) => targetMatchesEvent(event, target)),
  );

  return {
    parsedEvents: events.length,
    targetMatches,
  };
}

type JourneyFingerprints = {
  journeyRef: Set<string>;
  journeyShape: Set<string>;
};

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function fingerprintEvents(events: MobilithekTrainEvent[]): JourneyFingerprints {
  const journeyRef = new Set<string>();
  const journeyShape = new Set<string>();

  for (const event of events) {
    const calls = [...(event.calls || [])];
    const routeRefs = calls
      .map((call) => String(call.stopPointRef || call.stopPlaceRef || "").trim())
      .filter(Boolean);
    const plannedTimes = calls
      .map((call) => call.planned?.toISOString() || "")
      .filter(Boolean);

    // Require enough timetable structure to avoid treating weak GTFS-RT
    // observations or parser fallbacks as evidence of duplicate journeys.
    if (routeRefs.length < 2 || plannedTimes.length < 2) continue;

    // Provider journey references are useful for exact cross-feed comparison,
    // but can differ between regional aggregators.
    const refKey = [
      String(event.line || "").toUpperCase().replace(/\\s+/g, ""),
      String(event.journeyRef || "").trim(),
      routeRefs.join(">"),
      plannedTimes.join(">"),
    ].join("|");
    journeyRef.add(hash(refKey));

    // Structural key deliberately excludes provider-specific journey IDs.
    // It is a candidate match only: equal line/route/time does not prove
    // that two feeds carry the same operational journey.
    const shapeKey = [
      String(event.line || "").toUpperCase().replace(/\\s+/g, ""),
      routeRefs.join(">"),
      plannedTimes.join(">"),
      event.origin || "",
      event.destination || "",
    ].join("|");
    journeyShape.add(hash(shapeKey));
  }

  return { journeyRef, journeyShape };
}

function compareFingerprintSets(a: Set<string>, b: Set<string>) {
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  const union = a.size + b.size - intersection;
  return {
    intersection,
    union,
    jaccard: union ? Number((intersection / union).toFixed(4)) : 0,
    leftOnly: a.size - intersection,
    rightOnly: b.size - intersection,
  };
}

function compareFeeds(
  profiles: Array<{ subscriptionId: string; subscriptionLabel: string; parsedEvents?: number; error?: string }>,
  fingerprints: Map<string, JourneyFingerprints>,
) {
  const comparisons = [];
  for (let left = 0; left < profiles.length; left += 1) {
    for (let right = left + 1; right < profiles.length; right += 1) {
      const a = profiles[left];
      const b = profiles[right];
      const aFingerprints = fingerprints.get(a.subscriptionId);
      const bFingerprints = fingerprints.get(b.subscriptionId);
      if (!aFingerprints || !bFingerprints) continue;

      const exactJourneyRef = compareFingerprintSets(
        aFingerprints.journeyRef,
        bFingerprints.journeyRef,
      );
      const structuralJourney = compareFingerprintSets(
        aFingerprints.journeyShape,
        bFingerprints.journeyShape,
      );

      if (exactJourneyRef.intersection || structuralJourney.intersection) {
        comparisons.push({
          left: { subscriptionId: a.subscriptionId, label: a.subscriptionLabel },
          right: { subscriptionId: b.subscriptionId, label: b.subscriptionLabel },
          leftParsedEvents: a.parsedEvents || 0,
          rightParsedEvents: b.parsedEvents || 0,
          exactJourneyRef,
          structuralJourney,
          interpretation:
            exactJourneyRef.jaccard >= 0.8
              ? "strong-exact-overlap-review-required"
              : structuralJourney.jaccard >= 0.8
                ? "strong-structural-overlap-review-required"
                : "partial-overlap-review",
        });
      }
    }
  }

  return comparisons.sort((a, b) =>
    b.exactJourneyRef.jaccard - a.exactJourneyRef.jaccard ||
    b.structuralJourney.jaccard - a.structuralJourney.jaccard,
  );
}

const OWL_TARGET_HINTS = [
  "kirchlengern", "herford", "buende", "bielefeld", "loehne",
  "bad oeynhausen", "minden", "porta westfalica", "vlotho",
  "hiddenhausen", "enger", "spenge", "roedinghausen", "guetersloh",
  "huellhorst", "preussisch oldendorf", "stemwede", "rahden",
  "espelkamp", "paderborn",
];

function classifyTargetGroups(targets: string[]) {
  const owlFocusTargets = targets.filter((target) => {
    const normalized = normalize(target);
    return OWL_TARGET_HINTS.some((hint) => normalized.includes(normalize(hint)));
  });
  const exploratoryTargets = targets.filter((target) => !owlFocusTargets.includes(target));

  return {
    owlFocus: {
      description: "Kirchlengern und OWL – künftiger Produktivschwerpunkt",
      targets: owlFocusTargets,
    },
    exploratory: {
      description: "Weitere Testbahnhöfe und regionale Testfälle – vorerst nicht entfernen",
      targets: exploratoryTargets,
    },
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
    : { targets: [] as string[], demand: [] as DemandCrossing[] };

  console.log("\n==============================================");
  console.log(" Mobilithek Subscription Profiling");
  console.log(" EINMALIGE INVENTUR – KEIN SNAPSHOT-WRITE");
  console.log("==============================================\n");
  const subscriptionIds = unique([...Object.keys(SUBSCRIPTION_LABELS), ...config.subscriptionIds]);

  console.log(`Subscriptions to profile: ${subscriptionIds.length}`);
  console.log(`Configured environment subscriptions: ${config.subscriptionIds.length}`);
  console.log(`Known screenshot subscriptions: ${Object.keys(SUBSCRIPTION_LABELS).length}`);
  console.log(`Mode: ${useDemand ? "LIVE DEMAND" : "NO DEMAND MATCHING"}`);
  if (useDemand) console.log(`Demand crossings: ${demand.length}`);
  console.log(`Targets: ${targets.length}`);
  console.log(`Target list: ${targets.join(" | ")}\n`);

  if (useDemand && targets.length === 0) {
    console.log("Keine aktuell nachgefragten Targets; nichts zu profilieren.");
    return;
  }

  const profiles: Array<{
    subscriptionId: string;
    subscriptionLabel: string;
    feedKind?: ReturnType<typeof classifyFeed>;
    bytes?: number;
    durationMs?: number;
    parsedEvents?: number;
    targetMatches?: string[];
    error?: string;
  }> = [];
  const fingerprints = new Map<string, JourneyFingerprints>();

  for (const [index, subscriptionId] of subscriptionIds.entries()) {
    const subscriptionLabel = SUBSCRIPTION_LABELS[subscriptionId] || "Unbekanntes / nicht in Screenshot-Liste";
    console.log(`[${index + 1}/${subscriptionIds.length}] ${subscriptionLabel}`);
    console.log(`  ID: ${subscriptionId}`);

    try {
      const started = Date.now();
      const feed = await fetchFeed(subscriptionId);
      const durationMs = Date.now() - started;
      let events: MobilithekTrainEvent[] = [];

      if (feed.kind === "siri-journey") {
        events = parseBody(new TextDecoder().decode(feed.bytes));
      } else if (feed.kind === "gtfs-rt") {
        events = parseGtfsRtTripUpdates(feed.bytes);
      }

      const journeyFingerprints = fingerprintEvents(events);
      const profile = {
        subscriptionId,
        subscriptionLabel,
        feedKind: feed.kind,
        bytes: feed.bytes.length,
        durationMs,
        parsedEvents: events.length,
        fingerprintedJourneys: journeyFingerprints.journeyRef.size,
        targetMatches: useDemand ? profileEvents(events, targets).targetMatches : [],
      };

      profiles.push(profile);
      fingerprints.set(subscriptionId, journeyFingerprints);
      console.log(`  feed:       ${profile.feedKind}`);
      console.log(`  bytes:      ${profile.bytes}`);
      console.log(`  duration:   ${profile.durationMs} ms`);
      console.log(`  events:     ${profile.parsedEvents}`);
      if (useDemand) {
        console.log(
          `  TARGET MATCHES: ${profile.targetMatches.length ? profile.targetMatches.join(" | ") : "NONE"}`,
        );
      }
      console.log("");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      profiles.push({ subscriptionId, subscriptionLabel, error: message });
      console.log(`  ERROR: ${message}\n`);
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode: useDemand ? "live-demand" : "feed-inventory-only",
    configuredSubscriptions: config.subscriptionIds.length,
    profiledSubscriptions: subscriptionIds.length,
    targets,
    targetGroups: classifyTargetGroups(targets),
    targetMatchingMethod: "Approximate normalized station-name matching; not proof of production event coverage.",
    profiles,
    journeyOverlap: compareFeeds(profiles, fingerprints),
    comparisonNotes: [
      "Exact journey overlap uses a hash of line, provider journey reference, ordered stop references and planned call times.",
      "Structural overlap excludes provider journey references and is a weaker candidate signal.",
      "A high overlap is a review signal, never an automatic instruction to remove a subscription.",
      "This inventory is read-only and does not change production subscription configuration.",
    ],
  };

  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile("subscription-profiles.json", JSON.stringify(report, null, 2), "utf8"),
  );

  console.log("==============================================");
  console.log("Profiling abgeschlossen.");
  console.log("Geschrieben: subscription-profiles.json");
  console.log("Keine Turso-Snapshot-Writes ausgeführt.");
  console.log("==============================================");
}

main().catch((error) => {
  console.error("[profileSubscriptions] fatal", error);
  process.exit(1);
});
