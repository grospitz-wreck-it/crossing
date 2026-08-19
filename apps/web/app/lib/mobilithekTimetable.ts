import { XMLParser } from "fast-xml-parser";
import https from "node:https";
import { gunzipSync } from "node:zlib";

const DEFAULT_URL = "https://mobilithek.info:8443/mobilithek/api/v1.0/container/subscription";
const CACHE_TTL_MS = 30_000;
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

type Call = { name: string; planned?: Date; actual?: Date };
export type MobilithekTrainEvent = {
  id: string; line: string; category: string; journeyNumber: number; journeyRef: string;
  origin?: string; destination?: string; route: string[]; calls: Call[];
  actualTime: Date; scheduledTime: Date; delayMinutes: number; direction: string;
};

let cached: { expiresAt: number; body: string; lastModified?: string } | null = null;
let inFlight: Promise<MobilithekTrainEvent[]> | null = null;

function text(value: any): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string" || typeof value === "number") return String(value).trim() || undefined;
  if (Array.isArray(value)) return text(value[0]);
  if (typeof value === "object") return text(value.Text ?? value.Name ?? value.Value ?? value["#text"]);
  return undefined;
}
function asArray<T>(value: T | T[] | undefined): T[] { return value == null ? [] : Array.isArray(value) ? value : [value]; }
function findAll(node: any, key: string): any[] {
  const out: any[] = [];
  const visit = (value: any) => {
    if (!value || typeof value !== "object") return;
    for (const [rawKey, v] of Object.entries(value)) {
      const localKey = rawKey.includes(":") ? rawKey.slice(rawKey.lastIndexOf(":") + 1) : rawKey;
      if (localKey === key) out.push(...asArray(v));
      if (v && typeof v === "object") visit(v);
    }
  };
  visit(node); return out;
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
function numberFrom(value?: string) { const m = String(value || "").match(/(\d{2,6})/); return m ? Number(m[1]) : 0; }
function inferCategory(line: string, journey: any) {
  const raw = `${line} ${firstText(journey, ["ProductCategoryRef", "VehicleMode", "VehicleModeRef", "TrainType"]) || ""}`.toUpperCase();
  for (const category of ["ICE", "EC", "IC", "IRE", "RE", "RB", "TRAM", "STR", "S"]) if (raw.includes(category)) return category;
  return line.split(/\s+/)[0] || "";
}

function parseBody(body: string): MobilithekTrainEvent[] {
  let root: any;
  try { root = parser.parse(body); } catch { return []; }
  const journeys = findAll(root, "EstimatedVehicleJourney");
  const events: MobilithekTrainEvent[] = [];
  for (let index = 0; index < journeys.length; index += 1) {
    const journey = journeys[index];
    const line = firstText(journey, ["LineRef", "PublishedLineName", "LineName"]) || "";
    const journeyRef = firstText(journey, ["DatedVehicleJourneyRef", "VehicleJourneyRef", "VehicleJourneyName"]) || `${line}-${index}`;
    const calls = findAll(journey, "EstimatedCall").map((call) => ({
      name: firstText(call, ["StopPointName", "StopPlaceName", "DestinationName", "StopPointRef"]) || "",
      planned: dateValue(call, ["PlannedArrivalTime", "PlannedDepartureTime"]),
      actual: dateValue(call, ["ActualArrivalTime", "ActualDepartureTime", "EstimatedArrivalTime", "EstimatedDepartureTime"]),
    })).filter((call) => call.name);
    if (!calls.length) continue;
    const relevant = calls.find((call) => call.actual) || calls[0];
    const actualTime = relevant.actual || relevant.planned;
    const scheduledTime = relevant.planned || actualTime;
    if (!actualTime || !scheduledTime) continue;
    const route = calls.map((call) => call.name);
    const lineName = line || firstText(journey, ["PublishedServiceName", "VehicleJourneyName"]) || "unknown";
    const destination = firstText(journey, ["DestinationName", "DestinationText", "DestinationDisplay"]) || calls[calls.length - 1]?.name;
    const delayMinutes = Math.max(0, Math.round((actualTime.getTime() - scheduledTime.getTime()) / 60000));
    events.push({ id: journeyRef, line: lineName, category: inferCategory(lineName, journey), journeyNumber: numberFrom(firstText(journey, ["VehicleJourneyName", "PublishedServiceName"]) || journeyRef), journeyRef, origin: calls[0]?.name, destination, route, calls, actualTime, scheduledTime, delayMinutes, direction: firstText(journey, ["DirectionRef", "DirectionName"]) || "" });
  }
  return events;
}

function fetchFeed(): Promise<string> {
  const baseUrl = process.env.MOBILITHEK_SUBSCRIPTION_URL?.trim() || DEFAULT_URL;
  const subscriptionId = process.env.MOBILITHEK_SUBSCRIPTION_ID?.trim();
  const p12Base64 = process.env.MOBILITHEK_CLIENT_P12_BASE64?.trim();
  if (!subscriptionId) throw new Error("MOBILITHEK_SUBSCRIPTION_ID fehlt");
  if (!p12Base64) throw new Error("MOBILITHEK_CLIENT_P12_BASE64 fehlt");
  const url = new URL(baseUrl); url.searchParams.set("subscriptionID", subscriptionId);
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: "GET", pfx: Buffer.from(p12Base64, "base64"), passphrase: process.env.MOBILITHEK_P12_PASSWORD || undefined,
      headers: { accept: "application/xml, text/xml, */*", "accept-encoding": "gzip", "user-agent": "Crossings/1.0 (meineschranke.com)", ...(cached?.lastModified ? { "if-modified-since": cached.lastModified } : {}) }, timeout: 15000,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on("end", () => {
        if (response.statusCode === 304 && cached) { cached.expiresAt = Date.now() + CACHE_TTL_MS; return resolve(cached.body); }
        const raw = Buffer.concat(chunks);
        let body: string;
        try { body = String(response.headers["content-encoding"] || "").includes("gzip") ? gunzipSync(raw).toString("utf8") : raw.toString("utf8"); } catch (error) { return reject(error); }
        if ((response.statusCode || 0) < 200 || (response.statusCode || 0) >= 300) return reject(new Error(`Mobilithek HTTP ${response.statusCode}: ${body.slice(0, 500)}`));
        cached = { expiresAt: Date.now() + CACHE_TTL_MS, body, lastModified: String(response.headers["last-modified"] || "") || undefined };
        resolve(body);
      });
    });
    request.on("timeout", () => request.destroy(new Error("Mobilithek request timed out")));
    request.on("error", reject); request.end();
  });
}

export async function getMobilithekTrainRegistry() {
  if (cached && cached.expiresAt > Date.now()) return parseBody(cached.body);
  if (!inFlight) inFlight = fetchFeed().then(parseBody).finally(() => { inFlight = null; });
  return inFlight;
}

export async function getMobilithekTrainDiagnostics() {
  const body = await fetchFeed();
  const root = parser.parse(body);
  return { bodyLength: body.length, estimatedVehicleJourneys: findAll(root, "EstimatedVehicleJourney").length, estimatedCalls: findAll(root, "EstimatedCall").length, hasSiri: /siri/i.test(body), hasEstimatedVehicleJourney: /EstimatedVehicleJourney/i.test(body), preview: body.slice(0, 1500) };
}
