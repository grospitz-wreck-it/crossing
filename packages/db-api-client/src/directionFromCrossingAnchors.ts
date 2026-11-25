import type { OpenBoardsStationObservation } from "./openBoardsNormalizer";

export type CrossingTravelDirection = "eastbound" | "westbound" | "unknown";

function normalizeStation(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\\u0300-\\u036f]/g, "")
    .replace(/\\([^)]*\\)/g, " ")
    .replace(/hauptbahnhof|hbf|bahnhof|westf\\.?|westfalen/gi, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function oppositeDirection(direction: "eastbound" | "westbound"): "eastbound" | "westbound" {
  return direction === "eastbound" ? "westbound" : "eastbound";
}

/**
 * Anchor directions describe travel from the crossing toward that station.
 * An anchor before the crossing in the ordered journey implies the opposite
 * direction. Missing or conflicting evidence remains unknown.
 */
export function directionFromCrossingAnchors(
  crossing: { eva?: string; name?: string; anchorStations?: any[] },
  routeEvas: string[],
  routeNames: string[],
): { direction: CrossingTravelDirection; source: "crossing-anchor-route-order" | "unknown" } {
  const route = routeNames.map(normalizeStation);
  const crossingEva = String(crossing.eva || "").trim();
  let crossingIndex = crossingEva ? routeEvas.indexOf(crossingEva) : -1;
  if (crossingIndex < 0) {
    const crossingName = normalizeStation(crossing.name);
    const matches = route.map((name, index) => ({ name, index }))
      .filter((entry) => entry.name && crossingName &&
        (entry.name === crossingName || entry.name.includes(crossingName) || crossingName.includes(entry.name)));
    if (matches.length === 1) crossingIndex = matches[0].index;
  }
  if (crossingIndex < 0) return { direction: "unknown", source: "unknown" };

  const anchors = (Array.isArray(crossing.anchorStations) ? crossing.anchorStations : [])
    .filter((anchor: any) => anchor && (anchor.direction === "eastbound" || anchor.direction === "westbound"))
    .flatMap((anchor: any) => {
      const eva = String(anchor.eva || "").trim();
      const stationName = normalizeStation(anchor.stationName);
      let index = eva ? routeEvas.indexOf(eva) : -1;
      if (index < 0 && stationName) {
        const matches = route.map((name, routeIndex) => ({ name, routeIndex }))
          .filter((entry) => entry.name && (entry.name === stationName ||
            entry.name.includes(stationName) || stationName.includes(entry.name)));
        if (matches.length === 1) index = matches[0].routeIndex;
      }
      if (index < 0 || index === crossingIndex) return [];
      return [{
        distance: Math.abs(index - crossingIndex),
        direction: index > crossingIndex ? anchor.direction : oppositeDirection(anchor.direction),
      }];
    })
    .sort((a: any, b: any) => a.distance - b.distance);

  if (!anchors.length) return { direction: "unknown", source: "unknown" };
  const nearest = anchors.filter((anchor: any) => anchor.distance === anchors[0].distance);
  const directions = [...new Set(nearest.map((anchor: any) => anchor.direction))];
  if (directions.length !== 1) return { direction: "unknown", source: "unknown" };
  return { direction: directions[0] as CrossingTravelDirection, source: "crossing-anchor-route-order" };
}
