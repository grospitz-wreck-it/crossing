import type { MobilithekTrainEvent } from "./mobilithekTimetable";

export type RailCorridor = {
  id: string;
  lines: string[];
  markers: string[];
  crossingMarker: string;
};

export const RAIL_CORRIDORS: RailCorridor[] = [
  {
    id: "kirchlengern-01",
    lines: ["RB61", "RB71", "RE60", "RE62", "ICE", "IC", "EC"],
    markers: [
      "Osnabrück Hbf",
      "Melle",
      "Bünde (Westf)",
      "Kirchlengern",
      "Löhne (Westf)",
      "Bad Oeynhausen",
      "Minden (Westf)",
      "Herford",
      "Bielefeld Hbf",
    ],
    crossingMarker: "Kirchlengern",
  },
];

export function getRailCorridor(crossingId: string): RailCorridor | null {
  if (crossingId !== "kirchlengern-bahnhof-lubbecker-str-b8095d49") return null;
  return RAIL_CORRIDORS.find((corridor) => corridor.id === "kirchlengern-01") ?? null;
}

function normalize(value: string): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/hauptbahnhof|hbf|bahnhof|westf\.?|westfalen/gi, " ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function routeIndex(route: string[], marker: string): number {
  const target = normalize(marker);
  if (!target) return -1;
  return route.findIndex((value) => {
    const candidate = normalize(value);
    return candidate === target || candidate.includes(target) || target.includes(candidate);
  });
}

function normalizedLine(value: string): string {
  return String(value || "").toUpperCase().replace(/[\s-]+/g, "");
}

export function matchesRailCorridor(
  train: Pick<MobilithekTrainEvent, "line" | "category" | "route" | "origin" | "destination">,
  corridor: RailCorridor,
): boolean {
  const line = normalizedLine(train.line);
  const category = normalizedLine(train.category);
  const lineMatch = corridor.lines.some((candidate) => {
    const wanted = normalizedLine(candidate);
    return line === wanted || line.includes(wanted) || category === wanted || category.includes(wanted);
  });
  if (!lineMatch) return false;

  const crossingIndex = corridor.markers.findIndex(
    (marker) => normalize(marker) === normalize(corridor.crossingMarker),
  );
  if (crossingIndex < 1 || crossingIndex >= corridor.markers.length - 1) return false;

  const before = corridor.markers.slice(0, crossingIndex);
  const after = corridor.markers.slice(crossingIndex + 1);
  const beforeIndexes = before.map((marker) => routeIndex(train.route, marker)).filter((index) => index >= 0);
  const afterIndexes = after.map((marker) => routeIndex(train.route, marker)).filter((index) => index >= 0);

  if (beforeIndexes.some((beforeIndex) => afterIndexes.some((afterIndex) => beforeIndex < afterIndex))) return true;

  const origin = normalize(train.origin || "");
  const destination = normalize(train.destination || "");
  const originBefore = before.some((marker) => normalize(marker) === origin);
  const originAfter = after.some((marker) => normalize(marker) === origin);
  const destinationBefore = before.some((marker) => normalize(marker) === destination);
  const destinationAfter = after.some((marker) => normalize(marker) === destination);

  return (originBefore || destinationBefore) && (originAfter || destinationAfter);
}
