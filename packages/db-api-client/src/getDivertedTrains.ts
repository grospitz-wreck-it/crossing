import type { Crossing } from "../../crossing-model/src/types";
import { getStationTimetable } from "./getStationTimetable";

// Ein Zug, der eigentlich zur "Kirchlengern-Linie" gehört, aber laut
// aktuellem (ggf. per fchg geändertem) Laufweg gerade NICHT über den
// Übergang läuft - z.B. wegen einer Umleitung über Bielefeld Hbf.
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
  observationActualTime: string; // ISO

  note: string;
};

// Der Status-Endpunkt zeigt nur die nächsten 30 Minuten. Ein einstündiges
// Timetable-Fenster reicht dafür aus und sorgt dafür, dass diversionRules
// denselben In-Memory-/Turso-Cache wie throughRules verwenden können.
const DIVERSION_TIMETABLE_HOURS = 1;

export async function getDivertedTrains(
  crossing: Crossing
): Promise<DivertedTrain[]> {
  if (!crossing.diversionRules?.length) {
    return [];
  }

  const results: DivertedTrain[] = [];

  for (const rule of crossing.diversionRules) {
    let events;

    try {
      events = await getStationTimetable(
        rule.observationEva,
        DIVERSION_TIMETABLE_HOURS
      );
    } catch (error) {
      console.error(
        `getDivertedTrains: Timetable für ${rule.observationStation} (${rule.observationEva}) fehlgeschlagen`,
        error
      );
      continue;
    }

    const diverted = events.filter((train) => {
      if (train.cancelled) {
        return false;
      }

      if (!rule.categories.includes(train.category)) {
        return false;
      }

      const hasAnchors = rule.anchorRouteStops.every((stop) =>
        train.route.includes(stop)
      );

      if (!hasAnchors) {
        return false;
      }

      // Genau das ist das Umleitungs-Indiz: die Station, die auf der
      // Stammstrecke (über Kirchlengern) normalerweise im Laufweg stünde,
      // fehlt - der Zug ist also gerade nicht auf der Stammstrecke.
      return !train.route.includes(rule.excludedRouteStop);
    });

    for (const train of diverted) {
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

        note: `Vermutlich umgeleitet über ${rule.observationStation} - kein Halt/Durchfahrt am Übergang zu erwarten.`,
      });
    }
  }

  // Dedupe über category+journeyNumber, falls mehrere diversionRules
  // denselben Zug fänden.
  return Array.from(
    new Map(
      results.map((train) => [
        `${train.category}-${train.journeyNumber}`,
        train,
      ])
    ).values()
  );
}
