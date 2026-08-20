import { XMLParser } from "fast-xml-parser";
import https from "node:https";
import { gunzipSync } from "node:zlib";

const DEFAULT_URL = "https://mobilithek.info:8443/mobilithek/api/v1.0/container/subscription";
const FEED_CACHE_TTL_MS = 30_000;
const PARSED_CACHE_TTL_MS = 25_000;
const LAST_GOOD_CACHE_TTL_MS = 120_000;
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

type Call = { name: string; planned?: Date; actual?: Date };
export type MobilithekTrainEvent = {
  id: string;
  line: string;
  category: string;
  journeyNumber: number;
  journeyRef: string;
  origin?: string;
  destination?: string;
  route: string[];
  calls: Call[];
  actualTime: Date;
  scheduledTime: Date;
  delayMinutes: number;
  direction: string;
  sourceSubscriptionId?: string;
};

type FeedResult = { subscriptionId: string; body: string; lastModified?: string };

let cached: { expiresAt: number; feeds: FeedResult[] } | null = null;
let parsedCached: { expiresAt: number; feedKey: string; events: MobilithekTrainEvent[] } | null = null;
let lastGoodRegistry: { expiresAt: number; events: MobilithekTrainEvent[] } | null = null;
let inFlight: Promise<MobilithekTrainEvent[]> | null = null;

function asArray<T>(value: T | T[] | undefined): T[] { return value == null ? [] : Array.isArray(value) ? value : [value]; }
function findAll(node: any, key: string): any[] { const out: any[] = []; const visit = (value: any) => { if (!value || typeof value !== "object") return; for (const [rawKey, v] of Object.entries(value)) { const localKey = rawKey.includes(":") ? rawKey.slice(rawKey.lastIndexOf(":") + 1) : rawKey; if (localKey === key) out.push(...asArray(v)); if (v && typeof v === "object") visit(v); } }; visit(node); return out; }
function text(value: any): string | undefined { if (value == null) return undefined; if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value).trim() || undefined; if (Array.isArray(value)) return text(value[0]); if (typeof value === "object") return text(value.Text ?? value.Name ?? value.Value ?? value["#text"]); return undefined; }
function firstText(node: any, keys: string[]): string | undefined { for (const key of keys) { const found = findAll(node, key).map(text).find(Boolean); if (found) return found; } return undefined; }
function dateValue(node: any, keys: string[]): Date | undefined { const value = firstText(node, keys); if (!value) return undefined; const date = new Date(value); return Number.isFinite(date.getTime()) ? date : undefined; }
function normalize(value: string) { return String(value || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\([^)]*\)/g, " ").replace(/hauptbahnhof|hbf|bahnhof|westf\.?|westfalen/gi, " ").replace(/[^a-z0-9]+/g, "").trim(); }
function routeContains(route: string[], target: string) { const t = normalize(target); return Boolean(t) && route.some((name) => { const n = normalize(name); return n === t || n.includes(t) || t.includes(n); }); }
function numberFrom(value?: string) { const m = String(value || "").match(/(\d{2,6})/); return m ? Number(m[1]) : 0; }
function inferCategory(line: string, journey: any) { const raw = `${line} ${firstText(journey, ["ProductCategoryRef", "ProductCategory", "VehicleMode", "VehicleModeRef", "TrainType"]) || ""}`.toUpperCase(); for (const category of ["ICE", "EC", "IC", "IRE", "RE", "RB", "U79", "U78", "U76", "U75", "U74", "U73", "U72", "U71", "U70", "U81", "TRAM", "STR", "S"]) if (raw.includes(category)) return category; return line.split(/\s+/)[0] || ""; }

function getSubscriptionIds(): string[] {
  const entries = Object.entries(process.env)
    .filter(([key, value]) => /^MOBILITHEK_SUBSCRIPTION_ID(?:_\d+)?$/.test(key) && Boolean(value?.trim()))
    .map(([key, value]) => ({ key, value: value!.trim() }))
    .sort((a, b) => {
      const index = (key: string) => key === "MOBILITHEK_SUBSCRIPTION_ID" ? 1 : Number(key.split("_").pop());
      return index(a.key) - index(b.key);
    })
    .map(({ value }) => value);
  return Array.from(new Set(entries));
}

function parseBody(body: string, sourceSubscriptionId?: string): MobilithekTrainEvent[] {
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
    events.push({ id: journeyRef, line: lineName, category: inferCategory(lineName, journey), journeyNumber: numberFrom(firstText(journey, ["VehicleJourneyName", "PublishedServiceName"]) || journeyRef), journeyRef, origin, destination, route, calls, actualTime, scheduledTime, delayMinutes, direction: firstText(journey, ["DirectionRef", "DirectionName"]) || "", sourceSubscriptionId });
  }
  return events;
}

