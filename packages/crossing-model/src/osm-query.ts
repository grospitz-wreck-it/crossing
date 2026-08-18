export type OSMLevelCrossing = {
  nodeId: string;
  lat: number;
  lon: number;
  tags: Record<string, string>;
};

export type OSMRailwayWay = {
  wayId: string;
  tags: Record<string, string>;
  nodes: Array<{ id: string; lat: number; lon: number }>;
};

export type OSMCrossingCandidate = {
  crossing: OSMLevelCrossing;
  railwayWays: OSMRailwayWay[];
  distanceMeters: number;
};

export function buildLevelCrossingOverpassQuery(
  lat: number,
  lon: number,
  radiusMeters = 500,
) {
  const safeRadius = Math.max(50, Math.min(radiusMeters, 5000));
  return `[out:json][timeout:25];\n(\n  node(around:${safeRadius},${lat},${lon})[railway=level_crossing];\n  node(around:${safeRadius},${lat},${lon})[railway=crossing];\n);\nout body;\n>;\nout skel qt;`;
}

export function buildRailwayWaysQuery(lat: number, lon: number, radiusMeters = 150) {
  const safeRadius = Math.max(50, Math.min(radiusMeters, 1000));
  return `[out:json][timeout:25];\nway(around:${safeRadius},${lat},${lon})[railway~"^(rail|light_rail|narrow_gauge)$"];\nout body geom;`;
}
