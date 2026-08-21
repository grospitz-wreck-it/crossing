import { XMLParser } from "fast-xml-parser";
import https from "node:https";
import { gunzipSync } from "node:zlib";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";

const DEFAULT_URL = "https://mobilithek.info:8443/mobilithek/api/v1.0/container/subscription";
const CACHE_TTL_MS = 30_000;
const PARSED_CACHE_TTL_MS = 25_000;
const LAST_GOOD_CACHE_TTL_MS = 120_000;
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

type Call = { name: string; planned?: Date; actual?: Date };
export type MobilithekTrainEvent = {
  id: string; line: string; category: string; journeyNumber: number; journeyRef: string;
  origin?: string; destination?: string; route: string[]; calls: Call[];
  actualTime: Date; scheduledTime: Date; delayMinutes: number; direction: string;
};

export type MobilithekFeedKind = "siri-journey" | "siri-facility" | "gtfs-rt" | "unknown";

type FeedCache = {
  expiresAt: number;
  body: string;
  bytes: Buffer;
  contentType: string;
  lastModified?: string;
};

type FetchedFeed = { id: string; body: string; bytes: Buffer; contentType: string };

let cached = new Map<string, FeedCache>();
let parsedCached: { expiresAt: number; signature: string; events: MobilithekTrainEvent[] } | null = null;
let lastGoodRegistry: { expiresAt: number; events: MobilithekTrainEvent[] } | null = null;
let inFlight: Promise<MobilithekTrainEvent[]> | null = null;

// Reads MOBILITHEK_SUBSCRIPTION_ID and MOBILITHEK_SUBSCRIPTION_ID_2 ... _15 from the environment.
// Values are trimmed, stripped of surrounding quotes, filtered for emptiness, and de-duplicated
// (in case the same subscription ID was accidentally configured under multiple slots).
function getMobilithekSubscriptionIds(): string[] {
  const raw = [
    process.env.MOBILITHEK_SUBSCRIPTION_ID,
    process.env.MOBILITHEK_SUBSCRIPTION_ID_2,
    process.env.MOBILITHEK_SUBSCRIPTION_ID_3,
    process.env.MOBILITHEK_SUBSCRIPTION_ID_4,
    process.env.MOBILITHEK_SUBSCRIPTION_ID_5,
    process.env.MOBILITHEK_SUBSCRIPTION_ID_6,
    process.env.MOBILITHEK_SUBSCRIPTION_ID_7,
    process.env.MOBILITHEK_SUBSCRIPTION_ID_8,
    process.env.MOBILITHEK_SUBSCRIPTION_ID_9,
    process.env.MOBILITHEK_SUBSCRIPTION_ID_10,
    process.env.MOBILITHEK_SUBSCRIPTION_ID_11,
    process.env.MOBILITHEK_SUBSCRIPTION_ID_12,
    process.env.MOBILITHEK_SUBSCRIPTION_ID_13,
    process.env.MOBILITHEK_SUBSCRIPTION_ID_14,
    process.env.MOBILITHEK_SUBSCRIPTION_ID_15,
  ]
    .map((id) => id?.trim().replace(/^"|"$/g, "").trim())
    .filter((id): id is string => Boolean(id));

  return Array.from(new Set(raw));
}

function asArray<T>(value: T | T[] | undefined): T[] { return value == null ? [] : Array.isArray(value) ? value : [value]; }
function findAll(node: any, key: string): any[] { const out: any[] = []; const visit = (value: any) => { if (!value || typeof value !== "object") return; for (const [rawKey, v] of Object.entries(value)) { const localKey = rawKey.includes(":") ? rawKey.slice(rawKey.lastIndexOf(":") + 1) : rawKey; if (localKey === key) out.push(...asArray(v)); if (v && typeof v === "object") visit(v); } }; visit(node); return out; }
function text(value: any): string | undefined { if (value == null) return undefined; if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value).trim() || undefined; if (Array.isArray(value)) return text(value[0]); if (typeof value === "object") return text(value.Text ?? value.Name ?? value.Value ?? value["#text"]); return undefined; }
function firstText(node: any, keys: string[]): string | undefined { for (const key of keys) { const found = findAll(node, key).map(text).find(Boolean); if (found) return found; } return undefined; }
function dateValue(node: any, keys: string[]): Date | undefined { const value = firstText(node, keys); if (!value) return undefined; const date = new Date(value); return Number.isFinite(date.getTime()) ? date : undefined; }
function normalize(value: string) { return String(value || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\([^)]*\)/g, " ").replace(/hauptbahnhof|hbf|bahnhof|westf\.?|westfalen/gi, " ").replace(/[^a-z0-9]+/g, "").trim(); }
function routeContains(route: string[], target: string) { const t = normalize(target); return Boolean(t) && route.some((name) => { const n = normalize(name); return n === t || n.includes(t) || t.includes(n); }); }
function numberFrom(value?: string) { const m = String(value || "").match(/(\d{2,6})/); return m ? Number(m[1]) : 0; }
function inferCategory(line: string, journey: any) { const raw = `${line} ${firstText(journey, ["ProductCategoryRef", "ProductCategory", "VehicleMode", "VehicleModeRef", "TrainType"]) || ""}`.toUpperCase(); for (const category of ["ICE", "EC", "IC", "IRE", "RE", "RB", "U79", "U78", "U76", "U75", "U74", "U73", "U72", "U71", "U70", "U81", "TRAM", "STR", "S"]) if (raw.includes(category)) return category; return line.split(/\s+/)[0] || ""; }

