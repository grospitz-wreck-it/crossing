import { NextResponse } from "next/server";
import {
  fetchMobilithekSubscription,
  getMobilithekConfigs,
} from "../../../lib/mobilithek";

export const dynamic = "force-dynamic";

export async function GET() {
  const subscriptionId = process.env.MOBILITHEK_SUBSCRIPTION_ID_4?.trim();

  if (!subscriptionId) {
    return NextResponse.json(
      { ok: false, error: "MOBILITHEK_SUBSCRIPTION_ID_4 is not configured" },
      { status: 500 },
    );
  }

  const config = getMobilithekConfigs().find(
    (entry) => entry.subscriptionId === subscriptionId,
  );

  if (!config) {
    return NextResponse.json(
      { ok: false, error: "Subscription 4 could not be resolved from the configured Mobilithek settings" },
      { status: 500 },
    );
  }

  try {
    const result = await fetchMobilithekSubscription(config);
    const body = result.body || "";

    return NextResponse.json({
      ok: true,
      subscriptionId,
      status: result.status,
      contentType: result.contentType,
      bodyLength: body.length,
      hasS28: /S28/i.test(body),
      hasKaarst: /Kaarst/i.test(body),
      hasDusseldorf: /Düsseldorf|Dusseldorf/i.test(body),
      preview: body.slice(0, 2000),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        subscriptionId,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
}
