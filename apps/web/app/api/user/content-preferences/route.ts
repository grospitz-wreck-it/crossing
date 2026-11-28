import { auth } from "../../../../auth";
import { authDb } from "../../../lib/auth-db";
import { sql } from "drizzle-orm";

type ContentKind = "news" | "fuel" | "jokes";
type Preferences = {
  newsEnabled: boolean;
  fuelEnabled: boolean;
  fuelType: "e5" | "e10" | "diesel" | null;
  jokesEnabled: boolean;
  contentOrder: ContentKind[];
};

const DEFAULT_CONTENT_ORDER: ContentKind[] = ["news", "fuel", "jokes"];
const defaults: Preferences = {
  newsEnabled: false,
  fuelEnabled: false,
  fuelType: null,
  jokesEnabled: false,
  contentOrder: DEFAULT_CONTENT_ORDER,
};

function normalizeContentOrder(value: unknown, fallback: ContentKind[] = DEFAULT_CONTENT_ORDER): ContentKind[] {
  const allowed = new Set<ContentKind>(["news", "fuel", "jokes"]);
  const requested = Array.isArray(value)
    ? value.filter((item): item is ContentKind => typeof item === "string" && allowed.has(item as ContentKind))
    : [];
  const result: ContentKind[] = [];
  for (const item of [...requested, ...fallback, ...DEFAULT_CONTENT_ORDER]) {
    if (!result.includes(item)) result.push(item);
  }
  return result;
}

async function ensureTable() {
  await authDb.run(sql`
    CREATE TABLE IF NOT EXISTS user_content_preferences (
      user_id TEXT PRIMARY KEY,
      news_enabled INTEGER NOT NULL DEFAULT 0,
      fuel_enabled INTEGER NOT NULL DEFAULT 0,
      fuel_type TEXT,
      jokes_enabled INTEGER NOT NULL DEFAULT 0,
      content_order TEXT NOT NULL DEFAULT '["news","fuel","jokes"]',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  // Inspect the live schema first. LibSQL wraps SQLite errors in nested causes,
  // so checking the text of the outer error is not reliable.
  const columns = await authDb.all<any>(sql`PRAGMA table_info(user_content_preferences)`);
  const hasContentOrder = columns.some((column) => String(column.name) === "content_order");

  if (!hasContentOrder) {
    try {
      await authDb.run(sql`
        ALTER TABLE user_content_preferences
        ADD COLUMN content_order TEXT NOT NULL DEFAULT '["news","fuel","jokes"]'
      `);
    } catch (error) {
      // Two first requests can race during a schema upgrade. Ignore only the
      // specific duplicate-column race; propagate every other database error.
      let cause: unknown = error;
      let duplicateColumn = false;
      while (cause && typeof cause === "object") {
        const message = String((cause as { message?: unknown }).message ?? "").toLowerCase();
        if (message.includes("duplicate column")) {
          duplicateColumn = true;
          break;
        }
        cause = (cause as { cause?: unknown }).cause;
      }
      if (!duplicateColumn) throw error;
    }
  }
}

async function readPreferences(userId: string): Promise<Preferences> {
  await ensureTable();
  const rows = await authDb.all<any>(sql`
    SELECT news_enabled, fuel_enabled, fuel_type, jokes_enabled, content_order
    FROM user_content_preferences WHERE user_id = ${userId} LIMIT 1
  `);
  const row = rows[0];
  if (!row) return { ...defaults, contentOrder: [...DEFAULT_CONTENT_ORDER] };

  const fuelType = ["e5", "e10", "diesel"].includes(String(row.fuel_type))
    ? row.fuel_type as Preferences["fuelType"] : null;
  let storedOrder: unknown = null;
  try { storedOrder = JSON.parse(String(row.content_order || "[]")); } catch { storedOrder = null; }

  return {
    newsEnabled: Number(row.news_enabled) === 1,
    fuelEnabled: Number(row.fuel_enabled) === 1 && fuelType !== null,
    fuelType,
    jokesEnabled: Number(row.jokes_enabled) === 1,
    contentOrder: normalizeContentOrder(storedOrder),
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
      contentOrder: Array.isArray(body.contentOrder)
        ? normalizeContentOrder(body.contentOrder, current.contentOrder)
        : current.contentOrder,
    };

    if (next.fuelEnabled && !next.fuelType) {
      return Response.json({ error: "Bitte wähle zuerst eine Spritsorte." }, { status: 400 });
    }
    if (!next.fuelEnabled) next.fuelType = null;

    await authDb.run(sql`
      INSERT INTO user_content_preferences
        (user_id, news_enabled, fuel_enabled, fuel_type, jokes_enabled, content_order, updated_at)
      VALUES (
        ${session.user.id},
        ${next.newsEnabled ? 1 : 0},
        ${next.fuelEnabled ? 1 : 0},
        ${next.fuelType},
        ${next.jokesEnabled ? 1 : 0},
        ${JSON.stringify(next.contentOrder)},
        datetime('now')
      )
      ON CONFLICT(user_id) DO UPDATE SET
        news_enabled = excluded.news_enabled,
        fuel_enabled = excluded.fuel_enabled,
        fuel_type = excluded.fuel_type,
        jokes_enabled = excluded.jokes_enabled,
        content_order = excluded.content_order,
        updated_at = datetime('now')
    `);
    return Response.json(next);
  } catch (error) {
    console.error("[CONTENT-PREFERENCES] update failed:", error);
    return Response.json({ error: "Einstellungen konnten nicht gespeichert werden." }, { status: 500 });
  }
}