export function parseBody(body: string): MobilithekTrainEvent[] {
  let root: any; try { root = parser.parse(body); } catch { return []; }
  const journeys = findAll(root, "EstimatedVehicleJourney");
  const now = Date.now();
  const events: MobilithekTrainEvent[] = [];
  for (let index = 0; index < journeys.length; index += 1) {
    const journey = journeys[index];
    const line = firstText(journey, ["PublishedLineName", "LineRef", "LineName"]) || "";
    const journeyRef = firstText(journey, ["DatedVehicleJourneyRef", "VehicleJourneyRef", "VehicleJourneyName"]) || `${line}-${index}`;
    const calls = findAll(journey, "EstimatedCall").map((call) => {
      const name = firstText(call, ["StopPointName", "StopPlaceName", "DestinationName", "StopPointRef"]) || "";
      const planned = dateValue(call, ["AimedArrivalTime", "AimedDepartureTime", "PlannedArrivalTime", "PlannedDepartureTime"]);
      const actual = dateValue(call, ["ExpectedArrivalTime", "ExpectedDepartureTime", "EstimatedArrivalTime", "EstimatedDepartureTime", "ActualArrivalTime", "ActualDepartureTime"]);
      return { name, planned, actual };
    }).filter((call) => call.name && (call.planned || call.actual));
    if (!calls.length) continue;
    const route = calls.map((call) => call.name);
    const relevant = calls.find((call) => { const time = call.actual || call.planned; return time && time.getTime() >= now - 5 * 60_000; });
    if (!relevant) continue;
    const actualTime = relevant.actual || relevant.planned;
    const scheduledTime = relevant.planned || relevant.actual;
    if (!actualTime || !scheduledTime) continue;
    const lineName = line || firstText(journey, ["PublishedServiceName", "VehicleJourneyName"]) || "unknown";
    const destination = firstText(journey, ["DestinationName", "DestinationText", "DestinationDisplay"]) || calls[calls.length - 1]?.name;
    const origin = firstText(journey, ["OriginName", "OriginText"]) || calls[0]?.name;
    const delayMinutes = Math.round((actualTime.getTime() - scheduledTime.getTime()) / 60000);
    events.push({ id: journeyRef, line: lineName, category: inferCategory(lineName, journey), journeyNumber: numberFrom(firstText(journey, ["VehicleJourneyName", "PublishedServiceName"]) || journeyRef), journeyRef, origin, destination, route, calls, actualTime, scheduledTime, delayMinutes, direction: firstText(journey, ["DirectionRef", "DirectionName"]) || "" });
  }
  return events;
}

// Classifies a feed purely from its raw bytes/content — same heuristic already proven in
// workers/mobilithek-refresh: XML with EstimatedVehicleJourney => siri-journey, XML with
// FacilityMonitoringDelivery/FacilityCondition => siri-facility, anything non-XML => gtfs-rt
// (protobuf), everything else => unknown.
function classifyFeed(bytes: Buffer): MobilithekFeedKind {
  const preview = bytes.subarray(0, Math.min(bytes.length, 512_000)).toString("utf8");
  const trimmed = preview.trimStart();
  if (trimmed.startsWith("<")) {
    if (preview.includes("EstimatedVehicleJourney") || preview.includes("EstimatedVehicleJourneyCode")) return "siri-journey";
    if (preview.includes("FacilityMonitoringDelivery") || preview.includes("FacilityCondition")) return "siri-facility";
    return "unknown";
  }
  return "gtfs-rt";
}

