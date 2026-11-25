import { NextResponse } from "next/server";
import { db } from "../../../../../lib/db";
import { diagnoseStationToCrossingDistance } from "../../../../../lib/crossingOsmFilter";

type StationInput = {
  eva?: unknown;
  side?: unknown;
  trackWayIds?: unknown;
  direction?: unknown;
  enabled?: unknown;
};

function parseObject(value: unknown): Record<string, any> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, any>;
  try {
    const parsed = value ? JSON.parse(String(value)) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Builds and persists OSM rail-network timing distances for the stations
 * selected on the crossing's physical track. This is an explicit admin action;
 * the live status endpoint never builds or expands an OSM graph.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const crossingId = String(id || "").trim();
  if (!crossingId) return NextResponse.json({ error: "Crossing-ID fehlt." }, { status: 400 });

  try {
    const body = await request.json().catch(() => ({}));
    const stations = Array.isArray(body.stations) ? body.stations as StationInput[] : [];
    const selected = stations
      .filter((station) => station && station.enabled !== false)
      .map((station) => ({
        eva: String(station.eva || "").trim(),
        side: station.side === "before" || station.side === "after" ? station.side : "",
        trackWayIds: Array.isArray(station.trackWayIds)
          ? station.trackWayIds.map((value) => String(value)).filter(Boolean)
          : [],
        direction: ["eastbound", "westbound", "unknown"].includes(String(station.direction))
          ? String(station.direction)
          : "unknown",
      }))
      .filter((station) => station.eva && station.side);

    if (!selected.length) {
      return NextResponse.json({ error: "Bitte mindestens eine aktive Station mit Richtung vor/nach dem Bahnübergang auswählen." }, { status: 400 });
    }
    if (selected.length > 8) {
      return NextResponse.json({ error: "Bitte höchstens acht Stationen gleichzeitig berechnen." }, { status: 400 });
    }

    const existing = await db.execute({
      sql: "SELECT rules FROM crossings WHERE id = ? LIMIT 1",
      args: [crossingId],
    });
    if (!existing.rows.length) return NextResponse.json({ error: "Bahnübergang nicht gefunden." }, { status: 404 });

    const results = await Promise.all(selected.map(async (station) => {
      const result = await diagnoseStationToCrossingDistance(crossingId, station.eva);
      if (!result.ok) return { eva: station.eva, side: station.side, direction: station.direction, ok: false, reason: result.reason };
      const snapOk = result.station.graphSnapDistanceMeters <= 100 && result.crossing.graphSnapDistanceMeters <= 50;
      const trackOk = result.osm.selectedTrackConfirmed === true &&
        result.osm.selectedWaysAtCrossing.some((wayId: string) => station.trackWayIds.includes(String(wayId)));
      const speedScenarios = result.speedScenarios;
      return {
        eva: station.eva,
        name: result.station.name,
        side: station.side,
        direction: station.direction,
        trackWayIds: station.trackWayIds,
        ok: true,
        status: snapOk && trackOk ? "confirmed" : "needs-review",
        distanceMeters: result.osm.distanceMeters,
        distanceKm: result.osm.distanceKm,
        stationSnapDistanceMeters: result.station.graphSnapDistanceMeters,
        crossingSnapDistanceMeters: result.crossing.graphSnapDistanceMeters,
        crossingOsmNodeId: result.crossing.osmNodeId,
        selectedWaysAtCrossing: result.osm.selectedWaysAtCrossing,
        selectedTrackConfirmed: trackOk,
        snapQualityConfirmed: snapOk,
        speedScenarios,
        calculatedAt: new Date().toISOString(),
      };
    }));

    const currentRules = parseObject((existing.rows[0] as any).rules);
    const currentTiming = parseObject(currentRules.timing);
    const profile = {
      version: 1,
      source: "prepared-osm-rail-graph",
      calculatedAt: new Date().toISOString(),
      stations: results,
    };
    const nextRules = {
      ...currentRules,
      timing: {
        ...currentTiming,
        osmTimingProfile: profile,
      },
    };

    await db.execute({
      sql: "UPDATE crossings SET rules = ?, updated_at = datetime('now') WHERE id = ?",
      args: [JSON.stringify(nextRules), crossingId],
    });

    return NextResponse.json({
      ok: true,
      crossingId,
      profile,
      summary: {
        total: results.length,
        confirmed: results.filter((item: any) => item.ok && item.status === "confirmed").length,
        needsReview: results.filter((item: any) => item.ok && item.status !== "confirmed").length,
        failed: results.filter((item: any) => !item.ok).length,
      },
    });
  } catch (error) {
    console.error(`[OSM TIMING PROFILE] crossing=${crossingId} failed:`, error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "OSM-Streckendistanzen konnten nicht gespeichert werden.",
    }, { status: 500 });
  }
}
