import https from "node:https";
import type { ClientRequest } from "node:http";
import { createGunzip } from "node:zlib";
import {
  filterEventsByDemand,
  parseBody,
  type DemandCrossing,
  type MobilithekTrainEvent,
} from "@crossing/db-api-client";

const DEFAULT_URL =
  "https://mobilithek.info:8443/mobilithek/api/v1.0/container/subscription";

// Test gate: only this subscription is routed through the relay until the
// streaming path has been validated end-to-end.
const TEST_SUBSCRIPTION_ID = "1027363432285736960";

function fetchMobilithek(
  subscriptionId: string,
): Promise<{
  source: NodeJS.ReadableStream;
  contentType: string;
  contentEncoding: string;
  request: ClientRequest;
}> {
  const baseUrl =
    process.env.MOBILITHEK_SUBSCRIPTION_URL?.trim() || DEFAULT_URL;
  const p12Base64 = process.env.MOBILITHEK_CLIENT_P12_BASE64?.trim();
  const passphrase = process.env.MOBILITHEK_P12_PASSWORD || undefined;

  if (!p12Base64) throw new Error("MOBILITHEK_CLIENT_P12_BASE64 fehlt");

  const url = new URL(baseUrl);
  url.searchParams.set("subscriptionID", subscriptionId);

  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "GET",
        pfx: Buffer.from(p12Base64, "base64"),
        passphrase,
        headers: {
          accept: "application/xml, text/xml, */*",
          "accept-encoding": "gzip",
          "user-agent": "Crossings/1.0 (meineschranke.com)",
        },
        timeout: 60_000,
      },
      (response) => {
        const status = response.statusCode || 0;
        if (status < 200 || status >= 300) {
          const chunks: Buffer[] = [];
          response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          response.on("end", () =>
            reject(
              new Error(
                `Mobilithek HTTP ${status}: ${Buffer.concat(chunks)
                  .toString("utf8")
                  .slice(0, 500)}`,
              ),
            ),
          );
          return;
        }

        const contentType = String(
          response.headers["content-type"] || "application/octet-stream",
        );
        const contentEncoding = String(
          response.headers["content-encoding"] || "",
        ).toLowerCase();

        resolve({
          source: response,
          contentType,
          contentEncoding,
          request: req,
        });
      },
    );

    req.on("timeout", () =>
      req.destroy(new Error("Mobilithek request timed out")),
    );
    req.on("error", reject);
    req.end();
  });
}

const START_RE = /<(?:[A-Za-z_][\w.-]*:)?EstimatedVehicleJourney(?:\s|>)/;
const END_RE = /<\/(?:[A-Za-z_][\w.-]*:)?EstimatedVehicleJourney\s*>/;

function takeJourneys(buffer: string): {
  journeys: string[];
  rest: string;
} {
  const journeys: string[] = [];
  let rest = buffer;

  while (true) {
    const start = rest.search(START_RE);
    if (start < 0) {
      return { journeys, rest: rest.length > 4096 ? rest.slice(-4096) : rest };
    }

    const endMatch = END_RE.exec(rest.slice(start));
    if (!endMatch || endMatch.index == null) {
      return { journeys, rest: rest.slice(start) };
    }

    const end = start + endMatch.index + endMatch[0].length;
    journeys.push(rest.slice(start, end));
    rest = rest.slice(end);
  }
}

function encodeLine(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value)}\n`);
}

async function processJourney(
  xml: string,
  subscriptionId: string,
  demand: DemandCrossing[],
): Promise<Array<{ subscriptionId: string; event: MobilithekTrainEvent }>> {
  let events: MobilithekTrainEvent[];
  try {
    events = parseBody(xml);
  } catch (error) {
    const message =
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error);

    console.error("[Mobilithek Relay parseBody]", {
      subscriptionId,
      message,
      xmlLength: xml.length,
      xmlStart: xml.slice(0, 500),
    });

    throw new Error(`parseBody failed: ${message}`);
  }

  if (!Array.isArray(events)) {
    throw new Error(
      `parseBody returned ${typeof events}, expected array`,
    );
  }

  if (!events.length) return [];

  try {
    return filterEventsByDemand(
      events.map((event) => ({ subscriptionId, event })),
      demand,
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error);

    console.error("[Mobilithek Relay filterEventsByDemand]", {
      subscriptionId,
      message,
      eventsLength: events.length,
      demandLength: demand.length,
    });

    throw new Error(`filterEventsByDemand failed: ${message}`);
  }
}

export async function POST(request: Request) {
  try {
    const token = request.headers.get("authorization");
    const expectedToken = process.env.MOBILITHEK_RELAY_TOKEN;

    if (!expectedToken || token !== `Bearer ${expectedToken}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const subscriptionId = String(body?.subscriptionId || "").trim();
    const demand = Array.isArray(body?.demand)
      ? (body.demand as DemandCrossing[])
      : [];

    if (subscriptionId !== TEST_SUBSCRIPTION_ID) {
      return Response.json(
        { error: "Subscription not allowed", allowed: [TEST_SUBSCRIPTION_ID] },
        { status: 403 },
      );
    }

    if (!demand.length) {
      return Response.json({ error: "Demand is required" }, { status: 400 });
    }

    const upstream = await fetchMobilithek(subscriptionId);
    const source =
      upstream.contentEncoding.includes("gzip")
        ? upstream.source.pipe(createGunzip())
        : upstream.source;

    const output = new ReadableStream<Uint8Array>({
      async start(controller) {
        const decoder = new TextDecoder();
        let buffer = "";
        let parsedJourneys = 0;
        let demandedEvents = 0;

        try {
          for await (const chunk of source as AsyncIterable<Buffer | Uint8Array>) {
            buffer += decoder.decode(chunk, { stream: true });
            const extracted = takeJourneys(buffer);
            buffer = extracted.rest;

            for (const journey of extracted.journeys) {
              parsedJourneys++;
              const matches = await processJourney(
                journey,
                subscriptionId,
                demand,
              );

              for (const match of matches) {
                demandedEvents++;
                controller.enqueue(encodeLine(match));
              }
            }
          }

          buffer += decoder.decode();
          const final = takeJourneys(buffer);
          for (const journey of final.journeys) {
            parsedJourneys++;
            const matches = await processJourney(
              journey,
              subscriptionId,
              demand,
            );
            for (const match of matches) {
              demandedEvents++;
              controller.enqueue(encodeLine(match));
            }
          }

          console.log(
            `[Mobilithek Relay] ${subscriptionId}: ${parsedJourneys} journeys parsed, ${demandedEvents} demanded events`,
          );
          controller.close();
        } catch (error) {
          const message =
            error instanceof Error
              ? `${error.name}: ${error.message}`
              : String(error);

          console.error("[Mobilithek Relay stream]", error);

          controller.enqueue(
            encodeLine({
              error: "Mobilithek relay stream failed",
              message,
            }),
          );

          controller.close();
          upstream.request.destroy();
        }
      },
      cancel() {
        // Closing the upstream HTTP request is sufficient to abort both the
        // raw response and any attached gunzip stream. `source` is typed as
        // a NodeJS.ReadableStream here, but its inferred pipe result can be a
        // Web ReadableStream in Next.js, which has no `.destroy()` method.
        upstream.request.destroy();
      },
    });

    return new Response(output, {
      status: 200,
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Mobilithek-Subscription": "test-stream-filtered",
      },
    });
  } catch (error) {
    console.error("[Mobilithek Relay]", error);
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
