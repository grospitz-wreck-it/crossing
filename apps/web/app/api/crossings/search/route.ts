import { NextResponse } from "next/server";
import { db } from "../../../lib/db";

export const dynamic = "force-dynamic";

const TABLE_CACHE_TTL = 5 * 60 * 1000;
const LIST_CACHE_TTL = 5 * 60 * 1000;
const SEARCH_CACHE_TTL = 30 * 1000;

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

let crossingLocationsReadyCache:
  | CacheEntry<boolean>
  | null = null;

let statesCache:
  | CacheEntry<string[]>
  | null = null;

const citiesCache = new Map<
  string,
  CacheEntry<string[]>
>();

const crossingsCache = new Map<
  string,
  CacheEntry<unknown[]>
>();

function normalize(value: string | null) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("de-DE");
}

function getCached<T>(
  entry: CacheEntry<T> | null,
): T | null {
  if (!entry) return null;

  if (Date.now() >= entry.expiresAt) {
    return null;
  }

  return entry.value;
}

function setCached<T>(
  value: T,
  ttl: number,
): CacheEntry<T> {
  return {
    value,
    expiresAt: Date.now() + ttl,
  };
}

async function hasCrossingLocationsTable() {
  const cached = getCached(
    crossingLocationsReadyCache,
  );

  if (cached !== null) {
    return cached;
  }

  const result = await db.execute(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name = 'crossing_locations'
    LIMIT 1
  `);

  const ready = result.rows.length > 0;

  crossingLocationsReadyCache = setCached(
    ready,
    TABLE_CACHE_TTL,
  );

  return ready;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const state =
    searchParams.get("state")?.trim() ?? "";

  const city =
    searchParams.get("city")?.trim() ?? "";

  const q =
    searchParams.get("q")?.trim() ?? "";

  try {
    /*
     * Phase 1:
     * crossing_locations wird erst nach dem
     * Turso-Reset angelegt/befüllt.
     *
     * Der Table-Existence-Check wird im Memory
     * gecacht, damit nicht jeder Request sqlite_master
     * abfragen muss.
     */
    const ready =
      await hasCrossingLocationsTable();

    if (!ready) {
      return NextResponse.json({
        states: [],
        cities: [],
        crossings: [],
        ready: false,
      });
    }

    /*
     * 1. Bundesländer
     */
    if (!state && !city && !q) {
      const cachedStates =
        getCached(statesCache);

      if (cachedStates !== null) {
        return NextResponse.json({
          states: cachedStates,
          cities: [],
          crossings: [],
          ready: true,
        });
      }

      const statesResult = await db.execute(`
        SELECT DISTINCT state
        FROM crossing_locations
        ORDER BY state COLLATE NOCASE
      `);

      const states =
        statesResult.rows.map((row) =>
          String(row.state),
        );

      statesCache = setCached(
        states,
        LIST_CACHE_TTL,
      );

      return NextResponse.json({
        states,
        cities: [],
        crossings: [],
        ready: true,
      });
    }

    /*
     * 2. Städte für ein Bundesland
     */
    if (state && !city && !q) {
      const cacheKey = normalize(state);

      const cachedCities =
        citiesCache.get(cacheKey);

      const cities =
        getCached(cachedCities ?? null);

      if (cities !== null) {
        return NextResponse.json({
          states: [],
          cities,
          crossings: [],
          ready: true,
        });
      }

      const citiesResult = await db.execute({
        sql: `
          SELECT DISTINCT city
          FROM crossing_locations
          WHERE state = ?
          ORDER BY city COLLATE NOCASE
          LIMIT 500
        `,
        args: [state],
      });

      const result =
        citiesResult.rows.map((row) =>
          String(row.city),
        );

      citiesCache.set(
        cacheKey,
        setCached(
          result,
          LIST_CACHE_TTL,
        ),
      );

      return NextResponse.json({
        states: [],
        cities: result,
        crossings: [],
        ready: true,
      });
    }

    /*
     * 3. Konkrete BÜ-Suche
     */
    const cacheKey = JSON.stringify({
      state,
      city,
      q: normalize(q),
    });

    const cachedCrossings =
      crossingsCache.get(cacheKey);

    const cached =
      getCached(cachedCrossings ?? null);

    if (cached !== null) {
      return NextResponse.json({
        states: [],
        cities: [],
        crossings: cached,
        ready: true,
      });
    }

    const conditions: string[] = [];
    const args: string[] = [];

    if (state) {
      conditions.push("cl.state = ?");
      args.push(state);
    }

    if (city) {
      conditions.push("cl.city = ?");
      args.push(city);
    }

    if (q) {
      conditions.push(`
        (
          LOWER(cl.city) LIKE ?
          OR LOWER(c.name) LIKE ?
        )
      `);

      const pattern =
        `%${normalize(q)}%`;

      args.push(pattern, pattern);
    }

    const where = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const result = await db.execute({
      sql: `
        SELECT
          c.id,
          c.name,
          c.lat,
          c.lon,
          cl.state,
          cl.city,
          cl.postal_code
        FROM crossing_locations cl
        INNER JOIN crossings c
          ON c.id = cl.crossing_id
        ${where}
        ORDER BY
          cl.city COLLATE NOCASE,
          c.name COLLATE NOCASE
        LIMIT 100
      `,
      args,
    });

    const crossings =
      result.rows as unknown[];

    crossingsCache.set(
      cacheKey,
      setCached(
        crossings,
        SEARCH_CACHE_TTL,
      ),
    );

    return NextResponse.json({
      states: [],
      cities: [],
      crossings,
      ready: true,
    });
  } catch (error) {
    console.error(
      "Crossing search failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Crossing-Suche momentan nicht verfügbar.",
      },
      { status: 500 },
    );
  }
}
