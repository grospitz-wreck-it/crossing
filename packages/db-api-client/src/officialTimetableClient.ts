// Offizieller Client für die DB API Marketplace "Timetables v1"-API.

import { acquireDbApiSlot } from "./apiRateLimiter";
import { getTimetableCache, setTimetableCache } from "./timetableCache";

const BASE_URL = "https://apis.deutschebahn.com/db-api-marketplace/apis/timetables/v1";

function dbHeaders() {
  const clientId = process.env.DB_CLIENT_ID;
  const apiKey = process.env.DB_API_KEY;
  if (!clientId || !apiKey) throw new Error("DB_CLIENT_ID / DB_API_KEY fehlen. Bitte in apps/web/.env.local setzen (Zugangsdaten aus dem DB API Marketplace für das Produkt 'Timetables').");
  return { "DB-Client-Id": clientId, "DB-Api-Key": apiKey };
}

function formatDateHour(date: Date): { date: string; hour: string } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return { date: `${get("year")}${get("month")}${get("day")}`, hour: get("hour") === "24" ? "00" : get("hour") };
}

function currentFchgSlot() { return String(Math.floor(Date.now() / 30_000)); }

async function fetchXml(url: string, label: string, meta: { eva: string; requestType: string }, cacheKind: "plan" | "fchg", cacheSlot: string, forceRefresh = false): Promise<string> {
  if (!forceRefresh) {
    const cached = await getTimetableCache(cacheKind, meta.eva, cacheSlot);
    if (cached !== null) return cached;
  }
  await acquireDbApiSlot(meta);
  const res = await fetch(url, { headers: dbHeaders(), cache: "no-store" });
  const text = await res.text();
  if (!res.ok) throw new Error(`${label} fehlgeschlagen: ${res.status} ${res.statusText} - ${text.slice(0, 200)}`);
  try { await setTimetableCache(cacheKind, meta.eva, cacheSlot, text); } catch (error) { console.warn("[TIMETABLE CACHE WRITE FAILED]", error); }
  return text;
}

export async function fetchPlanXml(eva: string, hoursAhead = 4, forceRefresh = false): Promise<string[]> {
  const now = Date.now();
  const requests = Array.from({ length: hoursAhead }, (_, i) => new Date(now + i * 60 * 60 * 1000)).map((date) => {
    const { date: d, hour: h } = formatDateHour(date);
    return fetchXml(`${BASE_URL}/plan/${eva}/${d}/${h}`, `plan/${eva}/${d}/${h}`, { eva, requestType: "plan" }, "plan", `${d}-${h}`, forceRefresh);
  });
  return Promise.all(requests);
}

export async function fetchChangesXml(eva: string, forceRefresh = false): Promise<string> {
  const slot = currentFchgSlot();
  return fetchXml(`${BASE_URL}/fchg/${eva}`, `fchg/${eva}`, { eva, requestType: "fchg" }, "fchg", slot, forceRefresh);
}
