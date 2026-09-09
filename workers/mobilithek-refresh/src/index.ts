import { configureDb } from "./db.js";
import { loadDemandCrossings } from "./demand.js";
import { filterEventsByDemand } from "./filterDemand.js";
import { refreshOnce } from "./cloudflareMobilithek.js";
import { writeSnapshot } from "./snapshot.js";

export interface Env {
  TURSO_DATABASE_URL: string;
  TURSO_AUTH_TOKEN: string;
  MOBILITHEK_SUBSCRIPTION_ID?: string;
  MOBILITHEK_SUBSCRIPTION_ID_2?: string;
  MOBILITHEK_SUBSCRIPTION_ID_3?: string;
  MOBILITHEK_SUBSCRIPTION_ID_4?: string;
  MOBILITHEK_SUBSCRIPTION_URL?: string;
  MOBILITHEK_CLIENT: Fetcher;
}

function getSubscriptionIds(env: Env): string[] {
  return [
    env.MOBILITHEK_SUBSCRIPTION_ID,
    env.MOBILITHEK_SUBSCRIPTION_ID_2,
    env.MOBILITHEK_SUBSCRIPTION_ID_3,
    env.MOBILITHEK_SUBSCRIPTION_ID_4,
  ]
    .map((value) => value?.trim() || "")
    .filter(Boolean);
}

async function runMtlsTest(env: Env): Promise<Response> {
  const subscriptionId = "1027362883041628160";
  const url =
    `https://mobilithek.info:8443/mobilithek/api/v1.0/container/subscription` +
    `?subscriptionID=${subscriptionId}`;
  const startedAt = Date.now();

  try {
    const response = await env.MOBILITHEK_CLIENT.fetch(url, {
      method: "GET",
    });
    const body = await response.text();

    return Response.json({
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      durationMs: Date.now() - startedAt,
      headers: {
        contentType: response.headers.get("content-type"),
        server: response.headers.get("server"),
        cfRay: response.headers.get("cf-ray"),
        contentLength: response.headers.get("content-length"),
        date: response.headers.get("date"),
      },
      bodyLength: body.length,
      bodyPreview: body.slice(0, 500),
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
        errorName: error instanceof Error ? error.name : undefined,
        stack: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 },
    );
  }
}

async function runRefresh(env: Env): Promise<Record<string, unknown>> {
  const startedAt = new Date().toISOString();
  configureDb(env);

  const demand = await loadDemandCrossings();
  console.log(`[Mobilithek Worker] demanded crossings=${demand.length}`);

  if (demand.length === 0) {
    return { status: "idle", demandedCrossings: 0 };
  }

  const subscriptionIds = getSubscriptionIds(env);
  if (subscriptionIds.length === 0) {
    throw new Error("Keine Mobilithek-Subscription-IDs konfiguriert");
  }

  console.log(`[Mobilithek Worker] subscriptions=${subscriptionIds.join(",")}`);

  const result = await refreshOnce(env, subscriptionIds);
  const demandedEvents = filterEventsByDemand(result.events, demand);

  console.log(
    `[Mobilithek Worker] parsedEvents=${result.parsedEvents} ` +
      `accepted=${result.acceptedEvents} demandedEvents=${demandedEvents.length}`,
  );

  if (result.successful === 0) {
    throw new Error(
      `Keine Mobilithek-Subscription erfolgreich verarbeitet: ${JSON.stringify(result.errors)}`,
    );
  }

  if (demandedEvents.length === 0) {
    throw new Error(
      "Mobilithek lieferte keine Zugdaten für die aktuell nachgefragten BÜs",
    );
  }

  await writeSnapshot(demandedEvents, startedAt, {
    subscriptionCount: result.subscriptionCount,
    successful: result.successful,
    failed: result.failed,
  });

  return {
    status: "success",
    demandedCrossings: demand.length,
    subscriptions: result.subscriptionCount,
    successful: result.successful,
    failed: result.failed,
    parsedEvents: result.parsedEvents,
    demandedEvents: demandedEvents.length,
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "mobilithek-refresh" });
    }
    if (url.pathname === "/mtls-test") {
      return runMtlsTest(env);
    }
    if (url.pathname === "/run") {
      try {
        const result = await runRefresh(env);
        return Response.json(result);
      } catch (error) {
        console.error(
          "[Mobilithek Worker] manual refresh failed",
          error instanceof Error ? error.stack || error.message : String(error),
        );
        return Response.json(
          {
            status: "error",
            error: error instanceof Error ? error.message : String(error),
          },
          { status: 500 },
        );
      }
    }
    return new Response("Mobilithek refresh worker", { status: 200 });
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    try {
      const result = await runRefresh(env);
      console.log("[Mobilithek Worker] refresh result", result);
    } catch (error) {
      console.error(
        "[Mobilithek Worker] refresh failed",
        error instanceof Error ? error.stack || error.message : String(error),
      );
      throw error;
    }
  },
} satisfies ExportedHandler<Env>;
