import type { Crossing } from "../../crossing-model/src/types";
import { getStationTimetable } from "./getStationTimetable";

// Zug, der den Bahnübergang ohne eigenen Halt durchfährt (z.B. ICE
// Amsterdam <-> Berlin). Da uns nur die offizielle Timetables-API zur
// Verfügung steht (keine Live-GPS-Position), wird die Durchfahrtszeit am
// Übergang ausschließlich über einen festen Zeitoffset ("Fahrplan-Fallback")
// von einer entfernten Beobachtungsstation abgeleitet - siehe README.
export type ThroughTrain = {
  type: "through";

  line: string;
  category: string;
  journeyNumber: number;

  destination?: string;
  origin?: string;
  route: string[];

  delayMinutes: number;

  observationEva: string;
  observationStation: string;
  observationActualTime: string; // ISO - tatsächliche (verspätete) Zeit an der Beobachtungsstation

  fallbackOffsetSeconds: number;
  trackDistanceMeters: number;

  direction: "eastbound" | "westbound";

  // Geschätzte Durchfahrtszeit am Übergang = observationActualTime + fallbackOffsetSeconds.
  crossingTime: string; // ISO
};

export async function getThroughTrains(
  crossing: Crossing
): Promise<ThroughTrain[]> {
  if (!crossing.throughRules?.length) {
    return [];
  }

  const candidates: ThroughTrain[] = [];

  // Reihenfolge der throughRules ist bewusst relevant: steht derselbe Zug
  // an mehreren Beobachtungsstationen (z.B. Osnabrück UND Bünde), gewinnt
  // unten die zuletzt verarbeitete Regel. Näher am Übergang liegende
  // Stationen sollten daher in crossings.ts als letztes stehen, damit ihre
  // genauere (weil zeitnähere) Schätzung die einer weiter entfernten
  // Station überschreibt.
  for (const rule of crossing.throughRules) {
    let events;

    try {
      events = await getStationTimetable(rule.observationEva);
    } catch (error) {
      console.error(
        `getThroughTrains: Timetable für ${rule.observationStation} (${rule.observationEva}) fehlgeschlagen`,
        error
      );
      continue;
    }

    const matching = events.filter((train) => {
      if (train.cancelled) {
        return false;
      }

      if (!rule.categories.includes(train.category)) {
        return false;
      }

      // Zug muss alle Pflicht-Stationen der Linie im Laufweg haben, damit
      // wir keine falschen Züge (z.B. andere ICE-Linien) erwischen.
      const hasRequiredRoute = crossing.requiredRouteStops.every(
        (requiredStop) => train.route.includes(requiredStop)
      );

      if (!hasRequiredRoute) {
        return false;
      }

      if (
        rule.direction === "westbound" &&
        train.destination !== "Amsterdam Centraal"
      ) {
        return false;
      }

      if (
        rule.direction === "eastbound" &&
        train.destination !== "Berlin Südkreuz"
      ) {
        return false;
      }

      return true;
    });

    for (const train of matching) {
      const crossingTime = new Date(
        train.actualTime.getTime() +
          rule.fallbackOffsetSeconds * 1000
      );

      candidates.push({
        type: "through",

        line: train.line,
        category: train.category,
        journeyNumber: train.journeyNumber,

        destination: train.destination,
        origin: train.origin,
        route: train.route,

        delayMinutes: train.delayMinutes,

        observationEva: rule.observationEva,
        observationStation: rule.observationStation,
        observationActualTime: train.actualTime.toISOString(),

        fallbackOffsetSeconds: rule.fallbackOffsetSeconds,
        trackDistanceMeters: rule.trackDistanceMeters,

        direction: rule.direction,

        crossingTime: crossingTime.toISOString(),
      });
    }
  }

  // Dedupe über category+journeyNumber. Map.set() mit demselben Key
  // überschreibt den vorherigen Eintrag -> siehe Kommentar oben zur
  // Reihenfolge der throughRules.
  const unique = Array.from(
    new Map(
      candidates.map((train) => [
        `${train.category}-${train.journeyNumber}`,
        train,
      ])
    ).values()
  );

  return unique;
}
