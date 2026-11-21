import type { Client } from "@libsql/client";
import type { TrainObservation } from "../../shared-types/src";
import type { OpenBoardsStationObservation } from "./openBoardsNormalizer";

function parseStringArray(value: unknown): string[] {
  try {
    const parsed = value ? JSON.parse(String(value)) : [];
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** Read unexpired OpenBoards observations for a bounded set of station EVAs. */
export async function getOpenBoardsObservations(
  db: Client,
  evaNumbers: string[],
  options: { from?: string; to?: string; limit?: number } = {},
): Promise<OpenBoardsStationObservation[]> {
  const evas = [...new Set(evaNumbers.map((value) => String(value).trim()).filter(Boolean))];
  if (!evas.length) return [];

  const limit = Math.max(1, Math.min(10_000, Math.floor(options.limit ?? 2_000)));
  const clauses = [
    `eva_number IN (${evas.map(() => "?").join(",")})`,
    "expires_at > ?",
  ];
  const args: Array<string | number> = [...evas, new Date().toISOString()];

  if (options.from) {
    clauses.push("event_time >= ?");
    args.push(options.from);
  }
  if (options.to) {
    clauses.push("event_time <= ?");
    args.push(options.to);
  }

  const result = await db.execute({
    sql: `SELECT journey_id, eva_number, direction, event_time, scheduled_time,
                 time_type, line, category, journey_number, origin_eva,
                 destination_eva, via_evas_json, route_evas_json,
                 route_names_json, platform, cancelled, observed_at
          FROM openboards_observations
          WHERE ${clauses.join(" AND ")}
          ORDER BY event_time ASC
          LIMIT ?`,
    args: [...args, limit],
  });

  return (result.rows as Array<Record<string, unknown>>).map((row) => ({
    source: "openboards",
    journeyId: String(row.journey_id || ""),
    evaNumber: String(row.eva_number || ""),
    direction: String(row.direction) as "arrivals" | "departures",
    eventTime: String(row.event_time || ""),
    scheduledTime: row.scheduled_time == null ? undefined : String(row.scheduled_time),
    timeType: String(row.time_type || "UNKNOWN"),
    line: String(row.line || ""),
    category: String(row.category || ""),
    journeyNumber: Number(row.journey_number || 0),
    originEva: row.origin_eva == null ? undefined : String(row.origin_eva),
    destinationEva: row.destination_eva == null ? undefined : String(row.destination_eva),
    viaEvas: parseStringArray(row.via_evas_json),
    routeEvas: parseStringArray(row.route_evas_json),
    routeNames: parseStringArray(row.route_names_json),
    platform: row.platform == null ? undefined : String(row.platform),
    cancelled: Number(row.cancelled || 0) === 1,
    observedAt: row.observed_at == null ? undefined : String(row.observed_at),
  }));
}

/**
 * Find a strict station-level match between an OpenBoards board row and a
 * Mobilithek-derived route candidate. Route identity stays with Mobilithek;
 * OpenBoards contributes only the live time for the same train/station event.
 */
export function findMatchingOpenBoardsObservation(
  candidate: {
    observationEva: string;
    observationDirection: "arrivals" | "departures" | "unknown";
    observationScheduledTime?: string;
    line?: string;
    journeyNumber?: number;
  },
  observations: OpenBoardsStationObservation[],
): OpenBoardsStationObservation | null {
  const eva = String(candidate.observationEva || "").trim();
  const journeyNumber = Number(candidate.journeyNumber || 0);
  const line = String(candidate.line || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const scheduledAt = Date.parse(String(candidate.observationScheduledTime || ""));

  // Without all three stable anchors, do not guess from a line or time alone.
  if (!eva || !journeyNumber || !line || candidate.observationDirection === "unknown" || !Number.isFinite(scheduledAt)) {
    return null;
  }

  const matches = observations
    .filter((observation) => {
      if (observation.evaNumber !== eva || observation.direction !== candidate.observationDirection) return false;
      if (Number(observation.journeyNumber || 0) !== journeyNumber) return false;
      if (String(observation.line || "").toUpperCase().replace(/[^A-Z0-9]/g, "") !== line) return false;
      if (observation.timeType !== "REAL" && observation.timeType !== "PREVIEW") return false;
      const eventAt = Date.parse(observation.eventTime);
      const boardScheduledAt = Date.parse(String(observation.scheduledTime || ""));
      return Number.isFinite(eventAt) && Number.isFinite(boardScheduledAt) && Math.abs(boardScheduledAt - scheduledAt) <= 180_000;
    })
    .sort((a, b) => {
      const quality = (value: string) => value === "REAL" ? 0 : 1;
      const aDelta = Math.abs(Date.parse(String(a.scheduledTime)) - scheduledAt);
      const bDelta = Math.abs(Date.parse(String(b.scheduledTime)) - scheduledAt);
      if (quality(a.timeType) !== quality(b.timeType)) return quality(a.timeType) - quality(b.timeType);
      if (aDelta !== bDelta) return aDelta - bDelta;
      return Date.parse(String(b.observedAt || "")) - Date.parse(String(a.observedAt || ""));
    });

  return matches[0] || null;
}

/**
 * Convert an OpenBoards board observation to the shared, source-neutral
 * prediction input. OpenBoards route context remains partial by definition.
 */
export function toTrainObservation(
  observation: OpenBoardsStationObservation,
  observedAt = new Date().toISOString(),
): TrainObservation {
  const timeQuality =
    observation.timeType === "REAL" || observation.timeType === "PREVIEW"
      ? observation.timeType
      : "UNKNOWN";

  return {
    source: "openboards",
    journeyId: observation.journeyId,
    stationRef: observation.evaNumber,
    direction: observation.direction,
    observedAt: observation.observedAt || observedAt,
    eventTime: observation.eventTime,
    scheduledTime: observation.scheduledTime,
    timeQuality,
    line: observation.line,
    category: observation.category,
    journeyNumber: observation.journeyNumber,
    originRef: observation.originEva,
    destinationRef: observation.destinationEva,
    viaRefs: observation.viaEvas,
    routeRefs: observation.routeEvas,
    routeNames: observation.routeNames,
    routeCompleteness: observation.routeEvas.length ? "partial" : "unknown",
    platform: observation.platform,
    cancelled: observation.cancelled,
  };
}
