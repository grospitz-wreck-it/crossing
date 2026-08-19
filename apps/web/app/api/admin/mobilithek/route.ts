import { NextResponse } from "next/server";
import { fetchMobilithekSubscription, getMobilithekConfigs } from "../../../lib/mobilithek";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const configs = getMobilithekConfigs();
  if (!configs.length) {
    return NextResponse.json({
      configured: false,
      error: "No MOBILITHEK_SUBSCRIPTION_ID variables configured",
    }, { status: 503 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const results = await Promise.all(configs.map(async (config) => {
      try {
        const result = await fetchMobilithekSubscription(config, { signal: controller.signal });
        return {
          subscriptionId: config.subscriptionId,
          ok: true,
          status: result.status,
          contentType: result.contentType,
          bodyLength: result.body.length,
          bodyPreview: result.body.slice(0, 2000),
        };
      } catch (error) {
        return {
          subscriptionId: config.subscriptionId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }));

    return NextResponse.json({ configured: true, count: configs.length, results });
  } finally {
    clearTimeout(timeout);
  }
}