function countFacilityStatuses(body: string) {
  const available = (body.match(/<Status>\s*available\s*<\/Status>/gi) || []).length;
  const unknown = (body.match(/<Status>\s*unknown\s*<\/Status>/gi) || []).length;
  const unavailable = (body.match(/<Status>\s*unavailable\s*<\/Status>/gi) || []).length;
  const total = (body.match(/<FacilityCondition\b/g) || []).length;
  return { total, available, unknown, unavailable };
}

// GTFS-RT (protobuf) TripUpdates parser, mirroring the logic already proven in
// workers/mobilithek-refresh/src/adapters/gtfs-rt.ts, adapted to MobilithekTrainEvent.
function parseGtfsRtTripUpdates(bytes: Buffer): MobilithekTrainEvent[] {
  let feed: any;
  try {
    feed = (GtfsRealtimeBindings as any).transit_realtime.FeedMessage.decode(bytes);
  } catch {
    return [];
  }
  const events: MobilithekTrainEvent[] = [];
  for (const entity of (feed.entity || []) as any[]) {
    const update = entity.tripUpdate;
    if (!update) continue;
    const trip = update.trip;
    const journeyRef = trip?.tripId || entity.id || `gtfs-${events.length}`;
    const line = trip?.routeId ? String(trip.routeId) : "";
    const direction = trip?.directionId != null ? String(trip.directionId) : "";
    const calls: Call[] = [];
    for (const stopUpdate of update.stopTimeUpdate || []) {
      const stopId = stopUpdate.stopId || "";
      const arrivalSeconds = stopUpdate.arrival?.time;
      const departureSeconds = stopUpdate.departure?.time;
      const arrival = arrivalSeconds != null && Number(arrivalSeconds) > 0 ? new Date(Number(arrivalSeconds) * 1000) : undefined;
      const departure = departureSeconds != null && Number(departureSeconds) > 0 ? new Date(Number(departureSeconds) * 1000) : undefined;
      const actual = arrival || departure;
      if (!stopId || !actual) continue;
      calls.push({ name: String(stopId), actual, planned: undefined });
    }
    if (!calls.length) continue;
    const first = calls[0];
    const actualTime = first.actual || first.planned || new Date();
    const scheduledTime = first.planned || first.actual || new Date();
    events.push({
      id: String(journeyRef),
      journeyRef: String(journeyRef),
      line: String(line),
      category: "GTFS-RT",
      journeyNumber: numberFrom(String(journeyRef)),
      origin: calls[0]?.name,
      destination: calls[calls.length - 1]?.name,
      route: calls.map((call) => call.name),
      calls,
      actualTime,
      scheduledTime,
      delayMinutes: Math.round((actualTime.getTime() - scheduledTime.getTime()) / 60000),
      direction,
    });
  }
  return events;
}

