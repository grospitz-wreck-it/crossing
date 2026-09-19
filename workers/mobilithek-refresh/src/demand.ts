import { getDb } from "./db.js";

type DemandRule = {
  observationStation?: string;
  categories?: string[];
  lineHints?: string[];
};

type DemandCrossing = {
  id: string;
  requiredRouteStops: string[];
  primaryObservationStations: string[];
  secondaryObservationStations: string[];
  secondaryCategories: string[];
  secondaryLineHints: string[];
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

async function loadStationNames(db: ReturnType<typeof getDb>, evas: string[]): Promise<Map<string, string>> {
  if (!evas.length) return new Map();

  const result = await db.execute({
    sql: "SELECT eva, name FROM railway_station_catalog WHERE eva IN (" +
      evas.map(() => "?").join(",") +
      ")",
    args: evas,
  });

  return new Map(
    (result.rows as any[])
      .map((row) => [String(row.eva || "").trim(), String(row.name || "").trim()] as const)
      .filter(([eva, name]) => Boolean(eva && name)),
  );
}

export async function loadDemandCrossings(): Promise<DemandCrossing[]> {
  const db = getDb();

  const result = await db.execute(`
    SELECT DISTINCT
      c.id,
      c.required_route_stops,
      c.observation_evas,
      c.context_evas,
      c.through_rules,
      c.diversion_rules,
      c.reroute_watch_rules,
      c.reference_stations
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
      rows.flatMap((row) => {
        const observationEvas = parseJson<string[]>(row.observation_evas, []).map(String);
        const referenceStations = parseJson<string[]>(row.reference_stations, [])
          .map(String)
          .map((value) => value.trim())
          .filter(Boolean);

        // reference_stations is the explicit primary declaration.
        // For legacy crossings without it, retain the old observation_evas as a
        // compatibility fallback instead of silently dropping demand.
        return referenceStations.length ? referenceStations : observationEvas;
      }),
    ),
  );

  const stationNames = await loadStationNames(db, allPrimaryEvas);

  return rows.map((row) => {
    const observationEvas = parseJson<string[]>(row.observation_evas, []).map(String);
    const referenceStations = parseJson<string[]>(row.reference_stations, [])
      .map(String)
      .map((value) => value.trim())
      .filter(Boolean);

    const primaryEvas = referenceStations.length ? referenceStations : observationEvas;
    const primaryObservationStations = Array.from(
      new Set(
        primaryEvas
          .map((eva) => stationNames.get(eva.trim()))
          .filter((value): value is string => Boolean(value)),
      ),
    );

    const secondaryRules = [
      ...collectRules(row.through_rules),
      ...collectRules(row.diversion_rules),
      ...collectRules(row.reroute_watch_rules),
    ];

    return {
      id: String(row.id),
      requiredRouteStops: parseJson<string[]>(row.required_route_stops, []).map(String),
      primaryObservationStations,
      secondaryObservationStations: Array.from(
        new Set(
          secondaryRules
            .map((rule) => rule.observationStation)
            .filter((value): value is string => Boolean(value)),
        ),
      ),
      secondaryCategories: Array.from(
        new Set(secondaryRules.flatMap((rule) => rule.categories || [])),
      ),
      secondaryLineHints: Array.from(
        new Set(secondaryRules.flatMap((rule) => rule.lineHints || [])),
      ),
    };
  });
}
