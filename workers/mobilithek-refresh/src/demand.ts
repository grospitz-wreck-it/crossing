import { getDb } from "./db.js";

type DemandRule = {
  observationStation?: string;
  categories?: string[];
};

type DemandCrossing = {
  id: string;
  requiredRouteStops: string[];
  categories: string[];
  observationStations: string[];
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
    }));
}

export async function loadDemandCrossings(): Promise<DemandCrossing[]> {
  const db = getDb();

  const result = await db.execute(`
    SELECT DISTINCT
      c.id,
      c.required_route_stops,
      c.through_rules,
      c.diversion_rules,
      c.reroute_watch_rules
    FROM crossings c
    INNER JOIN user_crossings uc ON uc.crossing_id = c.id
    WHERE c.status = 'active'
  `);

  return (result.rows as any[]).map((row) => {
    const rules = [
      ...collectRules(row.through_rules),
      ...collectRules(row.diversion_rules),
      ...collectRules(row.reroute_watch_rules),
    ];

    const categories = Array.from(
      new Set(rules.flatMap((rule) => rule.categories || [])),
    );

    const observationStations = Array.from(
      new Set(
        rules
          .map((rule) => rule.observationStation)
          .filter((value): value is string => !!value),
      ),
    );

    return {
      id: String(row.id),
      requiredRouteStops: parseJson<string[]>(row.required_route_stops, []).map(String),
      categories,
      observationStations,
    };
  });
}
