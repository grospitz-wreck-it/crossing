import { XMLParser } from "fast-xml-parser";
import https from "node:https";
import { gunzipSync } from "node:zlib";

const DEFAULT_URL = "https://mobilithek.info:8443/mobilithek/api/v1.0/container/subscription";
const CACHE_TTL_MS = 30_000;
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", removeNSPrefix: true });

type Call = {
  name: string;
  stopRef?: string;
  plannedArrival?: Date;
  plannedDeparture?: Date;
  expectedArrival?: Date;
  expectedDeparture?: Date;
};

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
  monitored: boolean;
  operatorRef?: string;
  productCategoryRef?: string;
};

let cached: { expiresAt: number; body: string; lastModified?: string } | null = null;
let inFlight: Promise<MobilithekTrainEvent[]> | null = null;

function asArray<T>(value: T | T[] | undefined): T[] {
  return value == null ? [] : Array.isArray(value) ? value : [value];
}

function findAll(node: any, key: string): any[] {
  const out: any[] = [];
  const visit = (value: any) => {
    if (!value || typeof value !== "object") return;
    for (const [rawKey, child] of Object.entries(value)) {
      const localKey = rawKey.includes(":") ? rawKey.slice(rawKey.lastIndexOf(":") + 1) : rawKey;
      if (localKey === key) out.push(...asArray(child));
      if (child && typeof child === "object") visit(child);
    }
  };
  visit(node);
  return out;
}

function text(value: any): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const result = String(value).trim();
    return result || undefined;
  }
  if (Array.isArray(value)) return text(value[0]);
  if (typeof value === "object") return text(value.Text ?? value.Name ?? value.Value ?? value["#text"]);
  return undefined;
}

function firstText(node: any, keys: string[]): string | undefined {
  for (const key of keys) {
    const found = findAll(node, key).map(text).find(Boolean);
    if (found) return found;
  }
  return undefined;
}

function dateValue(node: any, keys: string[]): Date | undefined {
  const value = firstText(node, keys);
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function numberFrom(value?: string) {
  const match = String(value || "").match(/(\d{2,6})/);
  return match ? Number(match[1]) : 0;
}

function inferCategory(line: string, journey: any) {
  const product = (firstText(journey, ["ProductCategoryRef", "ProductCategory", "VehicleMode", "VehicleModeRef", "TrainType"]) || "").toUpperCase();
  const raw = `${line} ${product}`.toUpperCase();
  for (const category of ["ICE", "EC", "IC", "IRE", "RE", "RB", "RS", "S", "TRAM", "STR"]) {
    if (raw === category || raw.startsWith(`${category} `) || raw.includes(category)) return category;
  }
  return product || line.split(/\s+/)[0] || "TRAIN";
}

function parseBody(body: string): MobilithekTrainEvent[] {
  let root: any;
  try { root = parser.parse(body); } catch { return []; }

  const journeys = findAll(root, "EstimatedVehicleJourney");
  const now = Date.now();
  const events: MobilithekTrainEvent[] = [];

  for (let index = 0; index < journeys.length; index += 1) {
    const journey = journeys[index];
    const publishedLine = firstText(journey, ["PublishedLineName", "LineName"]);
    const lineRef = firstText(journey, ["LineRef"]);
    const line = publishedLine || lineRef || "";
    const journeyRef = firstText(journey, ["DatedVehicleJourneyRef", "VehicleJourneyRef", "VehicleJourneyName"]) || `${line}-${index}`;

    const calls: Call[] = findAll(journey, "EstimatedCall")
      .map((call) => ({
        name: firstText(call, ["StopPointName", "StopPlaceName", "DestinationName", "StopPointRef"]) || "",
        stopRef: firstText(call, ["StopPointRef", "StopPlaceRef", "StopPoint"]),
        plannedArrival: dateValue(call, ["AimedArrivalTime", "PlannedArrivalTime"]),
        plannedDeparture: dateValue(call, ["AimedDepartureTime", "PlannedDepartureTime"]),
        expectedArrival: dateValue(call, ["ExpectedArrivalTime", "EstimatedArrivalTime", "ActualArrivalTime"]),
        expectedDeparture: dateValue(call, ["ExpectedDepartureTime", "EstimatedDepartureTime", "ActualDepartureTime"]),
      }))
      .filter((call) => call.name && (call.plannedArrival || call.plannedDeparture || call.expectedArrival || call.expectedDeparture));

    if (!calls.length) continue;
    const route = calls.map((call) => call.name);
    const nextCall = calls.find((call) => {
      const t = call.expectedArrival || call.expectedDeparture || call.plannedArrival || call.plannedDeparture;
      return t && t.getTime() >= now - 5 * 60_000;
    }) || calls[calls.length - 1];
    const actualTime = nextCall.expectedArrival || nextCall.expectedDeparture || nextCall.plannedArrival || nextCall.plannedDeparture;
    const scheduledTime = nextCall.plannedArrival || nextCall.plannedDeparture || actualTime;
    if (!actualTime || !scheduledTime) continue;

    const delayMinutes = Math.round((actualTime.getTime() - scheduledTime.getTime()) / 60_000);
    const destination = firstText(journey, ["DestinationName", "DestinationText", "DestinationDisplay"]) || calls[calls.length - 1]?.name;
    const origin = firstText(journey, ["OriginName", "OriginText"]) || calls[0]?.name;
    const productCategoryRef = firstText(journey, ["ProductCategoryRef", "ProductCategory"]);
    const monitored = String(firstText(journey, ["Monitored"]) || "false").toLowerCase() === "true";

    events.push({
      id: `${journeyRef}:${nextCall.stopRef || nextCall.name}`,
      line,
      category: inferCategory(line, journey),
      journeyNumber: numberFrom(firstText(journey, ["VehicleJourneyName", "PublishedLineName"]) || journeyRef),
      journeyRef,
      origin,
      destination,
      route,
      calls,
      actualTime,
      scheduledTime,
      delayMinutes,
      direction: firstText(journey, ["DirectionName", "DirectionRef"]) || "",
      monitored,
      operatorRef: firstText(journey, ["OperatorRef"]),
      productCategoryRef,
    });
  }
  return events;
}

function fetchFeed(): Promise<string> {
  const baseUrl = process.env.MOBILITHEK_SUBSCRIPTION_URL?.trim() || DEFAULT_URL;
  const subscriptionId = process.env.MOBILITHEK_SUBSCRIPTION_ID_4?.trim() || process.env.MOBILITHEK_SUBSCRIPTION_ID?.trim();
  const p12Base64 = process.env.MOBILITHEK_CLIENT_P12_BASE64?.trim();
  if (!subscriptionId) throw new Error("MOBILITHEK_SUBSCRIPTION_ID_4/MOBILITHEK_SUBSCRIPTION_ID fehlt");
  if (!p12Base64) throw new Error("MOBILITHEK_CLIENT_P12_BASE64 fehlt");

  const url = new URL(baseUrl);
  url.searchParams.set("subscriptionID", subscriptionId);

  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: "GET",
      pfx: Buffer.from(p12Base64, "base64"),
      passphrase: process.env.MOBILITHEK_P12_PASSWORD || undefined,
      headers: { accept: "application/xml, text/xml, */*", "accept-encoding": "gzip", "user-agent": "Crossings/1.0 (meineschranke.com)", ...(cached?.lastModified ? { "if-modified-since": cached.lastModified } : {}) },
      timeout: 20_000,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on("end", () => {
        if (response.statusCode === 304 && cached) { cached.expiresAt = Date.now() + CACHE_TTL_MS; return resolve(cached.body); }
        const raw = Buffer.concat(chunks);
        let body: string;
        try { body = String(response.headers["content-encoding"] || "").includes("gzip") ? gunzipSync(raw).toString("utf8") : raw.toString("utf8"); }
        catch (error) { return reject(error); }
        if ((response.statusCode || 0) < 200 || (response.statusCode || 0) >= 300) return reject(new Error(`Mobilithek HTTP ${response.statusCode}: ${body.slice(0, 500)}`));
        cached = { expiresAt: Date.now() + CACHE_TTL_MS, body, lastModified: String(response.headers["last-modified"] || "") || undefined };
        resolve(body);
      });
    });
    request.on("timeout", () => request.destroy(new Error("Mobilithek request timed out")));
    request.on("error", reject);
    request.end();
  });
}

