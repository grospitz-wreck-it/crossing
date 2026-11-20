import { db } from "../../../lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseEvas(value: unknown): string[] {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? [...new Set(parsed.map((item) => String(item).trim()).filter(Boolean))] : [];
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  // Available only on Vercel Preview. Production stays hard-disabled.
  // This endpoint is read-only and remains behind the existing admin middleware.
  if (process.env.VERCEL_ENV !== "preview" || process.env.OPENBOARDS_APP_TEST_MODE === "false") {
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  const { searchParams } = new URL(request.url);
  const crossingId = String(searchParams.get("crossingId") || "").trim();

  try {
    // The diagnostic inventory must show every active crossing, not only
    // crossings currently assigned to a user. This is read-only.
    const crossingsResult = await db.execute({
      sql: `SELECT id, name, reference_stations
            FROM crossings
            WHERE status = 'active'
            ORDER BY name COLLATE NOCASE
            LIMIT 500`,
    });

    const baseCrossings = (crossingsResult.rows as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      name: String(row.name || row.id),
      evas: parseEvas(row.reference_stations),
    }));

    if (!crossingId) {
      const [queueInventoryResult, observationInventoryResult] = await Promise.all([
        db.execute({
          sql: `SELECT job_key, direction, eva_numbers_json, last_status
                FROM openboards_refresh_jobs
                WHERE is_active = 1`,
        }),
        db.execute({
          sql: `SELECT eva_number, COUNT(*) AS observation_count,
                       MAX(observed_at) AS latest_observed_at
                FROM openboards_observations
                WHERE expires_at > ?
                GROUP BY eva_number`,
          args: [new Date().toISOString()],
        }),
      ]);

      const activeJobs = (queueInventoryResult.rows as Array<Record<string, unknown>>).map((row) => ({
        direction: String(row.direction || ""),
        evas: parseEvas(row.eva_numbers_json),
        status: String(row.last_status || "waiting"),
      }));
      const observationsByEva = new Map(
        (observationInventoryResult.rows as Array<Record<string, unknown>>).map((row) => [
          String(row.eva_number || ""),
          { count: Number(row.observation_count || 0), latest: row.latest_observed_at == null ? null : String(row.latest_observed_at) },
        ]),
      );

      const crossings = baseCrossings.map((crossing) => {
        const stations = crossing.evas.map((eva) => {
          const jobs = activeJobs.filter((job) => job.evas.includes(eva));
          const observation = observationsByEva.get(eva);
          return {
            eva,
            arrivalsJob: jobs.some((job) => job.direction === "arrivals"),
            departuresJob: jobs.some((job) => job.direction === "departures"),
            jobCount: jobs.length,
            failedJobs: jobs.filter((job) => job.status === "error").length,
            observationCount: observation?.count || 0,
            latestObservedAt: observation?.latest || null,
          };
        });
        return {
          ...crossing,
          stationCount: crossing.evas.length,
          coveredStationCount: stations.filter((station) => station.arrivalsJob && station.departuresJob).length,
          stationsWithoutJobs: stations.filter((station) => station.jobCount === 0).length,
          stationsWithoutObservations: stations.filter((station) => station.observationCount === 0).length,
          stations,
        };
      });

      return Response.json({
        ok: true,
        crossings,
        inventory: {
          activeCrossings: crossings.length,
          crossingsWithoutEvas: crossings.filter((item) => item.evas.length === 0).length,
          crossingsWithEvas: crossings.filter((item) => item.evas.length > 0).length,
          activeQueueJobs: activeJobs.length,
          stationsWithObservations: observationsByEva.size,
        },
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const crossings = baseCrossings;

    const crossing = crossings.find((item) => item.id === crossingId);
    if (!crossing) {
      return Response.json({ ok: false, error: "Bahnübergang nicht gefunden oder nicht aktiv.", crossings }, {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (!crossing.evas.length) {
      return Response.json({ ok: true, crossing, observations: [], queue: [], warning: "Für diesen Übergang sind keine reference_stations hinterlegt." }, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    const placeholders = crossing.evas.map(() => "?").join(", ");
    const [observationsResult, queueResult] = await Promise.all([
      db.execute({
        sql: `SELECT observation_key, journey_id, eva_number, direction, event_time,
                     scheduled_time, time_type, line, category, journey_number,
                     origin_eva, destination_eva, route_names_json, platform,
                     cancelled, observed_at, expires_at
              FROM openboards_observations
              WHERE eva_number IN (${placeholders})
                AND expires_at > ?
              ORDER BY event_time ASC
              LIMIT 250`,
        args: [...crossing.evas, new Date().toISOString()],
      }),
      db.execute({
        sql: `SELECT job_key, direction, eva_numbers_json, interval_ms, priority,
                     next_due_at, last_started_at, last_finished_at, last_status,
                     consecutive_failures, last_error
              FROM openboards_refresh_jobs
              WHERE is_active = 1
              ORDER BY priority ASC, next_due_at ASC`,
      }),
    ]);

    const observations = (observationsResult.rows as Array<Record<string, unknown>>).map((row) => ({
      key: String(row.observation_key || ""),
      journeyId: String(row.journey_id || ""),
      eva: String(row.eva_number || ""),
      direction: String(row.direction || ""),
      eventTime: String(row.event_time || ""),
      scheduledTime: row.scheduled_time == null ? null : String(row.scheduled_time),
      timeType: String(row.time_type || "UNKNOWN"),
      line: String(row.line || ""),
      category: String(row.category || ""),
      journeyNumber: Number(row.journey_number || 0),
      originEva: row.origin_eva == null ? null : String(row.origin_eva),
      destinationEva: row.destination_eva == null ? null : String(row.destination_eva),
      routeNames: parseEvas(row.route_names_json),
      platform: row.platform == null ? null : String(row.platform),
      cancelled: Number(row.cancelled || 0) === 1,
      observedAt: String(row.observed_at || ""),
      expiresAt: String(row.expires_at || ""),
    }));

    const queue = (queueResult.rows as Array<Record<string, unknown>>)
      .filter((row) => parseEvas(row.eva_numbers_json).some((eva) => crossing.evas.includes(eva)))
      .map((row) => ({
        key: String(row.job_key || ""),
        direction: String(row.direction || ""),
        evas: parseEvas(row.eva_numbers_json),
        intervalMs: Number(row.interval_ms || 0),
        priority: Number(row.priority || 0),
        nextDueAt: String(row.next_due_at || ""),
        lastStartedAt: row.last_started_at == null ? null : String(row.last_started_at),
        lastFinishedAt: row.last_finished_at == null ? null : String(row.last_finished_at),
        lastStatus: row.last_status == null ? null : String(row.last_status),
        consecutiveFailures: Number(row.consecutive_failures || 0),
        lastError: row.last_error == null ? null : String(row.last_error),
      }));

    return Response.json({
      ok: true,
      crossing,
      queue,
      observations,
      summary: {
        observationCount: observations.length,
        arrivals: observations.filter((item) => item.direction === "arrivals").length,
        departures: observations.filter((item) => item.direction === "departures").length,
        latestObservedAt: observations.reduce<string | null>((latest, item) => !latest || item.observedAt > latest ? item.observedAt : latest, null),
        queueJobs: queue.length,
        failedJobs: queue.filter((item) => item.lastStatus === "error").length,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[OpenBoards test view]", error);
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "OpenBoards-Testdaten konnten nicht geladen werden.",
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
