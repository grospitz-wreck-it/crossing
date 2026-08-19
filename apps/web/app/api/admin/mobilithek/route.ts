import { NextResponse } from "next/server";
import { fetchMobilithekSubscription, getMobilithekConfig } from "../../../lib/mobilithek";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const config = getMobilithekConfig();
  if (!config) {
    return NextResponse.json({
      configured: false,
      error: "MOBILITHEK_SUBSCRIPTION_ID is missing",
    }, { status: 503 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const result = await fetchMobilithekSubscription({ signal: controller.signal });
    const bodyPreview = result.body.slice(0, 2000);

    return NextResponse.json({
      configured: true,
      status: result.status,
      contentType: result.contentType,
      subscriptionId: config.subscriptionId,
      bodyLength: result.body.length,
      bodyPreview,
    });
  } catch (error) {
    return NextResponse.json({
      configured: true,
      subscriptionId: config.subscriptionId,
      error: error instanceof Error ? error.message : String(error),
    }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
