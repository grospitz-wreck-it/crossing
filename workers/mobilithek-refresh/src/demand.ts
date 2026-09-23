import { getDb } from "./db.js";

type DemandRule = {
  observationStation?: string;
  categories?: string[];
  lineHints?: string[];
};

export type SecondaryRuleGroup = {
  kind: "through" | "diversion";
  observationStations: string[];
  categories?: string[];
  lineHints?: string[];
  anchorRouteStops?: string[];
  excludedRouteStop?: string;
};

type DemandCrossing = {
  id: string;
  requiredRouteStops: string[];
  categories: string[];
  observationStations: string[];
  primaryObservationEvas: string[];
  primaryObservationStations: string[];
  secondaryRules: SecondaryRuleGroup[];
};

function parseJson<T>(value: unknown, fallback: T): T {
  try {
    return value ? (JSON.parse(String(value)) as T) : fallback;
  } catch {
    return fallback;
  }
}

function collectRules(value: unknown): DemandRule[] {
  return parseJson<unknown[]>(value, [])
    .filter((rule): rule is Record<string, unknown> => !!rule && typeof rule === "object")
    .map((rule) => ({
      observationStation: String(rule.observationStation || "").trim() || undefined,
      categories: Array.isArray(rule.categories)
        ? rule.categories.map(String).map((item) => item.trim()).filter(Boolean)
        : [],
      lineHints: Array.isArray(rule.lineHints)
        ? rule.lineHints.map(String).map((item) => item.trim()).filter(Boolean)
        : [],
    }));
}

function collectThroughRules(value: unknown): SecondaryRuleGroup[] {
  return collectRules(value)
    .filter((rule) => Boolean(rule.observationStation))
    .map((rule) => ({
      kind: "through" as const,
      observationStations: [rule.observationStation!],
      categories: rule.categories || [],
      lineHints: rule.lineHints || [],
    }));
}

export async function loadDemandCrossings(): Promise<DemandCrossing[]> {
  const db = getDb();

  const result = await db.execute(`
    SELECT DISTINCT
      c.id,
      c.required_route_stops,
      c.reference_stations,
      c.through_rules,
      c.diversion_rules,
      c.reroute_watch_rules
    FROM crossings c
    WHERE c.status = 'active'
      AND (
        EXISTS (
          SELECT 1
          FROM user_crossings uc
          WHERE uc.crossing_id = c.id
        )
        OR EXISTS (
          SELECT 1
          FROM user_settings us
          WHERE us.default_crossing_id = c.id
        )
      )
  `);

  const catalog = await db.execute(`SELECT eva, name FROM railway_station_catalog`);
  const stationNamesByEva = new Map<string, string>();
  for (const station of catalog.rows as any[]) {
    const eva = String(station.eva || "").trim();
    const name = String(station.name || "").trim();
    if (eva && name) stationNamesByEva.set(eva, name);
  }

  return (result.rows as any[]).map((row) => {
    const primaryObservationEvas = Array.from(
      new Set(
        parseJson<string[]>(row.reference_stations, [])
          .map(String)
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    );

    const primaryObservationStations = primaryObservationEvas
      .map((eva) => stationNamesByEva.get(eva))
      .filter((value): value is string => Boolean(value));

    // Secondary demand is intentionally limited to regular through-rules for
    // now. Diversion/reroute rules are retained in the database but are not
    // treated as permanently active demand until a real diversion state can
    // be detected. This avoids turning conditional rules into false positives.
    const secondaryRules = collectThroughRules(row.through_rules);

    const categories = Array.from(
      new Set(secondaryRules.flatMap((rule) => rule.categories || [])),
    );

    const observationStations = Array.from(
      new Set(
        secondaryRules.flatMap((rule) => rule.observationStations),
      ),
    );

    return {
      id: String(row.id),
      requiredRouteStops: parseJson<string[]>(row.required_route_stops, []).map(String),
      categories,
      observationStations,
      primaryObservationEvas,
      primaryObservationStations,
      secondaryRules,
    };
  });
}
