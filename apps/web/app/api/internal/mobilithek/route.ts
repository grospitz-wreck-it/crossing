import https from "node:https";
import type { ClientRequest } from "node:http";
import { createGunzip } from "node:zlib";
import {
  filterEventsByDemand,
  getDemandMatches,
  parseBody,
  type DemandCrossing,
  type MobilithekTrainEvent,
} from "@crossing/db-api-client";

const DEFAULT_URL =
  "https://mobilithek.info:8443/mobilithek/api/v1.0/container/subscription";

// Mobilithek subscriptions can be several MB and may take longer than the old 60s ceiling.
// Vercel Hobby now permits up to 300s for Fluid Compute functions.
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
        timeout: 300_000,
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

  if (!events.length) {
    if (xml.includes("8003288") || /Kirchlengern/i.test(xml)) {
      console.log("[Mobilithek Relay] primary raw candidate parsed zero", {
        subscriptionId,
        xmlLength: xml.length,
        hasEva: xml.includes("8003288"),
        hasKirchlengern: /Kirchlengern/i.test(xml),
      });
    }
    return [];
  }

  const primaryParsed = events.filter((event) =>
    (event.calls || []).some((call) =>
      String(call.stopPointRef || "").trim() === "8003288" ||
      String(call.stopPlaceRef || "").trim() === "8003288" ||
      String(call.name || "").toLowerCase().includes("kirchlengern"),
    ),
  );

  if (primaryParsed.length > 0 || xml.includes("8003288") || /Kirchlengern/i.test(xml)) {
    console.log("[Mobilithek Relay] primary raw/parsed candidate", {
      subscriptionId,
      xmlLength: xml.length,
      rawHasEva: xml.includes("8003288"),
      rawHasKirchlengern: /Kirchlengern/i.test(xml),
      parsedPrimaryCount: primaryParsed.length,
      parsedPrimarySample: primaryParsed.slice(0, 3).map((event) => ({
        line: event.line,
        category: event.category,
        journeyRef: event.journeyRef,
        calls: event.calls
          .filter((call) =>
            String(call.stopPointRef || "").trim() === "8003288" ||
            String(call.stopPlaceRef || "").trim() === "8003288" ||
            String(call.name || "").toLowerCase().includes("kirchlengern"),
          )
          .slice(0, 5)
          .map((call) => ({
            name: call.name,
            stopPointRef: call.stopPointRef,
            stopPlaceRef: call.stopPlaceRef,
          })),
      })),
    });
  }

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

async function processJourneyDiagnostic(
  xml: string,
  subscriptionId: string,
  demand: DemandCrossing[],
): Promise<{
  events: Array<{ subscriptionId: string; event: MobilithekTrainEvent }>;
  fromNormalFilter: number;
  fromRawFallback: number;
  journeyCount: number;
}> {
  const events = parseBody(xml);
  const journeyCount = (xml.match(/<EstimatedVehicleJourney/g) || []).length;
  if (!events.length) return { events: [], fromNormalFilter: 0, fromRawFallback: 0, journeyCount };
  const parsed = filterEventsByDemand(events.map((event) => ({ subscriptionId, event })), demand);
  const primaryEvas = Array.from(new Set(demand.flatMap((crossing) =>
    Array.isArray(crossing.primaryObservationEvas)
      ? crossing.primaryObservationEvas.map((eva) => String(eva).trim()).filter(Boolean)
      : [],
  )));
  const parsedKeys = new Set(parsed.map(({ event }) => String(event.journeyRef) + "|" + String(event.id)));
  const rawPrimaryEvents = primaryEvas.some((eva) => xml.includes(eva))
    ? events.filter((event) => !parsedKeys.has(String(event.journeyRef) + "|" + String(event.id)))
        .map((event) => ({ subscriptionId, event }))
    : [];
  return {
    events: rawPrimaryEvents.length ? [...parsed, ...rawPrimaryEvents] : parsed,
    fromNormalFilter: parsed.length,
    fromRawFallback: rawPrimaryEvents.length,
    journeyCount,
  };
}

