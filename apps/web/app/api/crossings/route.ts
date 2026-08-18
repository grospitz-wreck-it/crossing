import { db } from "../../lib/db";
import { crossings as staticCrossings } from "../../../../packages/crossing-model/src/crossings";

export async function GET() {
  try {
    const result = await db.execute(`
      SELECT id, name
      FROM crossings
      WHERE status = 'active'
      ORDER BY name ASC
    `);

    const dbList = result.rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
    }));

    const merged = new Map<string, { id: string; name: string }>();
    for (const crossing of staticCrossings) {
      merged.set(crossing.id, {
        id: crossing.id,
        name: crossing.name,
      });
    }
    for (const crossing of dbList) {
      merged.set(crossing.id, crossing);
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
