import { db } from "../../lib/db";
import { crossings as staticCrossings } from "../../../../../packages/crossing-model/src/crossings";

export async function GET() {
  try {
    const result = await db.execute(`
      SELECT id, name, eva, lat, lon
      FROM crossings
      WHERE status = 'active'
      ORDER BY name ASC
    `);

    const dbList = result.rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      eva: String(row.eva || ""),
      lat: row.lat == null ? null : Number(row.lat),
      lon: row.lon == null ? null : Number(row.lon),
    }));

    const databaseEvas = new Set(dbList.map((crossing) => crossing.eva).filter(Boolean));
    const merged = new Map<string, { id: string; name: string }>();
    for (const crossing of staticCrossings) {
      // Do not show a second, static entry when this crossing already has a
      // configured database record. Existing users with the old ID are handled
      // by the status route's EVA alias resolution.
      if (crossing.eva && databaseEvas.has(String(crossing.eva))) continue;
      merged.set(crossing.id, {
        id: crossing.id,
        name: crossing.name,
      });
    }
    for (const crossing of dbList) {
      merged.set(crossing.id, { id: crossing.id, name: crossing.name });
    }

    return Response.json(
      [...merged.values()].sort((a, b) => a.name.localeCompare(b.name, "de"))
    );
  } catch (error) {
    console.error("GET /api/crossings failed:", error);
    return Response.json(
      { error: "Failed to load crossings" },
      { status: 500 }
    );
  }
}
