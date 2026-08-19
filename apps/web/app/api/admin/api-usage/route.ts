import { getDbApiUsage } from "../../../../../packages/db-api-client/src/apiRateLimiter";

export async function GET() {
  try {
    const usage = await getDbApiUsage();
    return Response.json(usage, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Failed to load DB API usage:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "API-Nutzung konnte nicht geladen werden." },
      { status: 500 }
    );
  }
}
