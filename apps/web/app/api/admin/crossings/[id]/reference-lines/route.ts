import { db } from "../../../../../lib/db";

function normalizeReferenceLines(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\n,;]+/)
      : [];

  return Array.from(
    new Set(
      values
        .map((value) => String(value).trim().toUpperCase())
        .filter(Boolean)
    )
  ).slice(0, 20);
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const result = await db.execute({
      sql: "SELECT id, reference_lines FROM crossings WHERE id = ? LIMIT 1",
      args: [id],
    });
    const row: any = result.rows[0];
    if (!row) return Response.json({ error: "Crossing not found" }, { status: 404 });

    let referenceLines: string[] = [];
    try {
      referenceLines = normalizeReferenceLines(JSON.parse(String(row.reference_lines || "[]")));
    } catch {
      referenceLines = [];
    }

    return Response.json({ referenceLines });
  } catch (error) {
    console.error("Failed to load crossing reference lines:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Referenzlinien konnten nicht geladen werden." }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await request.json().catch(() => ({}));
    const referenceLines = normalizeReferenceLines(body.referenceLines ?? body.knownLines);

    const existing = await db.execute({
      sql: "SELECT id FROM crossings WHERE id = ? LIMIT 1",
      args: [id],
    });
    if (!existing.rows.length) return Response.json({ error: "Crossing not found" }, { status: 404 });

    await db.execute({
      sql: "UPDATE crossings SET reference_lines = ?, updated_at = datetime('now') WHERE id = ?",
      args: [JSON.stringify(referenceLines), id],
    });

    return Response.json({ ok: true, id, referenceLines });
  } catch (error) {
    console.error("Failed to update crossing reference lines:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Referenzlinien konnten nicht gespeichert werden." }, { status: 500 });
  }
}
