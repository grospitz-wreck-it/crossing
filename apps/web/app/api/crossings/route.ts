import { db } from "../../lib/db";

export async function GET() {
  try {
    const result = await db.execute(`
      SELECT
        id,
        name
      FROM crossings
      WHERE status = 'active'
      ORDER BY name ASC
    `);

    const list = result.rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
    }));

    return Response.json(list);
  } catch (error) {
    console.error("GET /api/crossings failed:", error);

    return Response.json(
      { error: "Failed to load crossings" },
      { status: 500 }
    );
  }
}