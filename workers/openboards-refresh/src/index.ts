import { createClient, type Client } from "@libsql/client/web";
import {
  fetchOpenBoardsForStations,
} from "../../../packages/db-api-client/src/openBoardsClient";
import { normalizeOpenBoardsBatches, type OpenBoardsStationObservation } from "../../../packages/db-api-client/src/openBoardsNormalizer";
import {
  buildOpenBoardsQueueJobs,
  type OpenBoardsQueueDemand,
} from "../../../packages/db-api-client/src/openBoardsScheduler";
import {
  claimNextOpenBoardsJob,
  finishOpenBoardsJob,
  reserveOpenBoardsRequestSlot,
  syncOpenBoardsQueue,
} from "../../../packages/db-api-client/src/openBoardsQueueStore";

export interface Env {
  TURSO_DATABASE_URL: string;
  TURSO_AUTH_TOKEN: string;
  DB_OPENBOARDS_CLIENT_ID: string;
  DB_OPENBOARDS_API_KEY: string;
  OPENBOARDS_RUN_TOKEN?: string;
  OPENBOARDS_BATCH_SIZE?: string;
  OPENBOARDS_MAX_JOBS_PER_RUN?: string;
  OPENBOARDS_CORE_INTERVAL_MS?: string;
  OPENBOARDS_EXPLORATORY_INTERVAL_MS?: string;
}

const OWL_STATIONS = [
  "kirchlengern", "herford", "buende", "bünde", "bielefeld", "loehne", "löhne",
  "bad oeynhausen", "minden", "porta westfalica", "vlotho", "hiddenhausen",
  "enger", "spenge", "roedinghausen", "rödinghausen", "guetersloh", "gütersloh",
  "huellhorst", "hüllhorst", "preussisch oldendorf", "preußisch oldendorf",
  "stemwede", "rahden", "espelkamp", "paderborn",
];