function fetchSubscription(subscriptionId: string): Promise<FeedResult> {
  const baseUrl = process.env.MOBILITHEK_SUBSCRIPTION_URL?.trim() || DEFAULT_URL;
  const p12Base64 = process.env.MOBILITHEK_CLIENT_P12_BASE64?.trim();
  const passphrase = process.env.MOBILITHEK_P12_PASSWORD || undefined;
  if (!p12Base64) throw new Error("MOBILITHEK_CLIENT_P12_BASE64 fehlt");
  const url = new URL(baseUrl);
  url.searchParams.set("subscriptionID", subscriptionId);
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: "GET",
      pfx: Buffer.from(p12Base64, "base64"),
      passphrase,
      headers: { accept: "application/xml, text/xml, */*", "accept-encoding": "gzip", "user-agent": "Crossings/1.0 (meineschranke.com)" },
      timeout: 20_000,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on("end", () => {
        if (response.statusCode === 304 && cached) {
          const previous = cached.feeds.find((feed) => feed.subscriptionId === subscriptionId);
          if (previous) return resolve(previous);
        }
        const raw = Buffer.concat(chunks);
        let body: string;
        try { body = String(response.headers["content-encoding"] || "").includes("gzip") ? gunzipSync(raw).toString("utf8") : raw.toString("utf8"); }
        catch (error) { return reject(error); }
        if ((response.statusCode || 0) < 200 || (response.statusCode || 0) >= 300) return reject(new Error(`Mobilithek ${subscriptionId} HTTP ${response.statusCode}: ${body.slice(0, 300)}`));
        resolve({ subscriptionId, body, lastModified: String(response.headers["last-modified"] || "") || undefined });
      });
    });
    request.on("timeout", () => request.destroy(new Error(`Mobilithek ${subscriptionId} request timed out`)));
    request.on("error", reject);
    request.end();
  });
}

async function fetchAllFeeds(): Promise<FeedResult[]> {
  const ids = getSubscriptionIds();
  if (!ids.length) throw new Error("Keine MOBILITHEK_SUBSCRIPTION_ID* Variablen konfiguriert");
  const settled = await Promise.allSettled(ids.map((id) => fetchSubscription(id)));
  const feeds: FeedResult[] = [];
  for (let i = 0; i < settled.length; i += 1) {
    const result = settled[i];
    if (result.status === "fulfilled") feeds.push(result.value);
    else console.warn(`Mobilithek subscription ${ids[i]} unavailable; continuing with other feeds`, result.reason);
  }
  if (!feeds.length) throw new Error("Keine Mobilithek-Subscription konnte geladen werden");
  return feeds;
}

function mergeEvents(feeds: FeedResult[]): MobilithekTrainEvent[] {
  const byJourney = new Map<string, MobilithekTrainEvent>();
  for (const feed of feeds) {
    const events = parseBody(feed.body, feed.subscriptionId);
    for (const event of events) {
      const key = `${event.journeyRef}|${event.line}|${event.direction}|${event.route.join("|")}`;
      const existing = byJourney.get(key);
      if (!existing || event.actualTime.getTime() > existing.actualTime.getTime()) byJourney.set(key, event);
    }
  }
  return Array.from(byJourney.values());
}

export async function getMobilithekTrainRegistry(): Promise<MobilithekTrainEvent[]> {
  const now = Date.now();
  const ids = getSubscriptionIds();
  const feedKey = ids.join(",");

  if (parsedCached && parsedCached.expiresAt > now && parsedCached.feedKey === feedKey) return parsedCached.events;

  if (cached && cached.expiresAt > now && cached.feeds.length) {
    const events = mergeEvents(cached.feeds);
    if (events.length > 0) {
      lastGoodRegistry = { expiresAt: now + LAST_GOOD_CACHE_TTL_MS, events };
      parsedCached = { expiresAt: now + PARSED_CACHE_TTL_MS, feedKey, events };
      return events;
    }
    if (lastGoodRegistry && lastGoodRegistry.expiresAt > now) return lastGoodRegistry.events;
  }

  if (!inFlight) {
    inFlight = fetchAllFeeds().then((feeds) => {
      cached = { expiresAt: Date.now() + FEED_CACHE_TTL_MS, feeds };
      const events = mergeEvents(feeds);
      if (events.length > 0) lastGoodRegistry = { expiresAt: Date.now() + LAST_GOOD_CACHE_TTL_MS, events };
      parsedCached = { expiresAt: Date.now() + PARSED_CACHE_TTL_MS, feedKey: getSubscriptionIds().join(","), events };
      return events.length > 0 ? events : (lastGoodRegistry?.events || []);
    }).catch((error) => {
      if (lastGoodRegistry && lastGoodRegistry.expiresAt > Date.now()) {
        console.warn("Mobilithek refresh failed; serving last known good registry", error);
        return lastGoodRegistry.events;
      }
      throw error;
    }).finally(() => { inFlight = null; });
  }
  return inFlight;
}

export async function getMobilithekTrainDiagnostics() {
  const feeds = await fetchAllFeeds();
  const perSubscription = feeds.map((feed) => ({ subscriptionId: feed.subscriptionId, bodyLength: feed.body.length, estimatedVehicleJourneys: findAll(parser.parse(feed.body), "EstimatedVehicleJourney").length, hasS28: /(?:de:nrw:s28:|S\s*28)/i.test(feed.body), hasU76: /(?:<LineRef>U76<|<PublishedLineName>U76<)/i.test(feed.body) }));
  const events = mergeEvents(feeds);
  return { subscriptionCountConfigured: getSubscriptionIds().length, subscriptionCountLoaded: feeds.length, totalBodyLength: feeds.reduce((sum, feed) => sum + feed.body.length, 0), parsedJourneys: events.length, perSubscription };
}

export function filterMobilithekTrains(events: MobilithekTrainEvent[], categories: string[], observationStation: string, requiredRouteStops: string[]) { return events.filter((train) => { if (categories.length && !categories.some((category) => String(train.category).toUpperCase() === String(category).toUpperCase() || String(train.line).toUpperCase().includes(String(category).toUpperCase()))) return false; if (observationStation && !routeContains(train.route, observationStation)) return false; if (requiredRouteStops.length < 2) return true; const matched = requiredRouteStops.filter((stop) => routeContains(train.route, stop)); return matched.length >= 2; }); }
