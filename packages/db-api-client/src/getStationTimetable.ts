import {
  fetchPlanXml,
  fetchChangesXml,
} from "./officialTimetableClient";

import {
  mergeStationTimetable,
  OfficialTrainEvent,
} from "./parseOfficialTimetable";

// Die DB-Timetable-API zählt jeden /plan- und /fchg-Aufruf einzeln.
// Ein Forecast darf deshalb dieselbe EVA nicht mehrfach abfragen. Die
// In-Memory-Caches wirken innerhalb einer laufenden Next.js-Instanz und
// verhindern insbesondere die Doppelabfrage durch observation + throughRules.
const CACHE_TTL_MS = 60_000;
const timetableCache = new Map<string, { expiresAt: number; value: OfficialTrainEvent[] }>();
const inFlight = new Map<string, Promise<OfficialTrainEvent[]>>();

export async function getStationTimetable(
  eva: string,
  hoursAhead = 4
): Promise<OfficialTrainEvent[]> {
  const key = `${String(eva).trim()}|${hoursAhead}`;
  const now = Date.now();
  const cached = timetableCache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;

  const running = inFlight.get(key);
  if (running) return running;

  const request = (async () => {
    const [planXmls, changesXml] = await Promise.all([
      fetchPlanXml(eva, hoursAhead),
      fetchChangesXml(eva),
    ]);

    const value = mergeStationTimetable(eva, planXmls, changesXml);
    timetableCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
    return value;
  })();

  inFlight.set(key, request);
  try {
    return await request;
  } finally {
    inFlight.delete(key);
  }
}
