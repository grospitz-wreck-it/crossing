import type { MobilithekTrainEvent } from "./mobilithekTimetable";

export type JourneyMatch = {
  train: MobilithekTrainEvent;
  anchorIndexes: number[];
  confidence: number;
};

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

export function matchJourneyToRoute(
  train: MobilithekTrainEvent,
  requiredRouteStops: string[],
): JourneyMatch | null {
  if (!requiredRouteStops.length || !train.route.length) return null;

  const indexes: number[] = [];
  let previous = -1;

  for (const stop of requiredRouteStops) {
    const needle = normalize(stop);
    if (!needle) return null;

    const index = train.route.findIndex((candidate, candidateIndex) => {
      if (candidateIndex <= previous) return false;
      const value = normalize(candidate);
      return value === needle || value.includes(needle) || needle.includes(value);
    });

    if (index < 0) return null;
    indexes.push(index);
    previous = index;
  }

  return {
    train,
    anchorIndexes: indexes,
    confidence: Math.min(
      1,
      0.5 + indexes.length / Math.max(requiredRouteStops.length, 1) * 0.5,
    ),
  };
}

export function filterJourneysForRoute(
  trains: MobilithekTrainEvent[],
  requiredRouteStops: string[],
): JourneyMatch[] {
  return trains
    .map((train) => matchJourneyToRoute(train, requiredRouteStops))
    .filter((match): match is JourneyMatch => Boolean(match));
}
