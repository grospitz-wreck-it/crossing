import { configureDb } from "./db.js";
import { loadDemandCrossings } from "./demand.js";
import {
  fetchRelayDiagnostics,
  fetchRelayPing,
  refreshOnce,
} from "./cloudflareMobilithek.js";
import {
  cleanupSubscriptionSnapshots,
  finalizeRefreshStatus,
  writeSubscriptionBatch,
} from "./snapshot.js";

export interface Env {
  TURSO_DATABASE_URL: string;
  TURSO_AUTH_TOKEN: string;
  MOBILITHEK_SUBSCRIPTION_ID?: string;
  MOBILITHEK_SUBSCRIPTION_ID_2?: string;
  MOBILITHEK_SUBSCRIPTION_ID_3?: string;
  MOBILITHEK_SUBSCRIPTION_ID_4?: string;
  MOBILITHEK_SUBSCRIPTION_URL?: string;
  MOBILITHEK_RELAY_URL?: string;
  MOBILITHEK_RELAY_TOKEN?: string;
  MOBILITHEK_CLIENT: Fetcher;
  MOBILITHEK_CLIENT_TEST: Fetcher;
}

// Production probe (2026-11-19): this feed returned zero demanded events
// for all active crossings. Keep its ID in the cleanup list so old snapshot
// rows from this source are removed on the next successful refresh.
const RETIRED_TRAIN_SUBSCRIPTION_IDS: string[] = [
  "1024488922196914176",
];

function getSubscriptionIds(env: Env): string[] {
  return [
    env.MOBILITHEK_SUBSCRIPTION_ID,
    env.MOBILITHEK_SUBSCRIPTION_ID_2,
    env.MOBILITHEK_SUBSCRIPTION_ID_3,
    env.MOBILITHEK_SUBSCRIPTION_ID_4,
  ]
    .map((value) => value?.trim() || "")
    .filter(
      (value, index, values) =>
        Boolean(value) &&
        !RETIRED_TRAIN_SUBSCRIPTION_IDS.includes(value) &&
        values.indexOf(value) === index,
    );
}

const TEST_URL_8443 =
  "https://mobilithek.info:8443/mobilithek/api/v1.0/container/subscription?subscriptionID=1027362883041628160";
const TEST_URL_443 =
  "https://mobilithek.info/mobilithek/api/v1.0/container/subscription?subscriptionID=1027362883041628160";
const PUBLIC_TEST_URL = "https://example.com/";