async function fetchFeed(subscriptionId: string): Promise<{ body: string; bytes: Buffer; contentType: string }> {
  const baseUrl = process.env.MOBILITHEK_SUBSCRIPTION_URL?.trim() || DEFAULT_URL;
  const p12Base64 = process.env.MOBILITHEK_CLIENT_P12_BASE64?.trim();
  const passphrase = process.env.MOBILITHEK_P12_PASSWORD || undefined;

  if (!subscriptionId) throw new Error("Mobilithek Subscription ID fehlt");
  if (!p12Base64) throw new Error("MOBILITHEK_CLIENT_P12_BASE64 fehlt");

  const previous = cached.get(subscriptionId);
  const url = new URL(baseUrl);
  url.searchParams.set("subscriptionID", subscriptionId);

  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: "GET",
        pfx: Buffer.from(p12Base64, "base64"),
        passphrase,
        headers: {
          accept: "application/xml, text/xml, */*",
          "accept-encoding": "gzip",
          "user-agent": "Crossings/1.0 (meineschranke.com)",
          ...(previous?.lastModified
            ? { "if-modified-since": previous.lastModified }
            : {}),
        },
        timeout: 20000,
      },
      (response) => {
        const chunks: Buffer[] = [];

        response.on("data", (chunk) =>
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
        );

        response.on("end", () => {
          if (response.statusCode === 304 && previous) {
            previous.expiresAt = Date.now() + CACHE_TTL_MS;
            return resolve({ body: previous.body, bytes: previous.bytes, contentType: previous.contentType });
          }

          const raw = Buffer.concat(chunks);
          const contentType = String(response.headers["content-type"] || "");

          let bytes: Buffer;
          let body: string;

          try {
            bytes = String(response.headers["content-encoding"] || "").includes("gzip")
              ? gunzipSync(raw)
              : raw;
            body = bytes.toString("utf8");
          } catch (error) {
            return reject(error);
          }

          if ((response.statusCode || 0) < 200 || (response.statusCode || 0) >= 300) {
            return reject(
              new Error(
                `Mobilithek ${subscriptionId} HTTP ${response.statusCode}: ${body.slice(0, 500)}`,
              ),
            );
          }

          cached.set(subscriptionId, {
            expiresAt: Date.now() + CACHE_TTL_MS,
            body,
            bytes,
            contentType,
            lastModified:
              String(response.headers["last-modified"] || "") || undefined,
          });

          resolve({ body, bytes, contentType });
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

async function fetchAllFeeds(): Promise<FetchedFeed[]> {
  const ids = getMobilithekSubscriptionIds();

  if (!ids.length) {
    throw new Error("Keine MOBILITHEK_SUBSCRIPTION_ID* Variablen konfiguriert");
  }

  const successful: FetchedFeed[] = [];
  const failed: string[] = [];

  // IMPORTANT: Feeds bewusst SEQUENZIELL laden.
  // Große Mobilithek-SIRI-Feeds können mehrere Dutzend MB groß sein.
  // Promise.allSettled() würde alle Payloads gleichzeitig im Vercel-RAM halten.
  for (const id of ids) {
    try {
      const now = Date.now();
      const existing = cached.get(id);

      if (existing && existing.expiresAt > now) {
        successful.push({
          id,
          body: existing.body,
          bytes: existing.bytes,
          contentType: existing.contentType,
        });
        continue;
      }

      const feed = await fetchFeed(id);

      successful.push({
        id,
        body: feed.body,
        bytes: feed.bytes,
        contentType: feed.contentType,
      });
    } catch (error) {
      failed.push(
        `${id}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  if (failed.length) {
    console.warn(
      `Mobilithek: ${failed.length}/${ids.length} Subscriptions fehlgeschlagen`,
      failed,
    );
  }

  if (!successful.length) {
    throw new Error("Alle Mobilithek-Subscriptions fehlgeschlagen");
  }

  return successful;
}
export async function getMobilithekTrainRegistry(): Promise<MobilithekTrainEvent[]> {
  const now = Date.now();
  const ids = getMobilithekSubscriptionIds();

  if (!ids.length) {
    throw new Error("Keine MOBILITHEK_SUBSCRIPTION_ID* Variablen konfiguriert");
  }

  const signature = ids.join("|");

  if (
    parsedCached &&
    parsedCached.expiresAt > now &&
    parsedCached.signature === signature
  ) {
    return parsedCached.events;
  }

  if (!inFlight) {
    inFlight = fetchAllFeeds()
      .then((feeds) => {
        const allEvents: MobilithekTrainEvent[] = [];

        for (const feed of feeds) {
          let events: MobilithekTrainEvent[] = [];

          try {
            const kind = classifyFeed(feed.bytes);
            if (kind === "siri-journey") {
              events = parseBody(feed.body);
            } else if (kind === "gtfs-rt") {
              events = parseGtfsRtTripUpdates(feed.bytes);
            } else {
              // siri-facility and unknown feeds carry no journey/train events for the
              // registry; they are valid feeds, just not journey sources, so we skip
              // them here without treating this as an error.
              events = [];
            }
          } catch (error) {
            console.warn(
              `Mobilithek: Feed ${feed.id} konnte nicht geparst werden`,
              error instanceof Error ? error.message : String(error),
            );
            events = [];
          }

          for (const event of events) {
            allEvents.push({
              ...event,
              id: `${feed.id}:${event.id}`,
              journeyRef: `${feed.id}:${event.journeyRef}`,
            });
          }
        }

        const unique = new Map<string, MobilithekTrainEvent>();

        for (const event of allEvents) {
          const key = [
            event.line,
            event.journeyRef,
            event.actualTime.toISOString(),
          ].join("|");

          if (!unique.has(key)) unique.set(key, event);
        }

        const events = Array.from(unique.values());

        if (events.length > 0) {
          lastGoodRegistry = {
            expiresAt: Date.now() + LAST_GOOD_CACHE_TTL_MS,
            events,
          };
        } else if (
          lastGoodRegistry &&
          lastGoodRegistry.expiresAt > Date.now()
        ) {
          console.warn(
            "Mobilithek refresh parsed zero journeys; serving last known good registry",
          );

          parsedCached = {
            expiresAt: Date.now() + PARSED_CACHE_TTL_MS,
            signature,
            events: lastGoodRegistry.events,
          };

          return lastGoodRegistry.events;
        }

        parsedCached = {
          expiresAt: Date.now() + PARSED_CACHE_TTL_MS,
          signature,
          events,
        };

        return events;
      })
      .finally(() => {
        inFlight = null;
      });
  }

  return inFlight;
}
export async function getMobilithekTrainDiagnostics() {
  const subscriptionIds = getMobilithekSubscriptionIds();
  const feeds: Array<{
    index: number;
    subscriptionId: string;
    ok: boolean;
    kind?: MobilithekFeedKind;
    status?: number;
    bodyLength?: number;
    estimatedVehicleJourneys?: number;
    estimatedCalls?: number;
    parsedJourneys?: number;
    facilityConditions?: number;
    gtfsRtTripUpdates?: number;
    hasS28?: boolean;
    hasU76?: boolean;
    error?: string;
  }> = [];

  const BATCH_SIZE = 3;

  for (let offset = 0; offset < subscriptionIds.length; offset += BATCH_SIZE) {
    const batch = subscriptionIds.slice(offset, offset + BATCH_SIZE);

    const results = await Promise.all(
      batch.map(async (subscriptionId, batchIndex) => {
        const index = offset + batchIndex + 1;

        try {
          const feed = await fetchFeed(subscriptionId);
          const kind = classifyFeed(feed.bytes);

          const base = {
            index,
            subscriptionId,
            ok: true,
            status: 200,
            kind,
            bodyLength: feed.body.length,
          };

          if (kind === "siri-journey") {
            const root = parser.parse(feed.body);
            const journeys = findAll(root, "EstimatedVehicleJourney");
            const calls = findAll(root, "EstimatedCall");
            const parsedJourneys = parseBody(feed.body);

            return {
              ...base,
              estimatedVehicleJourneys: journeys.length,
              estimatedCalls: calls.length,
              parsedJourneys: parsedJourneys.length,
              hasS28: /<LineRef>\s*(?:de:nrw:s28:|S28)\s*<\/LineRef>/i.test(feed.body),
              hasU76: /<LineRef>\s*U76\s*<\/LineRef>/i.test(feed.body),
            };
          }

          if (kind === "siri-facility") {
            const stats = countFacilityStatuses(feed.body);
            return { ...base, facilityConditions: stats.total };
          }

          if (kind === "gtfs-rt") {
            const journeys = parseGtfsRtTripUpdates(feed.bytes);
            return { ...base, gtfsRtTripUpdates: journeys.length };
          }

          return base;
        } catch (error) {
          return {
            index,
            subscriptionId,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );

    feeds.push(...results);
  }

  return {
    ok: true,
    multiFeedVersion: "2026-08-21-multi-feed-type-aware-v4",
    configured: subscriptionIds.length,
    loaded: feeds.filter((feed) => feed.ok).length,
    failed: feeds.filter((feed) => !feed.ok).length,
    feeds,
    feedTypes: {
      siriJourney: feeds.filter((feed) => feed.kind === "siri-journey").length,
      siriFacility: feeds.filter((feed) => feed.kind === "siri-facility").length,
      gtfsRt: feeds.filter((feed) => feed.kind === "gtfs-rt").length,
      unknown: feeds.filter((feed) => feed.ok && feed.kind === "unknown").length,
    },
    totals: {
      estimatedVehicleJourneys: feeds.reduce(
        (sum, feed) => sum + (feed.estimatedVehicleJourneys || 0),
        0,
      ),
      estimatedCalls: feeds.reduce(
        (sum, feed) => sum + (feed.estimatedCalls || 0),
        0,
      ),
      parsedJourneys: feeds.reduce(
        (sum, feed) => sum + (feed.parsedJourneys || 0),
        0,
      ),
      facilityConditions: feeds.reduce(
        (sum, feed) => sum + (feed.facilityConditions || 0),
        0,
      ),
      gtfsRtTripUpdates: feeds.reduce(
        (sum, feed) => sum + (feed.gtfsRtTripUpdates || 0),
        0,
      ),
    },
  };
}
export function filterMobilithekTrains(events: MobilithekTrainEvent[], categories: string[], observationStation: string, requiredRouteStops: string[]) { return events.filter((train) => { if (categories.length && !categories.some((category) => String(train.category).toUpperCase() === String(category).toUpperCase() || String(train.line).toUpperCase().includes(String(category).toUpperCase()))) return false; if (observationStation && !routeContains(train.route, observationStation)) return false; if (requiredRouteStops.length < 2) return true; const matched = requiredRouteStops.filter((stop) => routeContains(train.route, stop)); return matched.length >= 2; }); }