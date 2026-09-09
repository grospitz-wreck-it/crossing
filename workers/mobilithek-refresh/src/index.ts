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
  MOBILITHEK_CLIENT_TEST: Fetcher;
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

const TEST_URL_8443 =
  "https://mobilithek.info:8443/mobilithek/api/v1.0/container/subscription?subscriptionID=1027362883041628160";
const TEST_URL_443 =
  "https://mobilithek.info/mobilithek/api/v1.0/container/subscription?subscriptionID=1027362883041628160";

async function probe(
  label: string,
  url: string,
  fetcher: typeof fetch,
): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  try {
    const response = await fetcher(url, { method: "GET" });
    const body = await response.text();
    return {
      label,
      url,
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
      bodyPreview: body.slice(0, 300),
    };
  } catch (error) {
    return {
      label,
      url,
      ok: false,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : undefined,
      stack: error instanceof Error ? error.stack : undefined,
    };
  }
}

async function runMtlsCompare(env: Env): Promise<Response> {
  const tests = [
    await probe("global-fetch-8443", TEST_URL_8443, fetch),
    await probe(
      "mtls-binding-8443",
      TEST_URL_8443,
      env.MOBILITHEK_CLIENT.fetch.bind(env.MOBILITHEK_CLIENT),
    ),
    await probe(
      "mtls-binding-test-8443",
      TEST_URL_8443,
      env.MOBILITHEK_CLIENT_TEST.fetch.bind(env.MOBILITHEK_CLIENT_TEST),
    ),
    await probe(
      "mtls-binding-443",
      TEST_URL_443,
      env.MOBILITHEK_CLIENT.fetch.bind(env.MOBILITHEK_CLIENT),
    ),
    await probe(
      "mtls-binding-test-443",
      TEST_URL_443,
      env.MOBILITHEK_CLIENT_TEST.fetch.bind(env.MOBILITHEK_CLIENT_TEST),
    ),
  ];
  return Response.json({ tests });
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
      return runMtlsCompare(env);
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
