import { NextResponse } from "next/server";
import { db } from "../../../lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const result = await db.execute(`
      SELECT
        line,
        category,
        journey_number,
        journey_ref,
        origin,
        destination,
        actual_time,
        scheduled_time,
        delay_minutes,
        direction,
        source_subscription_id,
        refreshed_at
      FROM mobilithek_train_snapshot
      WHERE actual_time >= datetime('now', '-30 minutes')
      ORDER BY actual_time ASC
      LIMIT 100
    `);

    return NextResponse.json({
      ok: true,
      source: "turso-snapshot",
      count: result.rows.length,
      trains: result.rows,
    });
  } catch (error) {
    console.error("[MOBILITHEK DEBUG]", error);

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
}
