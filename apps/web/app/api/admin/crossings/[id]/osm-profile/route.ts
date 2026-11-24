import { NextResponse } from "next/server";
import { db } from "../../../../../lib/db";
import { prepareCrossingOsmProfile } from "../../../../../lib/crossingOsmFilter";

/**
 * Explicit, admin-authenticated preparation endpoint.
 * The middleware protects /api/admin/* with the existing Basic Auth.
 * This route is intentionally POST-only: status requests never trigger OSM work.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const crossingId = String(id || "").trim();
  if (!crossingId) {
    return NextResponse.json({ error: "Crossing-ID fehlt." }, { status: 400 });
  }

  try {
    const crossing = await db.execute({
      sql: `SELECT id, name FROM crossings WHERE id = ? LIMIT 1`,
      args: [crossingId],
    });
    if (!crossing.rows.length) {
      return NextResponse.json({ error: "Bahnübergang nicht gefunden." }, { status: 404 });
    }

    const corridor = await db.execute({
      sql: `SELECT crossing_id FROM crossing_osm_corridors WHERE crossing_id = ? LIMIT 1`,
      args: [crossingId],
    });
    if (!corridor.rows.length) {
      return NextResponse.json({
        error: "Für diesen Bahnübergang ist noch kein OSM-Korridor gespeichert.",
        code: "OSM_CORRIDOR_MISSING",
      }, { status: 409 });
    }

    const result = await prepareCrossingOsmProfile(crossingId);
    if (!result.ok) {
      const status = result.reason === "corridor-row-missing" ? 409 : 422;
      const messages: Record<string, string> = {
        "mapping-missing": "OSM-Zuordnung oder ausgewählte Gleise fehlen.",
        "no-ways-loaded": "Für die ausgewählten Gleise wurden keine gültigen OSM-Bahnwege im Datenbestand gefunden.",
        "max-graph-ways": "Der Streckengraph überschreitet das Sicherheitslimit für Bahnwege.",
        "max-graph-nodes": "Der Streckengraph überschreitet das Sicherheitslimit für Knoten.",
        "max-expansion-rounds": "Die Streckengraph-Erweiterung hat das Rundenlimit erreicht.",
        "frontier-over-capacity": "Zu viele Anschlussgleise für das konfigurierte Sicherheitslimit.",
        "graph-invalid": "Aus den OSM-Daten ließ sich kein gültiger Streckengraph erzeugen.",
        "corridor-row-missing": "Der gespeicherte OSM-Korridor wurde während der Vorbereitung nicht gefunden.",
      };
      return NextResponse.json({
        error: messages[result.reason] || "Der OSM-Korridor konnte nicht vorbereitet werden.",
        code: result.reason,
        diagnostics: "diagnostics" in result ? result.diagnostics : undefined,
      }, { status });
    }

    return NextResponse.json({
      ok: true,
      crossingId,
      crossingName: String((crossing.rows[0] as any).name || crossingId),
      profileVersion: 3,
      ways: result.ways,
      nodes: result.nodes,
      bytes: result.bytes,
    });
  } catch (error) {
    console.error(`[OSM PROFILE API] crossing=${crossingId} failed:`, error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "OSM-Profil konnte nicht vorbereitet werden.",
    }, { status: 500 });
  }
}
