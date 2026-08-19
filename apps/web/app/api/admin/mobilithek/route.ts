import { NextResponse } from "next/server";
import { fetchMobilithekSubscription, getMobilithekConfigs } from "../../../lib/mobilithek";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const configs = getMobilithekConfigs();
  if (!configs.length) {
    return NextResponse.json({ configured: false, error: "No MOBILITHEK_SUBSCRIPTION_ID variables configured" }, { status: 503 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const results = await Promise.all(configs.map(async (config) => {
      const requestUrl = new URL(config.baseUrl);
      requestUrl.searchParams.set("subscriptionID", config.subscriptionId);
      try {
        const result = await fetchMobilithekSubscription(config, { signal: controller.signal });
        return {
          subscriptionId: config.subscriptionId,
          ok: true,
          requestUrl: requestUrl.toString(),
          status: result.status,
          contentType: result.contentType,
          bodyLength: result.body.length,
          responseHeaders: result.headers,
          bodyPreview: result.body.slice(0, 5000),
        };
      } catch (error) {
        return {
          subscriptionId: config.subscriptionId,
          ok: false,
          requestUrl: requestUrl.toString(),
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }));

    return NextResponse.json({ configured: true, count: configs.length, results });
  } finally {
    clearTimeout(timeout);
  }
}
