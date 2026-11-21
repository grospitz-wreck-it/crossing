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

async function loadStationNames(
  db: ReturnType<typeof getDb>,
  evas: string[],
): Promise<Map<string, string>> {
  if (!evas.length) return new Map();

  const result = await db.execute({
    sql:
      "SELECT eva, name FROM railway_station_catalog WHERE eva IN (" +
      evas.map(() => "?").join(",") +
      ")",
    args: evas,
  });

  return new Map(
    (result.rows as any[])
      .map((row) => [
        String(row.eva || "").trim(),
        String(row.name || "").trim(),
      ] as const)
      .filter(([eva, name]) => Boolean(eva && name)),
  );
}

export async function loadDemandCrossings(): Promise<DemandCrossing[]> {
  const db = getDb();

  const result = await db.execute(`
    SELECT DISTINCT
      c.id,
      c.required_route_stops,
      c.reference_stations,
      c.through_rules
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

  const rows = result.rows as any[];

  const allPrimaryEvas = Array.from(
    new Set(
      rows.flatMap((row) =>
        parseJson<string[]>(row.reference_stations, [])
          .map(String)
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ),
  );

  const stationNames = await loadStationNames(db, allPrimaryEvas);

  return rows.map((row) => {
    const primaryObservationEvas = Array.from(
      new Set(
        parseJson<string[]>(row.reference_stations, [])
          .map(String)
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    );

    const primaryObservationStations = Array.from(
      new Set(
        primaryObservationEvas
          .map((eva) => stationNames.get(eva))
          .filter((value): value is string => Boolean(value)),
      ),
    );

    // Only regular through-rules are active secondary demand for now.
    // Diversion and reroute rules remain conditional and must not create
    // permanent demand before an actual diversion state is detected.
    const secondaryRules = collectThroughRules(row.through_rules);

    return {
      id: String(row.id),
      requiredRouteStops: parseJson<string[]>(row.required_route_stops, []).map(String),
      primaryObservationEvas,
      primaryObservationStations,
      secondaryRules,
    };
  });
}
