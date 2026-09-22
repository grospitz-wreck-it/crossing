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

// Mobilithek feeds can be hundreds of MB and may take >15s to stream.
// Keep the relay alive long enough to consume the complete upstream feed.
export const maxDuration = 300;

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
        // Allow the complete Mobilithek feed to stream within the Vercel maxDuration window.\n        timeout: 300_000,
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
): Promise<{
  events: Array<{ subscriptionId: string; event: MobilithekTrainEvent }>;
  debug: {
    xmlLength: number;
    journeyCount: number;
    fromNormalFilter: number;
    fromRawFallback: number;
  };
}> {
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

  const debug = {
    xmlLength: xml.length,
    journeyCount: (xml.match(/<EstimatedVehicleJourney/g) || []).length,
    fromNormalFilter: 0,
    fromRawFallback: 0,
  };

  if (!events.length) {
    return { events: [], debug };
  }

  try {
    const parsed = filterEventsByDemand(
      events.map((event) => ({ subscriptionId, event })),
      demand,
    );

    // Some Mobilithek SIRI journeys expose the primary EVA only as an XML
    // attribute. Keep an exact raw-EVA fallback so a valid primary-stop
    // journey cannot be lost because the feed encoded StopPointRef/Ref
    // differently from the parsed object.
    const primaryEvas = Array.from(
      new Set(
        demand.flatMap((crossing) =>
          Array.isArray(crossing.primaryObservationEvas)
            ? crossing.primaryObservationEvas
                .map((eva) => String(eva).trim())
                .filter(Boolean)
            : [],
        ),
      ),
    );

    if (!primaryEvas.length) return { events: parsed, debug: { ...debug, fromNormalFilter: parsed.length } };

    const rawPrimaryMatch = primaryEvas.some((eva) => xml.includes(eva));
    if (!rawPrimaryMatch) return { events: parsed, debug: { ...debug, fromNormalFilter: parsed.length } };

    const parsedKeys = new Set(
      parsed.map(({ event }) => String(event.journeyRef) + "|" + String(event.id)),
    );

    const rawPrimaryEvents = events
      .filter(
        (event) =>
          !parsedKeys.has(
            String(event.journeyRef) + "|" + String(event.id),
          ),
      )
      .map((event) => ({ subscriptionId, event }));

    debug.fromNormalFilter = parsed.length;
    debug.fromRawFallback = rawPrimaryEvents.length;

    return {
      events: rawPrimaryEvents.length ? [...parsed, ...rawPrimaryEvents] : parsed,
      debug,
    };
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

function relayErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  return Response.json(
    { error: "Mobilithek upstream failed", message },
    { status: 502 },
  );
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

    if (!demand.length) {
      return Response.json({ error: "Demand is required" }, { status: 400 });
    }

    const diagnostic =
      body?.mode === "diagnostic" ||
      request.headers.get("x-mobilithek-diagnostic") === "1" ||
      new URL(request.url).searchParams.get("diagnostic") === "1";
    console.log("[Mobilithek Relay] upstream start", { subscriptionId, diagnostic });

    const upstream = await fetchMobilithek(subscriptionId);
    console.log("[Mobilithek Relay] upstream response", {
      subscriptionId,
      contentType: upstream.contentType,
      contentEncoding: upstream.contentEncoding,
    });
    const source =
      upstream.contentEncoding.includes("gzip")
        ? upstream.source.pipe(createGunzip())
        : upstream.source;

    if (diagnostic) {
      const decoder = new TextDecoder();
      let buffer = "";
      let parsedJourneys = 0;
      let demandedEvents = 0;
      let rawRb61Journeys = 0;
      let rawRe60Journeys = 0;
      let rawKirchlengernJourneys = 0;
      let rawEva8003288Journeys = 0;
      let scopeViolations = 0;
      let normalFilterEvents = 0;
      let rawFallbackEvents = 0;

      const inspectRawJourney = (journey: string) => {
        if (/RB\s*61/i.test(journey)) rawRb61Journeys++;
        if (/RE\s*60/i.test(journey)) rawRe60Journeys++;
        if (/Kirchlengern/i.test(journey)) rawKirchlengernJourneys++;
        if (/8003288/.test(journey)) rawEva8003288Journeys++;
      };

      const inspect = async (journey: string) => {
        parsedJourneys++;
        inspectRawJourney(journey);
        const result = await processJourney(journey, subscriptionId, demand);
        normalFilterEvents += result.debug.fromNormalFilter;
        rawFallbackEvents += result.debug.fromRawFallback;
        if (result.debug.journeyCount !== 1) scopeViolations++;
        demandedEvents += result.events.length;
      };

      try {
        for await (const chunk of source as AsyncIterable<Buffer | Uint8Array>) {
          buffer += decoder.decode(chunk, { stream: true });
          const extracted = takeJourneys(buffer);
          buffer = extracted.rest;
          for (const journey of extracted.journeys) await inspect(journey);
        }

        buffer += decoder.decode();
        const final = takeJourneys(buffer);
        for (const journey of final.journeys) await inspect(journey);

        upstream.request.destroy();

        return new Response(
          JSON.stringify({
            status: "ok",
            mode: "diagnostic",
            subscriptionId,
            parsedJourneys,
            demandedEvents,
            scopeViolations,
            fromNormalFilter: normalFilterEvents,
            fromRawFallback: rawFallbackEvents,
            rawRb61Journeys,
            rawRe60Journeys,
            rawKirchlengernJourneys,
            rawEva8003288Journeys,
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "no-store",
              "X-Mobilithek-Diagnostic": "1",
            },
          },
        );
      } catch (error) {
        upstream.request.destroy();
        throw error;
      }
    }

    const output = new ReadableStream<Uint8Array>({
      async start(controller) {
        const decoder = new TextDecoder();
        let buffer = "";
        let parsedJourneys = 0;
        let demandedEvents = 0;
        let rawRb61Journeys = 0;
        let rawRe60Journeys = 0;
        let rawKirchlengernJourneys = 0;
        let rawEva8003288Journeys = 0;
        let debugScopeViolations = 0;
        let debugNormalFilterEvents = 0;
        let debugRawFallbackEvents = 0;

        const inspectRawJourney = (journey: string) => {
          if (/RB\s*61/i.test(journey)) rawRb61Journeys++;
          if (/RE\s*60/i.test(journey)) rawRe60Journeys++;
          if (/Kirchlengern/i.test(journey)) rawKirchlengernJourneys++;
          if (/8003288/.test(journey)) rawEva8003288Journeys++;
        };

        try {
          for await (const chunk of source as AsyncIterable<Buffer | Uint8Array>) {
            buffer += decoder.decode(chunk, { stream: true });
            const extracted = takeJourneys(buffer);
            buffer = extracted.rest;

            for (const journey of extracted.journeys) {
              parsedJourneys++;
              inspectRawJourney(journey);
              const result = await processJourney(
                journey,
                subscriptionId,
                demand,
              );

              debugNormalFilterEvents += result.debug.fromNormalFilter;
              debugRawFallbackEvents += result.debug.fromRawFallback;
              if (result.debug.journeyCount !== 1) debugScopeViolations++;
              for (const match of result.events) {
                demandedEvents++;
                controller.enqueue(encodeLine(match));
              }
            }
          }

          buffer += decoder.decode();
          const final = takeJourneys(buffer);
          for (const journey of final.journeys) {
            parsedJourneys++;
            inspectRawJourney(journey);
            const result = await processJourney(
              journey,
              subscriptionId,
              demand,
            );
            debugNormalFilterEvents += result.debug.fromNormalFilter;
            debugRawFallbackEvents += result.debug.fromRawFallback;
            if (result.debug.journeyCount !== 1) debugScopeViolations++;
            for (const match of result.events) {
              demandedEvents++;
              controller.enqueue(encodeLine(match));
            }
          }

          console.log(
            `[Mobilithek Relay] ${subscriptionId}: ${parsedJourneys} journeys parsed, ${demandedEvents} demanded events`,
          );
          console.log("[Mobilithek Relay] raw feed inspection", {
            subscriptionId,
            parsedJourneys,
            rawRb61Journeys,
            rawRe60Journeys,
            rawKirchlengernJourneys,
            rawEva8003288Journeys,
          });
          controller.enqueue(
            encodeLine({
              __meta: "mobilithek-demand-debug",
              subscriptionId,
              parsedJourneys,
              scopeViolations: debugScopeViolations,
              fromNormalFilter: debugNormalFilterEvents,
              fromRawFallback: debugRawFallbackEvents,
            }),
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
        "X-Mobilithek-Subscription": subscriptionId,
      },
    });
  } catch (error) {
    console.error("[Mobilithek Relay]", error);
    return relayErrorResponse(error);
  }
}