function normalizeName(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/hauptbahnhof|hbf|bahnhof/gi, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseArray(value: unknown): unknown[] {
  try {
    const parsed = value ? JSON.parse(String(value)) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isOwlStation(name: string): boolean {
  const normalized = normalizeName(name);
  return OWL_STATIONS.some((station) => {
    const wanted = normalizeName(station);
    return normalized === wanted || normalized.includes(wanted) || wanted.includes(normalized);
  });
}

let dbClient: Client | null = null;
let dbUrl = "";

function getDb(env: Env): Client {
  if (!env.TURSO_DATABASE_URL?.trim() || !env.TURSO_AUTH_TOKEN?.trim()) {
    throw new Error("TURSO_DATABASE_URL / TURSO_AUTH_TOKEN fehlen");
  }
  if (!dbClient || dbUrl !== env.TURSO_DATABASE_URL) {
    dbClient = createClient({
      url: env.TURSO_DATABASE_URL,
      authToken: env.TURSO_AUTH_TOKEN,
    });
    dbUrl = env.TURSO_DATABASE_URL;
  }
  return dbClient;
}

const DEMAND_CACHE_TTL_MS = 5 * 60_000;
let cachedDemand: OpenBoardsQueueDemand[] | null = null;
let cachedDemandAt = 0;
let cachedDemandDbUrl = "";
let demandCacheNeedsSync = true;

// Expired rows are housekeeping, not part of each board refresh. Keep the
// cleanup to at most once per warm isolate per hour instead of once per job.
const OBSERVATION_CLEANUP_INTERVAL_MS = 60 * 60_000;
let lastObservationCleanupAt = 0;

async function cleanupExpiredObservations(db: Client): Promise<void> {
  const now = Date.now();
  if (now - lastObservationCleanupAt < OBSERVATION_CLEANUP_INTERVAL_MS) return;

  await db.execute(
    "DELETE FROM openboards_observations WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
  );
  lastObservationCleanupAt = now;
}

async function loadDemand(
  db: Client,
  env: Env,
): Promise<OpenBoardsQueueDemand[]> {
  const now = Date.now();
  if (
    cachedDemand &&
    cachedDemandDbUrl === env.TURSO_DATABASE_URL &&
    now - cachedDemandAt < DEMAND_CACHE_TTL_MS
  ) {
    return cachedDemand.map((item) => ({ ...item, evaNumbers: [...item.evaNumbers] }));
  }

  const crossingsResult = await db.execute(`
    SELECT c.id, c.name, c.observation_evas, c.reference_stations, c.through_rules
    FROM crossings c
    WHERE c.status = 'active'
      AND (
        EXISTS (SELECT 1 FROM user_crossings uc WHERE uc.crossing_id = c.id)
        OR EXISTS (SELECT 1 FROM user_settings us WHERE us.default_crossing_id = c.id)
      )
  `);

  // Resolve the catalogue only when a legacy through-rule actually contains
  // station names. Most active crossings already persist observation EVAs,
  // so loading all 7k catalogue rows on every cold isolate is unnecessary.
  const configuredEvas = new Set<string>();
  const stationNames = new Set<string>();
  for (const row of crossingsResult.rows as Array<Record<string, unknown>>) {
    for (const value of [
      ...parseArray(row.observation_evas),
      ...parseArray(row.reference_stations),
    ]) {
      const eva = String(value || "").trim();
      if (eva) configuredEvas.add(eva);
    }

    for (const rule of parseArray(row.through_rules)) {
      if (!rule || typeof rule !== "object") continue;
      const record = rule as Record<string, unknown>;
      const ruleEva = String(record.observationEva || "").trim();
      if (ruleEva) configuredEvas.add(ruleEva);
      else {
        const name = String(record.observationStation || "").trim();
        if (name) stationNames.add(name);
      }
    }
  }

  const catalogResult = stationNames.size
    ? await db.execute("SELECT eva, name FROM railway_station_catalog")
    : configuredEvas.size
      ? await db.execute({
          sql: `SELECT eva, name FROM railway_station_catalog
                WHERE eva IN (${[...configuredEvas].map(() => "?").join(",")})`,
          args: [...configuredEvas],
        })
      : { rows: [] as Array<Record<string, unknown>> };

  if (stationNames.size) {
    console.info(`[STATION CATALOG] source=openboards-worker mode=full-scan rows=${catalogResult.rows.length}`);
  }
  const stationByName = new Map<string, { eva: string; name: string }>();
  const stationByEva = new Map<string, { eva: string; name: string }>();
  for (const row of catalogResult.rows as Array<Record<string, unknown>>) {
    const eva = String(row.eva || "").trim();
    const name = String(row.name || "").trim();
    if (!eva || !name) continue;
    const item = { eva, name };
    stationByEva.set(eva, item);
    stationByName.set(normalizeName(name), item);
  }

  const demandByCrossing = new Map<string, OpenBoardsQueueDemand>();
  const coreInterval = Math.max(15_000, Number(env.OPENBOARDS_CORE_INTERVAL_MS || 60_000));
  const exploratoryInterval = Math.max(60_000, Number(env.OPENBOARDS_EXPLORATORY_INTERVAL_MS || 300_000));

  for (const row of crossingsResult.rows as Array<Record<string, unknown>>) {
    const crossingId = String(row.id || "");
    const evas = new Set<string>();
    const stationNames: string[] = [];

    // Admin saves selected DB observation stations in observation_evas.
    // Keep reference_stations as a backwards-compatible legacy source.
    for (const value of [
      ...parseArray(row.observation_evas),
      ...parseArray(row.reference_stations),
    ]) {
      const eva = String(value || "").trim();
      if (eva) evas.add(eva);
    }

    for (const rule of parseArray(row.through_rules)) {
      if (!rule || typeof rule !== "object") continue;
      const record = rule as Record<string, unknown>;
      const ruleEva = String(record.observationEva || "").trim();
      if (ruleEva) evas.add(ruleEva);
      else {
        const name = String(record.observationStation || "").trim();
        if (name) stationNames.push(name);
      }
    }

    for (const name of stationNames) {
      const station = stationByName.get(normalizeName(name));
      if (station) evas.add(station.eva);
    }

    // Keep configured EVAs even if the optional station catalogue has no name for them.
    const stations = [...evas].map((eva) => stationByEva.get(eva) || { eva, name: eva });
    const isCore = isOwlStation(String(row.name || "")) || stations.some((station) => isOwlStation(station.name));
    demandByCrossing.set(crossingId, {
      crossingId,
      evaNumbers: stations.map((station) => station.eva),
      intervalMs: isCore ? coreInterval : exploratoryInterval,
      priority: isCore ? 10 : 100,
    });
  }

  const demand = [...demandByCrossing.values()]
    .filter((item) => item.evaNumbers.length > 0);

  cachedDemand = demand.map((item) => ({ ...item, evaNumbers: [...item.evaNumbers] }));
  cachedDemandAt = now;
  cachedDemandDbUrl = env.TURSO_DATABASE_URL;
  demandCacheNeedsSync = true;
  return demand;
}

async function persistObservations(
  db: Client,
  direction: "arrivals" | "departures",
  evas: string[],
  observations: OpenBoardsStationObservation[],
  observedAt: Date,
): Promise<void> {
  const observedIso = observedAt.toISOString();
  const validObservations = observations.filter((item) =>
    Number.isFinite(new Date(item.eventTime).getTime()),
  );
  const observationKeys = validObservations.map((item) =>
    [item.journeyId, item.evaNumber, item.direction].join("|"),
  );
  const statements: Array<{ sql: string; args: Array<string | number | null> }> = [
    {
      // Keep unchanged journeys in place. Only remove observations that were
      // absent from this successful board response; this avoids a full
      // delete-and-reinsert cycle for every refresh.
      sql: `DELETE FROM openboards_observations
            WHERE direction = ?
              AND eva_number IN (${evas.map(() => "?").join(",")})
              AND observation_key NOT IN (
                SELECT value FROM json_each(?)
              )`,
      args: [direction, ...evas, JSON.stringify(observationKeys)],
    },
  ];

  for (const item of validObservations) {
    const observationKey = [item.journeyId, item.evaNumber, item.direction].join("|");
    const eventTime = new Date(item.eventTime);
    const expiresAt = new Date(Math.max(eventTime.getTime() + 60 * 60_000, observedAt.getTime() + 30 * 60_000)).toISOString();
    statements.push({
      sql: `INSERT INTO openboards_observations (
        observation_key, journey_id, eva_number, direction, event_time,
        scheduled_time, time_type, line, category, journey_number,
        origin_eva, destination_eva, via_evas_json, route_evas_json,
        route_names_json, platform, cancelled, observed_at, expires_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(observation_key) DO UPDATE SET
        event_time = excluded.event_time,
        scheduled_time = excluded.scheduled_time,
        time_type = excluded.time_type,
        line = excluded.line,
        category = excluded.category,
        journey_number = excluded.journey_number,
        origin_eva = excluded.origin_eva,
        destination_eva = excluded.destination_eva,
        via_evas_json = excluded.via_evas_json,
        route_evas_json = excluded.route_evas_json,
        route_names_json = excluded.route_names_json,
        platform = excluded.platform,
        cancelled = excluded.cancelled,
        observed_at = excluded.observed_at,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
      WHERE openboards_observations.event_time IS NOT excluded.event_time
         OR openboards_observations.scheduled_time IS NOT excluded.scheduled_time
         OR openboards_observations.time_type IS NOT excluded.time_type
         OR openboards_observations.line IS NOT excluded.line
         OR openboards_observations.category IS NOT excluded.category
         OR openboards_observations.journey_number IS NOT excluded.journey_number
         OR openboards_observations.origin_eva IS NOT excluded.origin_eva
         OR openboards_observations.destination_eva IS NOT excluded.destination_eva
         OR openboards_observations.via_evas_json IS NOT excluded.via_evas_json
         OR openboards_observations.route_evas_json IS NOT excluded.route_evas_json
         OR openboards_observations.route_names_json IS NOT excluded.route_names_json
         OR openboards_observations.platform IS NOT excluded.platform
         OR openboards_observations.cancelled IS NOT excluded.cancelled
         OR julianday(excluded.observed_at) - julianday(openboards_observations.observed_at) >= (10.0 / 1440.0)`,
      args: [
        observationKey, item.journeyId, item.evaNumber, item.direction,
        eventTime.toISOString(), item.scheduledTime || null, item.timeType,
        item.line, item.category, item.journeyNumber, item.originEva || null,
        item.destinationEva || null, JSON.stringify(item.viaEvas),
        JSON.stringify(item.routeEvas), JSON.stringify(item.routeNames),
        item.platform || null, item.cancelled ? 1 : 0, observedIso, expiresAt, observedIso,
      ],
    });
  }

  await db.batch(statements, "write");
  // Successful run timestamps/counts live on the queue row. Keep the
  // append-only run log for failures only to avoid one permanent row per poll.
}

async function recordFailure(
  db: Client,
  jobKey: string,
  direction: "arrivals" | "departures",
  evas: string[],
  error: string,
  requestedAt: Date,
): Promise<void> {
  await db.execute({
    sql: `INSERT INTO openboards_refresh_runs
      (job_key, direction, eva_numbers_json, requested_at, completed_at, status, error)
      VALUES (?, ?, ?, ?, ?, 'error', ?)`,
    args: [jobKey, direction, JSON.stringify(evas), requestedAt.toISOString(), new Date().toISOString(), error.slice(0, 2000)],
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runRefresh(env: Env): Promise<Record<string, unknown>> {
  const db = getDb(env);
  const demand = await loadDemand(db, env);
  const batchSize = Math.max(1, Math.min(20, Number(env.OPENBOARDS_BATCH_SIZE || 5)));
  const jobs = buildOpenBoardsQueueJobs(demand, { batchSize });

  // Active crossing demand and the station catalogue are relatively static.
  // Reconcile the persistent queue only when the five-minute demand cache is
  // refreshed; keep the flag set if reconciliation fails so the next run retries.
  if (demandCacheNeedsSync) {
    await syncOpenBoardsQueue(db, jobs);
    demandCacheNeedsSync = false;
  }

  const maxJobs = Math.max(1, Math.min(20, Number(env.OPENBOARDS_MAX_JOBS_PER_RUN || 20)));
  let processed = 0;
  let observationsWritten = 0;
  const errors: string[] = [];

  while (processed < maxJobs) {
    const job = await claimNextOpenBoardsJob(db, crypto.randomUUID());
    if (!job) break;
    processed += 1;
    const requestedAt = new Date();

    try {
      if (!env.DB_OPENBOARDS_CLIENT_ID || !env.DB_OPENBOARDS_API_KEY) {
        throw new Error("DB_OPENBOARDS_CLIENT_ID / DB_OPENBOARDS_API_KEY fehlen");
      }

      const reservedAt = await reserveOpenBoardsRequestSlot(db, Date.now(), 150);
      const waitMs = Math.max(0, reservedAt - Date.now());
      if (waitMs > 0) await sleep(waitMs);

      const batches = await fetchOpenBoardsForStations(job.direction, job.evaNumbers, {
        batchSize: 20,
        maxViaStops: 10,
        maxEntriesPerTransportType: 40,
        credentials: {
          clientId: env.DB_OPENBOARDS_CLIENT_ID,
          apiKey: env.DB_OPENBOARDS_API_KEY,
        },
      });
      const observations = normalizeOpenBoardsBatches(batches);
      await persistObservations(db, job.direction, job.evaNumbers, observations, requestedAt);
      observationsWritten += observations.length;
      await finishOpenBoardsJob(db, job, { ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${job.jobKey}: ${message}`);
      try {
        await recordFailure(db, job.jobKey, job.direction, job.evaNumbers, message, requestedAt);
      } catch (logError) {
        console.error("[OpenBoards] failed to record error", logError);
      }
      await finishOpenBoardsJob(db, job, { ok: false, error: message });
    }
  }

  if (processed > 0) {
    try {
      await cleanupExpiredObservations(db);
    } catch (error) {
      // Housekeeping must not turn otherwise successful refreshes into failures.
      console.error("[OpenBoards] expired-observation cleanup failed", error);
    }
  }

  return {
    status: errors.length ? "partial" : "success",
    demandedCrossings: demand.length,
    queueJobs: jobs.length,
    processedJobs: processed,
    observationsWritten,
    errors,
    mode: "shadow-only",
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "openboards-refresh", mode: "shadow-only" });
    }
    if (url.pathname === "/run") {
      const token = env.OPENBOARDS_RUN_TOKEN?.trim();
      if (!token || request.headers.get("authorization") !== `Bearer ${token}`) {
        return new Response("Not found", { status: 404 });
      }
      try {
        return Response.json(await runRefresh(env));
      } catch (error) {
        return Response.json(
          { status: "error", error: error instanceof Error ? error.message : String(error) },
          { status: 500 },
        );
      }
    }
    return new Response("OpenBoards refresh worker (shadow-only)", { status: 200 });
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Berlin",
        hour: "2-digit",
        hourCycle: "h23",
      }).format(new Date()),
    );

    if (hour < 8 || hour >= 23) {
      return;
    }

    const result = await runRefresh(env);
    console.log("[OpenBoards] refresh result", result);
  },
} satisfies ExportedHandler<Env>;
