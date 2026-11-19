import { fetchOpenBoardsBoard } from "@crossing/db-api-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PROBE_EVA = "8003295";

function summarize(value: unknown) {
  const json = JSON.stringify(value);
  if (json.length <= 12_000) return value;
  return {
    truncated: true,
    originalJsonLength: json.length,
    preview: json.slice(0, 12_000),
  };
}

export async function GET() {
  const startedAt = Date.now();

  if (!process.env.DB_CLIENT_ID || !process.env.DB_API_KEY) {
    return Response.json(
      { ok: false, error: "DB_CLIENT_ID / DB_API_KEY are not configured for this deployment." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const results = await Promise.all(
    (["arrivals", "departures"] as const).map(async (direction) => {
      try {
        const data = await fetchOpenBoardsBoard(direction, [PROBE_EVA], {
          timeStart: new Date().toISOString(),
          maxViaStops: 5,
          maxEntriesPerTransportType: 10,
          languages: ["deu"],
        });

        const record =
          data && typeof data === "object" && !Array.isArray(data)
            ? (data as Record<string, unknown>)
            : null;

        return {
          direction,
          ok: true,
          topLevelKeys: record ? Object.keys(record) : [],
          data: summarize(data),
        };
      } catch (error) {
        return {
          direction,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );

  return Response.json(
    {
      ok: results.every((result) => result.ok),
      source: "DB OpenBoards",
      eva: PROBE_EVA,
      durationMs: Date.now() - startedAt,
      results,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
