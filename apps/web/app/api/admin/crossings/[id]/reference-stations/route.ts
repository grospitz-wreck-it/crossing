import { db } from "../../../../../../app/lib/db";

function normalize(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\n,;]+/) : [];
  return Array.from(new Set(values.map((value) => String(value).trim()).filter(Boolean))).slice(0, 20);
}

async function ensureColumn() {
  try {
    await db.execute("SELECT reference_stations FROM crossings LIMIT 1");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/no such column:\s*reference_stations/i.test(message)) throw error;
    await db.execute("ALTER TABLE crossings ADD COLUMN reference_stations TEXT NOT NULL DEFAULT '[]'");
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await ensureColumn();
    const result = await db.execute({ sql: "SELECT reference_stations FROM crossings WHERE id = ? LIMIT 1", args: [id] });
    const row: any = result.rows[0];
    if (!row) return Response.json({ error: "Crossing not found" }, { status: 404 });
    return Response.json({ referenceStations: normalize(JSON.parse(String(row.reference_stations || "[]"))) });
  } catch (error) {
    console.error("Failed to load crossing reference stations:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Referenzbahnhöfe konnten nicht geladen werden." }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await request.json().catch(() => ({}));
    const referenceStations = normalize(body.referenceStations ?? body.referenceEvas);
    const existing = await db.execute({ sql: "SELECT id FROM crossings WHERE id = ? LIMIT 1", args: [id] });
    if (!existing.rows.length) return Response.json({ error: "Crossing not found" }, { status: 404 });
    await ensureColumn();
    await db.execute({ sql: "UPDATE crossings SET reference_stations = ?, updated_at = datetime('now') WHERE id = ?", args: [JSON.stringify(referenceStations), id] });
    return Response.json({ ok: true, id, referenceStations });
  } catch (error) {
    console.error("Failed to update crossing reference stations:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Referenzbahnhöfe konnten nicht gespeichert werden." }, { status: 500 });
  }
}
