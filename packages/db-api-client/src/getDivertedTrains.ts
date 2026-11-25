import type { Crossing } from "../../crossing-model/src/types";
import {
  getMobilithekTrainRegistry,
  type MobilithekTrainEvent,
} from "./mobilithekTimetable";

export type DivertedTrain = {
  line: string;
  category: string;
  journeyNumber: number;

  destination?: string;
  origin?: string;
  route: string[];

  delayMinutes: number;

  observationEva: string;
  observationStation: string;
  observationActualTime: string;

  note: string;
};

function normalizeStation(value: string): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(
      /hauptbahnhof|hbf|bahnhof|westf\.?|westfalen/gi,
      " ",
    )
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function routeContains(route: string[], station: string): boolean {
  const target = normalizeStation(station);
  if (!target) return false;

  return route.some((value) => {
    const normalized = normalizeStation(value);
    return (
      normalized === target ||
      normalized.includes(target) ||
      target.includes(normalized)
    );
  });
}

function categoryMatches(
  train: MobilithekTrainEvent,
  categories: string[],
): boolean {
  if (!categories.length) return true;

  const line = String(train.line || "").toUpperCase();
  const category = String(train.category || "").toUpperCase();

  return categories.some((wanted) => {
    const value = String(wanted || "").toUpperCase();

    return (
      category === value ||
      line === value ||
      line.includes(value) ||
      value.includes(line)
    );
  });
}

function callForStation(
  train: MobilithekTrainEvent,
  station: string,
) {
  const target = normalizeStation(station);

  return train.calls.find((call) => {
    const value = normalizeStation(call.name);

    return (
      value === target ||
      value.includes(target) ||
      target.includes(value)
    );
  });
}

export async function getDivertedTrains(
  crossing: Crossing,
): Promise<DivertedTrain[]> {
  if (!crossing.diversionRules?.length) {
    return [];
  }

  let events: MobilithekTrainEvent[];

  try {
    /*
     * Wichtig:
     * Umleitungen werden ebenfalls aus dem bereits aufgebauten
     * Mobilithek-Registry ermittelt.
     *
     * Kein zusätzlicher DB-Timetable-Request mehr.
     */
    events = await getMobilithekTrainRegistry();
  } catch (error) {
    console.warn(
      "getDivertedTrains: Mobilithek Registry nicht verfügbar",
      error,
    );

    return [];
  }

  const results: DivertedTrain[] = [];

  for (const rule of crossing.diversionRules) {
    for (const train of events) {
      if (!categoryMatches(train, rule.categories || [])) {
        continue;
      }

      /*
       * Der Zug muss alle definierten Anker passieren.
       * Beispiel Kirchlengern:
       * Osnabrück Hbf + Hannover Hbf
       */
      const hasAnchors = (rule.anchorRouteStops || []).every(
        (stop: string) => routeContains(train.route, stop),
      );

      if (!hasAnchors) {
        continue;
      }

      /*
       * Der entscheidende Umleitungsindikator:
       * Der normale Streckenhalt fehlt im aktuellen Laufweg.
       *
       * Beispiel:
       * Bielefeld -> Hannover
       * ohne Bünde/Kirchlengern
       */
      if (
        routeContains(
          train.route,
          rule.excludedRouteStop,
        )
      ) {
        continue;
      }

      const observationCall = callForStation(
        train,
        rule.observationStation,
      );

      const observationTime =
        observationCall?.actual ||
        observationCall?.planned ||
        train.actualTime;

      if (!observationTime) {
        continue;
      }

      /*
       * Nur relevante Zeitfenster berücksichtigen.
       * Der Status-Endpunkt arbeitet mit dem aktuellen Zeitraum.
       */
      const timestamp = observationTime.getTime();
      const now = Date.now();

      if (
        timestamp < now - 5 * 60_000 ||
        timestamp > now + 3 * 60 * 60_000
      ) {
        continue;
      }

      results.push({
        line: train.line,
        category: train.category,
        journeyNumber: train.journeyNumber,

        destination: train.destination,
        origin: train.origin,
        route: train.route,

        delayMinutes: train.delayMinutes,

        observationEva: rule.observationEva,
        observationStation: rule.observationStation,
        observationActualTime: observationTime.toISOString(),

        note:
          `Vermutlich umgeleitet über ${rule.observationStation} ` +
          `- kein Halt/Durchfahrt am Übergang zu erwarten.`,
      });
    }
  }

  /*
   * Derselbe Zug kann durch mehrere Regeln gefunden werden.
   */
  return Array.from(
    new Map(
      results.map((train) => [
        `${train.category}-${train.journeyNumber}`,
        train,
      ]),
    ).values(),
  );
}