export async function POST(request: Request) {
  try {
    const token = request.headers.get("authorization");
    const expectedToken = process.env.MOBILITHEK_RELAY_TOKEN;

    if (!expectedToken || token !== `Bearer ${expectedToken}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    if (url.searchParams.get("ping") === "1" || request.headers.get("x-mobilithek-ping") === "1") {
      return Response.json(
        {
          status: "ok",
          mode: "ping",
          version: "2026-09-22-ping-1",
        },
        {
          status: 200,
          headers: {
            "Cache-Control": "no-store",
            "X-Mobilithek-Diagnostic": "1",
            "X-Mobilithek-Relay-Version": "2026-09-22-ping-1",
          },
        },
      );
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

    console.log("[Mobilithek Relay] upstream start", {
      subscriptionId,
      diagnostic,
    });

    let upstream: Awaited<ReturnType<typeof fetchMobilithek>>;
    try {
      upstream = await fetchMobilithek(subscriptionId);
    } catch (error) {
      const err = error as {
        name?: unknown;
        message?: unknown;
        code?: unknown;
        cause?: { name?: unknown; message?: unknown; code?: unknown };
      };

      console.error("[Mobilithek Relay] upstream fetch failed", {
        subscriptionId,
        errorName: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? error.message : String(error),
        code: err?.code,
        causeName: err?.cause?.name,
        causeMessage: err?.cause?.message,
        causeCode: err?.cause?.code,
      });

      if (diagnostic) {
        return Response.json(
          {
            status: "error",
            mode: "diagnostic",
            subscriptionId,
            stage: "mobilithek-upstream-connect",
            error: {
              name: error instanceof Error ? error.name : typeof error,
              message: error instanceof Error ? error.message : String(error),
              code: err?.code,
              causeName: err?.cause?.name,
              causeMessage: err?.cause?.message,
              causeCode: err?.cause?.code,
            },
          },
          {
            status: 200,
            headers: {
              "Cache-Control": "no-store",
              "X-Mobilithek-Diagnostic": "1",
              "X-Mobilithek-Relay-Version": "2026-09-22-diagnostic-4",
            },
          },
        );
      }

      throw error;
    }

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
      const crossingBreakdown = new Map<string, { events: number; primary: number; secondary: number }>();

      const inspect = async (journey: string) => {
        parsedJourneys++;
        if (/RB\s*61/i.test(journey)) rawRb61Journeys++;
        if (/RE\s*60/i.test(journey)) rawRe60Journeys++;
        if (/Kirchlengern/i.test(journey)) rawKirchlengernJourneys++;
        if (/8003288/.test(journey)) rawEva8003288Journeys++;

        const result = await processJourneyDiagnostic(journey, subscriptionId, demand);
        normalFilterEvents += result.fromNormalFilter;
        rawFallbackEvents += result.fromRawFallback;
        if (result.journeyCount !== 1) scopeViolations++;
        demandedEvents += result.events.length;

        for (const item of result.events) {
          for (const match of getDemandMatches(item.event, demand)) {
            const current = crossingBreakdown.get(match.crossingId) || { events: 0, primary: 0, secondary: 0 };
            current.events++;
            current[match.kind]++;
            crossingBreakdown.set(match.crossingId, current);
          }
        }
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

        return new Response(JSON.stringify({
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
          crossingBreakdown: Object.fromEntries(crossingBreakdown),
        }), {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Mobilithek-Diagnostic": "1",
            "X-Mobilithek-Relay-Version": "2026-09-22-diagnostic-2",
          },
        });
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

          console.error("[Mobilithek Relay stream]", {
            subscriptionId,
            message,
            errorName: error instanceof Error ? error.name : undefined,
            stack: error instanceof Error ? error.stack : undefined,
          });

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
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
