import { NextResponse } from "next/server";
import { diagnoseStationToCrossingDistance } from "../../../../../lib/crossingOsmFilter";
import { db } from "../../../../../lib/db";
import { crossings as staticCrossings } from "../../../../../../../packages/crossing-model/src/crossings";

/**
 * Read-only diagnostic: OSM rail-network distance from one station EVA to
 * the mapped crossing. Admin middleware protects this endpoint.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const crossingId = String(id || "").trim();
  const stationEva = new URL(request.url).searchParams.get("eva") || "8000059";

  if (!crossingId) {
    return NextResponse.json({ error: "Crossing-ID fehlt." }, { status: 400 });
  }

  try {
    // Public/static IDs (e.g. "kirchlengern") may differ from the persisted
    // database crossing ID. Resolve that alias by its known station EVA first.
    let resolvedCrossingId = crossingId;
    const persisted = await db.execute({
      sql: `SELECT id FROM crossings WHERE id = ? LIMIT 1`,
      args: [crossingId],
    });
    if (!persisted.rows.length) {
      const staticCrossing = staticCrossings.find((item) => item.id === crossingId);
      if (staticCrossing?.eva) {
        const byEva = await db.execute({
          sql: `SELECT id FROM crossings WHERE eva = ? LIMIT 1`,
          args: [String(staticCrossing.eva)],
        });
        if (byEva.rows[0]) resolvedCrossingId = String((byEva.rows[0] as any).id);
      }
    }

    const result = await diagnoseStationToCrossingDistance(resolvedCrossingId, stationEva);
    if (!result.ok) {
      const status = result.reason === "prepared-osm-profile-missing" ? 409
        : result.reason === "station-coordinate-missing" ? 404
        : 422;
      return NextResponse.json(result, { status });
    }
    return NextResponse.json({ ...result, requestedCrossingId: crossingId, resolvedCrossingId });
  } catch (error) {
    console.error(`[OSM DISTANCE] crossing=${crossingId} eva=${stationEva} failed:`, error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "OSM-Distanz konnte nicht berechnet werden.",
    }, { status: 500 });
  }
}