async function probe(
  label: string,
  url: string,
  fetcher: typeof fetch,
): Promise<Record<string, unknown>> {
  const startedAt = Date.now();

  try {
    const response = await fetcher(url, {
      method: "GET",
      headers: { "user-agent": "Crossings-mTLS-Diagnostic/1.0" },
    });
    const body = (await response.text()).slice(0, 4000);

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
    await probe("global-fetch-example", PUBLIC_TEST_URL, fetch),
    await probe(
      "mtls-binding-example",
      PUBLIC_TEST_URL,
      env.MOBILITHEK_CLIENT.fetch.bind(env.MOBILITHEK_CLIENT),
    ),
    await probe(
      "mtls-binding-test-example",
      PUBLIC_TEST_URL,
      env.MOBILITHEK_CLIENT_TEST.fetch.bind(env.MOBILITHEK_CLIENT_TEST),
    ),
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

  console.log(
    "[Mobilithek Worker] demanded crossings",
    demand.map((item) => ({
      id: item.id,
      primaryObservationEvas: item.primaryObservationEvas,
      primaryObservationStations: item.primaryObservationStations,
      secondaryRules: item.secondaryRules,
    })),
  );

  if (demand.length === 0) {
    return { status: "idle", demandedCrossings: 0 };
  }

  const subscriptionIds = getSubscriptionIds(env);
  if (subscriptionIds.length === 0) {
    throw new Error("Keine Mobilithek-Subscription-IDs konfiguriert");
  }

  console.log(
    `[Mobilithek Worker] subscriptions=${subscriptionIds.join(",")}`,
  );

  const refreshedAt = new Date().toISOString();

  // Stream each subscription into Turso in bounded batches.
  // Do not collect all events in memory or depend on result.events.
  const result = await refreshOnce(
    env,
    subscriptionIds,
    demand,
    async (subscriptionId, events) => {
      await writeSubscriptionBatch(events, subscriptionId, refreshedAt);
    },
  );

  const failedSubscriptionIds = new Set(
    result.errors.map((error) => error.subscriptionId),
  );

  const successfulSubscriptionIds = subscriptionIds.filter(
    (subscriptionId) => !failedSubscriptionIds.has(subscriptionId),
  );

  const demandedEventCount = result.acceptedEvents;

  console.log(
    `[Mobilithek Worker] parsedEvents=${result.parsedEvents} ` +
      `accepted=${result.acceptedEvents} demandedEvents=${demandedEventCount}`,
  );

  if (result.successful === 0) {
    throw new Error(
      `Keine Mobilithek-Subscription erfolgreich verarbeitet: ${JSON.stringify(result.errors)}`,
    );
  }

  if (demandedEventCount === 0) {
    throw new Error(
      "Mobilithek lieferte keine Zugdaten für die aktuell nachgefragten BÜs",
    );
  }

  // Also clean snapshots from retired feeds after a successful refresh.
  await cleanupSubscriptionSnapshots(
    [...successfulSubscriptionIds, ...RETIRED_TRAIN_SUBSCRIPTION_IDS],
    refreshedAt,
  );

  await finalizeRefreshStatus(startedAt, refreshedAt, {
    subscriptionCount: result.subscriptionCount,
    successful: result.successful,
    failed: result.failed,
    eventCount: demandedEventCount,
  });

  return {
    status: "success",
    demandedCrossings: demand.length,
    subscriptions: result.subscriptionCount,
    successful: result.successful,
    failed: result.failed,
    parsedEvents: result.parsedEvents,
    demandedEvents: demandedEventCount,
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

    if (url.pathname === "/debug") {
      try {
        configureDb(env);
        const demand = await loadDemandCrossings();

        // Read-only relay ping: no upstream Mobilithek call and no DB writes.
        if (url.searchParams.get("ping") === "1") {
          const startedAt = Date.now();

          try {
            const result = await fetchRelayPing(env, demand);

            return Response.json({
              status: "ok",
              mode: "read-only-ping",
              durationMs: Date.now() - startedAt,
              relayConfig: {
                configured: Boolean(env.MOBILITHEK_RELAY_URL),
              },
              relay: result,
              note: "No Mobilithek upstream call and no Turso snapshot writes were performed.",
            });
          } catch (error) {
            return Response.json(
              {
                status: "error",
                mode: "read-only-ping",
                durationMs: Date.now() - startedAt,
                error: error instanceof Error ? error.message : String(error),
                note: "No Mobilithek upstream call and no Turso snapshot writes were performed.",
              },
              { status: 502 },
            );
          }
        }

        // Read-only diagnostic: probes the relay and applies production demand
        // filtering. No snapshot writes or cleanup/finalization are performed.
        if (url.searchParams.get("probe") === "1") {
          const requestedSubscription = url.searchParams
            .get("subscription")
            ?.trim();

          const allSubscriptionIds = getSubscriptionIds(env);
          const subscriptionIds = requestedSubscription
            ? allSubscriptionIds.filter((id) => id === requestedSubscription)
            : allSubscriptionIds;

          const probes: Array<Record<string, unknown>> = [];

          for (const subscriptionId of subscriptionIds) {
            const startedAt = Date.now();

            try {
              const result = await fetchRelayDiagnostics(
                env,
                subscriptionId,
                demand,
              );

              probes.push({
                subscriptionId,
                durationMs: Date.now() - startedAt,
                ...result,
              });
            } catch (error) {
              probes.push({
                subscriptionId,
                durationMs: Date.now() - startedAt,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }

          let relayConfig: Record<string, unknown> = {
            configured: Boolean(env.MOBILITHEK_RELAY_URL),
          };

          if (env.MOBILITHEK_RELAY_URL) {
            try {
              const relayUrl = new URL(env.MOBILITHEK_RELAY_URL);
              relayConfig = {
                configured: true,
                protocol: relayUrl.protocol,
                host: relayUrl.host,
                pathname: relayUrl.pathname,
                hasQuery: relayUrl.search.length > 0,
              };
            } catch {
              relayConfig = { configured: true, url: "invalid-url" };
            }
          }

          return Response.json({
            status: "ok",
            mode: "read-only-probe",
            demandedCrossings: demand.length,
            subscriptions: subscriptionIds,
            excludedSubscriptions: RETIRED_TRAIN_SUBSCRIPTION_IDS,
            relayConfig,
            probes,
            note: "No Turso snapshot writes were performed.",
          });
        }

        let relayConfig: Record<string, unknown> = {
          configured: Boolean(env.MOBILITHEK_RELAY_URL),
        };

        if (env.MOBILITHEK_RELAY_URL) {
          try {
            const relayUrl = new URL(env.MOBILITHEK_RELAY_URL);
            relayConfig = {
              configured: true,
              protocol: relayUrl.protocol,
              host: relayUrl.host,
              pathname: relayUrl.pathname,
              hasQuery: relayUrl.search.length > 0,
            };
          } catch {
            relayConfig = { configured: true, url: "invalid-url" };
          }
        }

        return Response.json({
          status: "ok",
          demandedCrossings: demand.length,
          subscriptions: getSubscriptionIds(env),
          excludedSubscriptions: RETIRED_TRAIN_SUBSCRIPTION_IDS,
          relayConfig,
          demand: demand.map((crossing) => ({
            id: crossing.id,
            primaryObservationEvas: crossing.primaryObservationEvas,
            primaryObservationStations: crossing.primaryObservationStations,
            secondaryRules: crossing.secondaryRules,
          })),
        });
      } catch (error) {
        console.error(
          "[Mobilithek Worker] debug failed",
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
