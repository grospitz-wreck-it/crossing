import { NextResponse } from "next/server";
import { getMobilithekTrainRegistry } from "../../../../../../packages/db-api-client/src/mobilithekTimetable";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const trains = await getMobilithekTrainRegistry();
    const now = Date.now();
    const upcoming = trains
      .filter((train) => train.actualTime.getTime() >= now - 5 * 60_000)
      .sort((a, b) => a.actualTime.getTime() - b.actualTime.getTime());

    return NextResponse.json({
      ok: true,
      count: trains.length,
      upcomingCount: upcoming.length,
      categories: Array.from(new Set(trains.map((train) => train.category))).sort(),
      lines: Array.from(new Set(trains.map((train) => train.line))).sort(),
      trains: upcoming.slice(0, 100).map((train) => ({
        id: train.id,
        line: train.line,
        category: train.category,
        journeyNumber: train.journeyNumber,
        journeyRef: train.journeyRef,
        origin: train.origin,
        destination: train.destination,
        route: train.route,
        delayMinutes: train.delayMinutes,
        actualTime: train.actualTime.toISOString(),
        scheduledTime: train.scheduledTime.toISOString(),
        direction: train.direction,
      })),
    });
  } catch (error) {
    console.error("[MOBILITHEK TEST]", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 502 }
    );
  }
}
