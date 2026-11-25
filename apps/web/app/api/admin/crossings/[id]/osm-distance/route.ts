import { NextResponse } from "next/server";
import { diagnoseStationToCrossingDistance } from "../../../../../lib/crossingOsmFilter";

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
    const result = await diagnoseStationToCrossingDistance(crossingId, stationEva);
    if (!result.ok) {
      const status = result.reason === "prepared-osm-profile-missing" ? 409
        : result.reason === "station-coordinate-missing" ? 404
        : 422;
      return NextResponse.json(result, { status });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error(`[OSM DISTANCE] crossing=${crossingId} eva=${stationEva} failed:`, error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "OSM-Distanz konnte nicht berechnet werden.",
    }, { status: 500 });
  }
}
