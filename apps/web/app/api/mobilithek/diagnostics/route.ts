import { NextResponse } from "next/server";
import { db } from "../../../lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const status = await db.execute(`
      SELECT
        id,
        started_at,
        finished_at,
        status,
        subscription_count,
        successful_subscriptions,
        failed_subscriptions,
        event_count,
        error
      FROM mobilithek_refresh_status
      WHERE id = 1
      LIMIT 1
    `);

    const snapshot = await db.execute(`
      SELECT
        COUNT(*) AS event_count,
        MIN(actual_time) AS earliest,
        MAX(actual_time) AS latest,
        MAX(refreshed_at) AS refreshed_at
      FROM mobilithek_train_snapshot
    `);

    return NextResponse.json({
      ok: true,
      source: "turso-snapshot",
      refresh: status.rows[0] || null,
      snapshot: snapshot.rows[0] || null,
    });
  } catch (error) {
    console.error("[MOBILITHEK DIAGNOSTICS]", error);

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
}
