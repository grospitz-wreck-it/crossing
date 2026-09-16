import https from "node:https";

const DEFAULT_URL =
  "https://mobilithek.info:8443/mobilithek/api/v1.0/container/subscription";

const TEST_SUBSCRIPTION_ID = "1027363432285736960";

function fetchMobilithek(
  subscriptionId: string,
): Promise<{
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  contentEncoding?: string;
}> {
  const baseUrl =
    process.env.MOBILITHEK_SUBSCRIPTION_URL?.trim() || DEFAULT_URL;

  const p12Base64 = process.env.MOBILITHEK_CLIENT_P12_BASE64?.trim();
  const passphrase = process.env.MOBILITHEK_P12_PASSWORD || undefined;

  if (!p12Base64) {
    throw new Error("MOBILITHEK_CLIENT_P12_BASE64 fehlt");
  }

  const url = new URL(baseUrl);
  url.searchParams.set("subscriptionID", subscriptionId);

  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: "GET",
        pfx: Buffer.from(p12Base64, "base64"),
        passphrase,
        headers: {
          accept: "application/xml, text/xml, */*",
          "accept-encoding": "identity",
          "user-agent": "Crossings/1.0 (meineschranke.com)",
        },
        timeout: 60_000,
      },
      (response) => {
        const status = response.statusCode || 0;

        if (status < 200 || status >= 300) {
          const chunks: Buffer[] = [];

          response.on("data", (chunk) => {
            chunks.push(
              Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
            );
          });

          response.on("end", () => {
            reject(
              new Error(
                `Mobilithek HTTP ${status}: ${Buffer.concat(chunks)
                  .toString("utf8")
                  .slice(0, 500)}`,
              ),
            );
          });

          return;
        }

        const contentType =
          String(response.headers["content-type"] || "application/octet-stream");

        const contentEncoding = String(
          response.headers["content-encoding"] || "",
        ).toLowerCase();

        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            response.on("data", (chunk) => {
              controller.enqueue(
                Buffer.isBuffer(chunk)
                  ? new Uint8Array(chunk)
                  : new Uint8Array(Buffer.from(chunk)),
              );
            });

            response.on("end", () => {
              controller.close();
            });

            response.on("error", (error) => {
              controller.error(error);
            });
          },

          cancel() {
            request.destroy();
          },
        });

        resolve({
          stream,
          contentType,
          contentEncoding: contentEncoding || undefined,
        });
      },
    );

    request.on("timeout", () => {
      request.destroy(new Error("Mobilithek request timed out"));
    });

    request.on("error", reject);
    request.end();
  });
}

export async function POST(request: Request) {
  try {
    const token = request.headers.get("authorization");
    const expectedToken = process.env.MOBILITHEK_RELAY_TOKEN;

    if (!expectedToken || token !== `Bearer ${expectedToken}`) {
      console.error("[Relay auth]", {
        received: Boolean(token),
        receivedLength: token?.length ?? 0,
        expected: Boolean(expectedToken),
        expectedLength: expectedToken?.length ?? 0,
        startsBearer: token?.startsWith("Bearer ") ?? false,
      });

      return Response.json(
        {
          error: "Unauthorized",
          diagnostics: {
            received: Boolean(token),
            receivedLength: token?.length ?? 0,
            expected: Boolean(expectedToken),
            expectedLength: expectedToken?.length ?? 0,
            startsBearer: token?.startsWith("Bearer ") ?? false,
          },
        },
        { status: 401 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const subscriptionId = String(body?.subscriptionId || "").trim();

    if (subscriptionId !== TEST_SUBSCRIPTION_ID) {
      return Response.json(
        {
          error: "Subscription not allowed",
          allowed: [TEST_SUBSCRIPTION_ID],
        },
        { status: 403 },
      );
    }

    const result = await fetchMobilithek(subscriptionId);

    return new Response(result.stream, {
      status: 200,
      headers: {
        "Content-Type": result.contentType,
        "Cache-Control": "no-store",
        "X-Mobilithek-Subscription": "test",
        ...(result.contentEncoding
          ? { "X-Mobilithek-Content-Encoding": result.contentEncoding }
          : {}),
      },
    });
  } catch (error) {
    console.error("[Mobilithek Relay]", error);

    return Response.json(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
