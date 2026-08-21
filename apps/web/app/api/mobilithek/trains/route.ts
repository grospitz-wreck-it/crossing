import { NextResponse } from "next/server";
import { db } from "../../../lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const now = Date.now();
    const cutoff = new Date(now - 5 * 60_000).toISOString();

    const result = await db.execute({
      sql: `
        SELECT
          id,
          line,
          category,
          journey_number,
          journey_ref,
          origin,
          destination,
          route_json,
          delay_minutes,
          actual_time,
          scheduled_time,
          direction,
          source_subscription_id,
          refreshed_at
        FROM mobilithek_train_snapshot
        WHERE actual_time >= ?
        ORDER BY actual_time ASC
        LIMIT 100
      `,
      args: [cutoff],
    });

    const trains = result.rows.map((row) => ({
      id: String(row.id),
      line: String(row.line || ""),
      category: String(row.category || ""),
      journeyNumber:
        row.journey_number == null ? null : Number(row.journey_number),
      journeyRef: String(row.journey_ref || ""),
      origin: row.origin == null ? null : String(row.origin),
      destination:
        row.destination == null ? null : String(row.destination),
      route: JSON.parse(String(row.route_json || "[]")),
      delayMinutes: Number(row.delay_minutes || 0),
      actualTime: String(row.actual_time),
      scheduledTime: String(row.scheduled_time),
      direction: row.direction == null ? null : String(row.direction),
      sourceSubscriptionId: String(row.source_subscription_id || ""),
      refreshedAt: String(row.refreshed_at),
    }));

    const total = await db.execute(`
      SELECT COUNT(*) AS count
      FROM mobilithek_train_snapshot
    `);

    const categories = await db.execute(`
      SELECT DISTINCT category
      FROM mobilithek_train_snapshot
      WHERE category IS NOT NULL
      ORDER BY category
    `);

    const lines = await db.execute(`
      SELECT DISTINCT line
      FROM mobilithek_train_snapshot
      WHERE line IS NOT NULL
      ORDER BY line
    `);

    return NextResponse.json({
      ok: true,
      source: "turso-snapshot",
      count: Number(total.rows[0]?.count || 0),
      upcomingCount: trains.length,
      categories: categories.rows.map((row) => String(row.category)),
      lines: lines.rows.map((row) => String(row.line)),
      trains,
    });
  } catch (error) {
    console.error("[MOBILITHEK SNAPSHOT]", error);

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
}
