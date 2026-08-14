import type { Crossing } from "../../crossing-model/src/types";
import { getStationTimetable } from "./getStationTimetable";

// Ein Zug, der planmäßig NICHT über den Übergang läuft, aber laut
// aktuellem (ggf. per fchg geändertem) Laufweg gerade doch dort
// durchfährt - z.B. weil er wegen einer Störung über die Kirchlengern-
// Strecke umgeleitet wurde. Anders als DivertedTrain wirkt sich das
// DIREKT auf die Schranke aus und muss in die Vorhersage einfließen.
export type ReroutedTrain = {
  line: string;
  category: string;
  journeyNumber: number;

  destination?: string;
  origin?: string;
  route: string[];

  delayMinutes: number;

  observationEva: string;
  observationStation: string;
  observationActualTime: string; // ISO

  fallbackOffsetSeconds: number;
  direction: "eastbound" | "westbound" | "unknown";

  crossingTime: string; // ISO
  note: string;
};

export async function getReroutedTrains(
  crossing: Crossing
): Promise<ReroutedTrain[]> {
  if (!crossing.rerouteWatchRules?.length) {
    return [];
  }

  const results: ReroutedTrain[] = [];

  for (const rule of crossing.rerouteWatchRules) {
    let events;

    try {
      events = await getStationTimetable(rule.observationEva);
    } catch (error) {
      console.error(
        `getReroutedTrains: Timetable für ${rule.observationStation} (${rule.observationEva}) fehlgeschlagen`,
        error
      );
      continue;
    }

    const rerouted = events.filter((train) => {
      if (train.cancelled) {
        return false;
      }

      if (!rule.categories.includes(train.category)) {
        return false;
      }

      // Das ist die einzig verlässliche Prüfung hier: läuft der
      // (ggf. geänderte) Laufweg dieses Zugs tatsächlich durch die
      // Übergangs-Station? Ob das "normal" ist oder nicht, spielt keine
      // Rolle - wenn ja, wird die Schranke betroffen sein.
      return rule.crossingRouteNames.some((name) =>
        train.route.includes(name)
      );
    });

    for (const train of rerouted) {
      const crossingTime = new Date(
        train.actualTime.getTime() +
          rule.fallbackOffsetSeconds * 1000
      );

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
        observationActualTime: train.actualTime.toISOString(),

        fallbackOffsetSeconds: rule.fallbackOffsetSeconds,
        direction: rule.direction,

        crossingTime: crossingTime.toISOString(),
        note: `Fährt aktuell abweichend vom Normalfall über ${crossing.name} (erkannt via ${rule.observationStation}) - vermutlich Umleitung.`,
      });
    }
  }

  return Array.from(
    new Map(
      results.map((train) => [
        `${train.category}-${train.journeyNumber}`,
        train,
      ])
    ).values()
  );
}
