/**
 * Normalizes the station observations returned by DB OpenBoards.
 *
 * OpenBoards is a board API, not a guaranteed complete journey API. Each row
 * is one arrival/departure observation at one EVA. The via list is retained
 * as route context, but callers must not assume that it is a complete route.
 */

import type { OpenBoardsDirection, OpenBoardsBatchResult } from "./openBoardsClient";

export type OpenBoardsStationObservation = {
  source: "openboards";
  journeyId: string;
  evaNumber: string;
  direction: OpenBoardsDirection;
  eventTime: string;
  scheduledTime?: string;
  timeType: string;
  line: string;
  category: string;
  journeyNumber: number;
  originEva?: string;
  destinationEva?: string;
  viaEvas: string[];
  routeEvas: string[];
  routeNames: string[];
  platform?: string;
  cancelled: boolean;
};

function asObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" ? value as Record<string, any> : {};
}

function asText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  const object = asObject(value);
  return String(object.name ?? object.value ?? object.text ?? "").trim();
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function evaOf(value: unknown): string {
  const object = asObject(value);
  return String(object.evaNumber ?? object.eva ?? object.id ?? "").trim();
}

function viaEvasOf(transport: Record<string, any>): string[] {
  const via = Array.isArray(transport.via) ? transport.via : [];
  return unique(via.map(evaOf));
}

function routeForRow(
  direction: OpenBoardsDirection,
  originEva: string,
  destinationEva: string,
  viaEvas: string[],
  currentEva: string,
): string[] {
  const route = unique([originEva, ...viaEvas, destinationEva]);
  if (!currentEva || route.includes(currentEva)) return route;

  // The current board stop is not always repeated in the API's via list.
  // Insert it on the side implied by the board type without claiming that
  // the resulting list is a complete or authoritative journey path.
  if (direction === "departures") {
    const index = originEva && route.includes(originEva) ? route.indexOf(originEva) + 1 : 0;
    route.splice(index, 0, currentEva);
  } else {
    const index = destinationEva && route.includes(destinationEva) ? route.indexOf(destinationEva) : route.length;
    route.splice(index, 0, currentEva);
  }
  return unique(route);
}

export function normalizeOpenBoardsBatch(
  batch: OpenBoardsBatchResult,
): OpenBoardsStationObservation[] {
  const data = asObject(batch.data);
  const rows = Array.isArray(data[batch.direction]) ? data[batch.direction] : [];
  const stopPlaces = Array.isArray(data.stopPlaces) ? data.stopPlaces : [];
  const namesByEva = new Map<string, string>();

  for (const placeValue of stopPlaces) {
    const place = asObject(placeValue);
    const eva = evaOf(place);
    const localized = Array.isArray(place.localizedNames) ? place.localizedNames : [];
    const german = localized.find((entry: any) => entry?.language === "deu");
    const name = asText(german?.name ?? localized[0]?.name ?? place.name);
    if (eva && name) namesByEva.set(eva, name);
  }

  return rows.map((rowValue: unknown) => {
    const row = asObject(rowValue);
    const transport = asObject(row.transport);
    const journeyInfo = asObject(row.journeyInfo);
    const originEva = evaOf(journeyInfo.origin);
    const destinationEva = evaOf(journeyInfo.destination);
    const evaNumber = String(row.evaNumber ?? "").trim();
    const viaEvas = viaEvasOf(transport);
    const routeEvas = routeForRow(batch.direction, originEva, destinationEva, viaEvas, evaNumber);
    const journeyId = String(row.journeyId ?? row.journeyRef ?? "").trim();
    const line = asText(asObject(transport.line).name ?? transport.line ?? transport.journeyDescription);
    const eventTime = String(row.time ?? "").trim();

    return {
      source: "openboards" as const,
      journeyId,
      evaNumber,
      direction: batch.direction,
      eventTime,
      scheduledTime: row.timeSchedule ? String(row.timeSchedule) : undefined,
      timeType: String(row.timeType ?? "UNKNOWN"),
      line,
      category: String(transport.category ?? transport.type ?? ""),
      journeyNumber: Number(transport.journeyNumber ?? row.journeyNumber ?? 0),
      originEva: originEva || undefined,
      destinationEva: destinationEva || undefined,
      viaEvas,
      routeEvas,
      routeNames: routeEvas.map((eva) => namesByEva.get(eva) || eva),
      platform: asText(row.platform?.name ?? row.platform) || undefined,
      cancelled: Boolean(row.cancelled ?? row.isCancelled ?? false),
    };
  }).filter((observation) =>
    Boolean(observation.journeyId && observation.evaNumber && observation.eventTime),
  );
}

export function normalizeOpenBoardsBatches(
  batches: OpenBoardsBatchResult[],
): OpenBoardsStationObservation[] {
  const byObservation = new Map<string, OpenBoardsStationObservation>();

  for (const batch of batches) {
    for (const observation of normalizeOpenBoardsBatch(batch)) {
      const key = [
        observation.journeyId,
        observation.evaNumber,
        observation.direction,
      ].join("|");
      const previous = byObservation.get(key);
      // Prefer REAL observations over PREVIEW observations for the same
      // journey, station and direction.
      if (!previous || (previous.timeType !== "REAL" && observation.timeType === "REAL")) {
        byObservation.set(key, observation);
      }
    }
  }

  return [...byObservation.values()].sort((a, b) =>
    Date.parse(a.eventTime) - Date.parse(b.eventTime),
  );
}
