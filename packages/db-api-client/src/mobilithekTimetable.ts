import { XMLParser } from "fast-xml-parser";
import https from "node:https";
import { gunzipSync } from "node:zlib";

const DEFAULT_URL = "https://mobilithek.info:8443/mobilithek/api/v1.0/container/subscription";
const CACHE_TTL_MS = 30_000;
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
    for (const [k, v] of Object.entries(value)) {
      if (k === key) out.push(...asArray(v));
      if (v && typeof v === "object") visit(v);
    }
  };
  visit(node);
  return out;
}

function text(value: any): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string" || typeof value === "number") return String(value).trim() || undefined;
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
  for (const key of keys) {
    const value = firstText(node, [key]);
    if (!value) continue;
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) return date;
  }
  return undefined;
}

function normalize(value: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/hauptbahnhof|hbf|bahnhof|westf\.?|westfalen/gi, " ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function routeContains(route: string[], target: string) {
  const t = normalize(target);
  return Boolean(t) && route.some((name) => {
    const n = normalize(name);
    return n === t || n.includes(t) || t.includes(n);
  });
}

function numberFrom(value?: string) {
  const m = String(value || "").match(/(\d{2,6})/);
  return m ? Number(m[1]) : 0;
}

function inferCategory(line: string, journey: any) {
  const raw = `${line} ${firstText(journey, ["ProductCategoryRef", "VehicleMode", "VehicleModeRef", "TrainType"]) || ""}`.toUpperCase();
  for (const category of ["ICE", "EC", "IC", "IRE", "RE", "RB", "S", "TRAM", "STR"]) {
    if (raw.includes(category)) return category;
  }
  return line.split(/\s+/)[0] || "";
}

function parseBody(body: string): MobilithekTrainEvent[] {
  let root: any;
  try {
    root = parser.parse(body);
  } catch {
    return [];
  }

  const journeys = findAll(root, "EstimatedVehicleJourney");
  const events: MobilithekTrainEvent[] = [];

  for (let index = 0; index < journeys.length; index += 1) {
    const journey = journeys[index];
    const line = firstText(journey, ["LineRef", "PublishedLineName", "LineName"]) || "";
    const journeyRef = firstText(journey, ["DatedVehicleJourneyRef", "VehicleJourneyRef", "VehicleJourneyName"]) || `${line}-${index}`;

    const calls = findAll(journey, "EstimatedCall")
      .map((call) => {
        const name = firstText(call, ["StopPointName", "StopPlaceName", "DestinationName", "StopPointRef"]) || "";
        const planned = dateValue(call, ["PlannedArrivalTime", "PlannedDepartureTime"]);
        const actual = dateValue(call, ["ActualArrivalTime", "ActualDepartureTime", "EstimatedArrivalTime", "EstimatedDepartureTime"]);
        return { name, planned, actual };
      })
      .filter((call) => call.name);

    if (!calls.length) continue;

    const route = calls.map((call) => call.name);
    const relevant = calls.find((call) => call.actual) || calls[0];
    const actualTime = relevant.actual || relevant.planned;
    const scheduledTime = relevant.planned || actualTime;
    if (!actualTime || !scheduledTime) continue;

    const lineName = line || firstText(journey, ["PublishedServiceName", "VehicleJourneyName"]) || "unknown";
    const destination = firstText(journey, ["DestinationName", "DestinationText", "DestinationDisplay"]) || calls[calls.length - 1]?.name;
    const origin = calls[0]?.name;
    const delayMinutes = Math.max(0, Math.round((actualTime.getTime() - scheduledTime.getTime()) / 60000));

    events.push({
      id: journeyRef,
      line: lineName,
      category: inferCategory(lineName, journey),
      journeyNumber: numberFrom(firstText(journey, ["VehicleJourneyName", "PublishedServiceName"]) || journeyRef),
      journeyRef,
      origin,
      destination,
      route,
      calls,
      actualTime,
      scheduledTime,
      delayMinutes,
      direction: firstText(journey, ["DirectionRef", "DirectionName"]) || "",
    });
  }

  return events;
}

function fetchFeed(): Promise<string> {
  const baseUrl = process.env.MOBILITHEK_SUBSCRIPTION_URL?.trim() || DEFAULT_URL;
  const subscriptionId = process.env.MOBILITHEK_SUBSCRIPTION_ID?.trim();
  const p12Base64 = process.env.MOBILITHEK_CLIENT_P12_BASE64?.trim();
  const passphrase = process.env.MOBILITHEK_P12_PASSWORD || undefined;

  if (!subscriptionId) throw new Error("MOBILITHEK_SUBSCRIPTION_ID fehlt");
  if (!p12Base64) throw new Error("MOBILITHEK_CLIENT_P12_BASE64 fehlt");

  const url = new URL(baseUrl);
  url.searchParams.set("subscriptionID", subscriptionId);

  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: "GET",
      pfx: Buffer.from(p12Base64, "base64"),
      passphrase,
      headers: {
        accept: "application/xml, text/xml, */*",
        "accept-encoding": "gzip",
        "user-agent": "Crossings/1.0 (meineschranke.com)",
        ...(cached?.lastModified ? { "if-modified-since": cached.lastModified } : {}),
      },
      timeout: 15000,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on("end", () => {
        if (response.statusCode === 304 && cached) {
          cached.expiresAt = Date.now() + CACHE_TTL_MS;
          return resolve(cached.body);
        }

        const raw = Buffer.concat(chunks);
        let body: string;
        try {
          body = String(response.headers["content-encoding"] || "").includes("gzip")
            ? gunzipSync(raw).toString("utf8")
            : raw.toString("utf8");
        } catch (error) {
          return reject(error);
        }

        if ((response.statusCode || 0) < 200 || (response.statusCode || 0) >= 300) {
          return reject(new Error(`Mobilithek HTTP ${response.statusCode}: ${body.slice(0, 500)}`));
        }

        cached = {
          expiresAt: Date.now() + CACHE_TTL_MS,
          body,
          lastModified: String(response.headers["last-modified"] || "") || undefined,
        };
        resolve(body);
      });
    });

    request.on("timeout", () => request.destroy(new Error("Mobilithek request timed out")));
    request.on("error", reject);
    request.end();
  });
}

/**
 * Central in-process Train Registry fed by the official Mobilithek SIRI
 * Estimated Timetable subscription. All crossings in the same runtime share
 * this snapshot; Last-Modified/If-Modified-Since avoids downloading unchanged
 * packages.
 */
export async function getMobilithekTrainRegistry(): Promise<MobilithekTrainEvent[]> {
  if (cached && cached.expiresAt > Date.now()) return parseBody(cached.body);
  if (!inFlight) {
    inFlight = fetchFeed().then(parseBody).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

export function filterMobilithekTrains(
  events: MobilithekTrainEvent[],
  categories: string[],
  observationStation: string,
  requiredRouteStops: string[]
) {
  return events.filter((train) => {
    if (categories.length && !categories.some((category) =>
      String(train.category).toUpperCase() === String(category).toUpperCase() ||
      String(train.line).toUpperCase().includes(String(category).toUpperCase())
    )) return false;

    if (observationStation && !routeContains(train.route, observationStation)) return false;

    if (requiredRouteStops.length < 2) return true;
    const matched = requiredRouteStops.filter((stop) => routeContains(train.route, stop));
    return matched.length >= 2;
  });
}
