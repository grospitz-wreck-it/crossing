import { db } from "../../../../lib/db";

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = String(searchParams.get("id") || "").trim();
    if (!id) return Response.json({ error: "ID fehlt." }, { status: 400 });
    const existing = await db.execute({ sql: `SELECT id,name FROM crossings WHERE id=? LIMIT 1`, args: [id] });
    if (!existing.rows.length) return Response.json({ error: "Bahnübergang nicht gefunden." }, { status: 404 });
    for (const table of ["campaign_crossings", "user_crossings"]) {
      try { await db.execute({ sql: `DELETE FROM ${table} WHERE crossing_id=?`, args: [id] }); } catch {}
    }
    await db.execute({ sql: `DELETE FROM crossings WHERE id=?`, args: [id] });
    const verify = await db.execute({ sql: `SELECT id FROM crossings WHERE id=? LIMIT 1`, args: [id] });
    if (verify.rows.length) return Response.json({ error: "Bahnübergang konnte nicht gelöscht werden.", code: "DELETE_FAILED" }, { status: 500 });
    return Response.json({ ok: true, id, deleted: true });
  } catch (error) {
    return Response.json({ error: "Bahnübergang konnte nicht gelöscht werden.", code: "DELETE_FAILED", detail: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
