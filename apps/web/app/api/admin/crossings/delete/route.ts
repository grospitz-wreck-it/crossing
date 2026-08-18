import { db } from "../../../../../lib/db";

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = String(searchParams.get("id") || "").trim();

  if (!id) {
    return Response.json({ error: "Bahnübergang-ID fehlt." }, { status: 400 });
  }

  try {
    const existing = await db.execute({
      sql: "SELECT id, name FROM crossings WHERE id = ? LIMIT 1",
      args: [id],
    });

    if (!existing.rows.length) {
      return Response.json({ error: "Bahnübergang nicht gefunden." }, { status: 404 });
    }

    // Remove dependent records first. This also works for installations where
    // foreign-key cascades are not enabled on the current Turso connection.
    const tables = await db.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    );

    const cleanedTables: string[] = [];
    for (const row of tables.rows as Array<{ name?: string }>) {
      const tableName = String(row.name || "");
      if (!tableName || tableName === "crossings") continue;

      const columns = await db.execute(`PRAGMA table_info(${quoteIdentifier(tableName)})`);
      const hasCrossingId = (columns.rows as Array<{ name?: string }>).some(
        (column) => String(column.name || "").toLowerCase() === "crossing_id"
      );

      if (hasCrossingId) {
        await db.execute({
          sql: `DELETE FROM ${quoteIdentifier(tableName)} WHERE crossing_id = ?`,
          args: [id],
        });
        cleanedTables.push(tableName);
      }
    }

    const deleted = await db.execute({
      sql: "DELETE FROM crossings WHERE id = ?",
      args: [id],
    });

    if (Number(deleted.rowsAffected || 0) !== 1) {
      return Response.json({ error: "Bahnübergang konnte nicht gelöscht werden." }, { status: 500 });
    }

    const verify = await db.execute({
      sql: "SELECT id FROM crossings WHERE id = ? LIMIT 1",
      args: [id],
    });

    if (verify.rows.length) {
      return Response.json({ error: "Löschen konnte nicht aus der Datenbank bestätigt werden." }, { status: 500 });
    }

    return Response.json({
      ok: true,
      id,
      cleanedTables,
    });
  } catch (error) {
    console.error("DELETE /api/admin/crossings failed:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
