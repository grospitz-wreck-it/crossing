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

async function loadDemand(db: Client, env: Env): Promise<OpenBoardsQueueDemand[]> {
  const [crossingsResult, catalogResult] = await Promise.all([
    db.execute(`
      SELECT c.id, c.reference_stations, c.through_rules
      FROM crossings c
      WHERE c.status = 'active'
        AND (
          EXISTS (SELECT 1 FROM user_crossings uc WHERE uc.crossing_id = c.id)
          OR EXISTS (SELECT 1 FROM user_settings us WHERE us.default_crossing_id = c.id)
        )
    `),
    db.execute("SELECT eva, name FROM railway_station_catalog"),
  ]);

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

    for (const value of parseArray(row.reference_stations)) {
      const eva = String(value || "").trim();
      if (eva) evas.add(eva);
    }

    for (const rule of parseArray(row.through_rules)) {
      if (!rule || typeof rule !== "object") continue;
      const record = rule as Record<string, unknown>;
      const name = String(record.observationStation || "").trim();
      if (name) stationNames.push(name);
    }

    for (const name of stationNames) {
      const station = stationByName.get(normalizeName(name));
      if (station) evas.add(station.eva);
    }

    // Keep configured EVAs even if the optional station catalogue has no name for them.
    const stations = [...evas].map((eva) => stationByEva.get(eva) || { eva, name: eva });
    const isCore = stations.some((station) => isOwlStation(station.name));
    demandByCrossing.set(crossingId, {
      crossingId,
      evaNumbers: stations.map((station) => station.eva),
      intervalMs: isCore ? coreInterval : exploratoryInterval,
      priority: isCore ? 10 : 100,
    });
  }

  return [...demandByCrossing.values()].filter((item) => item.evaNumbers.length > 0);
}

async function persistObservations(
  db: Client,
  jobKey: string,
  direction: "arrivals" | "departures",
  evas: string[],
  observations: OpenBoardsStationObservation[],
  observedAt: Date,
): Promise<void> {
  const observedIso = observedAt.toISOString();
  const statements: Array<{ sql: string; args: Array<string | number | null> }> = [
    {
      sql: `DELETE FROM openboards_observations
            WHERE direction = ?
              AND eva_number IN (${evas.map(() => "?").join(",")})`,
      args: [direction, ...evas],
    },
  ];

  for (const item of observations) {
    const observationKey = [item.journeyId, item.evaNumber, item.direction].join("|");
    const eventTime = new Date(item.eventTime);
    if (!Number.isFinite(eventTime.getTime())) continue;
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
        updated_at = excluded.updated_at`,
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
  await db.execute({
    sql: `INSERT INTO openboards_refresh_runs
      (job_key, direction, eva_numbers_json, requested_at, completed_at, status, observation_count)
      VALUES (?, ?, ?, ?, ?, 'success', ?)`,
    args: [jobKey, direction, JSON.stringify(evas), observedIso, new Date().toISOString(), observations.length],
  });
  await db.execute("DELETE FROM openboards_observations WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");
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
  await syncOpenBoardsQueue(db, jobs);

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
      await persistObservations(db, job.jobKey, job.direction, job.evaNumbers, observations, requestedAt);
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
    const result = await runRefresh(env);
    console.log("[OpenBoards] refresh result", result);
  },
} satisfies ExportedHandler<Env>;
