import { auth } from "../../../../auth";
import { authDb } from "../../../lib/auth-db";
import { sql } from "drizzle-orm";

type Preferences = {
  newsEnabled: boolean;
  fuelEnabled: boolean;
  fuelType: "e5" | "e10" | "diesel" | null;
  jokesEnabled: boolean;
};

const defaults: Preferences = {
  newsEnabled: false,
  fuelEnabled: false,
  fuelType: null,
  jokesEnabled: false,
};

async function ensureTable() {
  await authDb.run(sql`
    CREATE TABLE IF NOT EXISTS user_content_preferences (
      user_id TEXT PRIMARY KEY,
      news_enabled INTEGER NOT NULL DEFAULT 0,
      fuel_enabled INTEGER NOT NULL DEFAULT 0,
      fuel_type TEXT,
      jokes_enabled INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

async function readPreferences(userId: string): Promise<Preferences> {
  await ensureTable();
  const rows = await authDb.all<any>(sql`
    SELECT news_enabled, fuel_enabled, fuel_type, jokes_enabled
    FROM user_content_preferences WHERE user_id = ${userId} LIMIT 1
  `);
  const row = rows[0];
  if (!row) return defaults;
  const fuelType = ["e5", "e10", "diesel"].includes(String(row.fuel_type))
    ? row.fuel_type as Preferences["fuelType"] : null;
  return {
    newsEnabled: Number(row.news_enabled) === 1,
    fuelEnabled: Number(row.fuel_enabled) === 1 && fuelType !== null,
    fuelType,
    jokesEnabled: Number(row.jokes_enabled) === 1,
  };
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Nicht angemeldet" }, { status: 401 });
  try {
    return Response.json(await readPreferences(session.user.id));
  } catch (error) {
    console.error("[CONTENT-PREFERENCES] read failed:", error);
    return Response.json({ error: "Einstellungen konnten nicht geladen werden." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Nicht angemeldet" }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return Response.json({ error: "Ungültiger JSON-Body" }, { status: 400 }); }

  try {
    const current = await readPreferences(session.user.id);
    const next: Preferences = {
      newsEnabled: typeof body.newsEnabled === "boolean" ? body.newsEnabled : current.newsEnabled,
      fuelEnabled: typeof body.fuelEnabled === "boolean" ? body.fuelEnabled : current.fuelEnabled,
      fuelType: body.fuelType === null ? null
        : ["e5", "e10", "diesel"].includes(String(body.fuelType))
          ? body.fuelType as Preferences["fuelType"] : current.fuelType,
      jokesEnabled: typeof body.jokesEnabled === "boolean" ? body.jokesEnabled : current.jokesEnabled,
    };

    if (next.fuelEnabled && !next.fuelType) {
      return Response.json({ error: "Bitte wähle zuerst eine Spritsorte." }, { status: 400 });
    }
    if (!next.fuelEnabled) next.fuelType = null;

    await authDb.run(sql`
      INSERT INTO user_content_preferences (user_id, news_enabled, fuel_enabled, fuel_type, jokes_enabled, updated_at)
      VALUES (${session.user.id}, ${next.newsEnabled ? 1 : 0}, ${next.fuelEnabled ? 1 : 0}, ${next.fuelType}, ${next.jokesEnabled ? 1 : 0}, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        news_enabled = excluded.news_enabled,
        fuel_enabled = excluded.fuel_enabled,
        fuel_type = excluded.fuel_type,
        jokes_enabled = excluded.jokes_enabled,
        updated_at = datetime('now')
    `);
    return Response.json(next);
  } catch (error) {
    console.error("[CONTENT-PREFERENCES] update failed:", error);
    return Response.json({ error: "Einstellungen konnten nicht gespeichert werden." }, { status: 500 });
  }
}