export async function getMobilithekTrainRegistry(): Promise<MobilithekTrainEvent[]> {
  if (cached && cached.expiresAt > Date.now()) return parseBody(cached.body);
  if (!inFlight) inFlight = fetchFeed().then(parseBody).finally(() => { inFlight = null; });
  return inFlight;
}

export function getMobilithekStopEvent(train: MobilithekTrainEvent, eva: string): MobilithekTrainEvent | null {
  const normalizedEva = String(eva || "").trim();
  if (!normalizedEva) return null;
  const call = train.calls.find((candidate) => String(candidate.stopRef || "").trim() === normalizedEva);
  if (!call) return null;
  const actualTime = call.expectedArrival || call.expectedDeparture || call.plannedArrival || call.plannedDeparture;
  const scheduledTime = call.plannedArrival || call.plannedDeparture || actualTime;
  if (!actualTime || !scheduledTime) return null;
  return { ...train, id: `${train.journeyRef}:${normalizedEva}`, actualTime, scheduledTime, delayMinutes: Math.round((actualTime.getTime() - scheduledTime.getTime()) / 60_000) };
}

export async function getMobilithekTrainDiagnostics() {
  const body = await fetchFeed();
  const root = parser.parse(body);
  const journeys = findAll(root, "EstimatedVehicleJourney");
  const calls = findAll(root, "EstimatedCall");
  const parsed = parseBody(body);
  return { bodyLength: body.length, estimatedVehicleJourneys: journeys.length, estimatedCalls: calls.length, parsedJourneys: parsed.length, categories: Array.from(new Set(parsed.map((train) => train.category))).sort(), lines: Array.from(new Set(parsed.map((train) => train.line))).sort().slice(0, 200), sample: parsed.slice(0, 10).map((train) => ({ line: train.line, category: train.category, journeyNumber: train.journeyNumber, origin: train.origin, destination: train.destination, direction: train.direction, routeStops: train.route.length, nextStop: train.calls.find((call) => (call.expectedArrival || call.expectedDeparture || call.plannedArrival || call.plannedDeparture)?.getTime() >= Date.now())?.name, delayMinutes: train.delayMinutes })) };
}
