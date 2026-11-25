import { db } from "@/app/lib/db";

const asNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export async function GET() {
  try {
    const [jobsResult, observationsResult] = await Promise.all([
      db.execute(`
        SELECT
          COUNT(*) AS total_jobs,
          SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_jobs,
          SUM(CASE WHEN is_active = 1 AND last_status = 'error' THEN 1 ELSE 0 END) AS failed_jobs,
          MAX(CASE WHEN last_status = 'success' THEN last_finished_at END) AS last_success_at
        FROM openboards_refresh_jobs
      `),
      db.execute(`
        SELECT
          COUNT(*) AS observations_24h,
          COUNT(DISTINCT eva_number) AS stations_24h,
          MAX(observed_at) AS last_observed_at
        FROM openboards_observations
        WHERE datetime(observed_at) >= datetime('now', '-24 hours')
      `),
    ]);

    const jobs = (jobsResult.rows[0] ?? {}) as Record<string, unknown>;
    const observations = (observationsResult.rows[0] ?? {}) as Record<string, unknown>;
    const configured = Boolean(
      process.env.DB_OPENBOARDS_CLIENT_ID || process.env.DB_CLIENT_ID
    ) && Boolean(
      process.env.DB_OPENBOARDS_API_KEY || process.env.DB_API_KEY
    );

    return Response.json({
      configured,
      totalJobs: asNumber(jobs.total_jobs),
      activeJobs: asNumber(jobs.active_jobs),
      failedJobs: asNumber(jobs.failed_jobs),
      observations24h: asNumber(observations.observations_24h),
      stations24h: asNumber(observations.stations_24h),
      lastObservedAt: observations.last_observed_at ? String(observations.last_observed_at) : null,
      lastSuccessAt: jobs.last_success_at ? String(jobs.last_success_at) : null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Failed to load OpenBoards health:", error);
    return Response.json({
      configured: Boolean(process.env.DB_OPENBOARDS_CLIENT_ID || process.env.DB_CLIENT_ID)
        && Boolean(process.env.DB_OPENBOARDS_API_KEY || process.env.DB_API_KEY),
      activeJobs: 0,
      totalJobs: 0,
      failedJobs: 0,
      observations24h: 0,
      stations24h: 0,
      lastObservedAt: null,
      lastSuccessAt: null,
      error: error instanceof Error ? error.message : "Open-Boards-Status konnte nicht geladen werden.",
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
