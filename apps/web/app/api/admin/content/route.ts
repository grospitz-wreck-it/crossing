import { db } from "@/app/lib/db";

async function ensureTables() {
  await db.execute(`CREATE TABLE IF NOT EXISTS app_content_items (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    content_type TEXT NOT NULL DEFAULT 'feature_tip',
    image_url TEXT,
    icon TEXT NOT NULL DEFAULT '✨',
    accent_color TEXT NOT NULL DEFAULT '#f32643',
    status TEXT NOT NULL DEFAULT 'draft',
    action_type TEXT NOT NULL DEFAULT 'none',
    action_url TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    onboarding_version INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    published_at TEXT
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS app_content_placements (
    content_id TEXT NOT NULL,
    crossing_id TEXT NOT NULL,
    PRIMARY KEY (content_id, crossing_id),
    FOREIGN KEY (content_id) REFERENCES app_content_items(id) ON DELETE CASCADE
  )`);
}

const TYPES = new Set(["onboarding", "feature_tip", "local_news", "event", "partner"]);
const ACTIONS = new Set(["none", "location", "install_help", "open_url"]);

function clean(body: any) {
  const title = String(body.title ?? "").trim().slice(0, 120);
  const summary = String(body.summary ?? "").trim().slice(0, 600);
  const type = TYPES.has(body.contentType) ? body.contentType : "feature_tip";
  const actionType = ACTIONS.has(body.actionType) ? body.actionType : "none";
  const actionUrl = String(body.actionUrl ?? "").trim().slice(0, 1000);
  if (!title) throw new Error("Bitte einen Titel eingeben.");
  if (actionType === "open_url" && actionUrl) {
    const url = new URL(actionUrl);
    if (!["https:", "http:"].includes(url.protocol)) throw new Error("Nur http(s)-Links sind erlaubt.");
  }
  return {
    title, summary, type,
    imageUrl: String(body.imageUrl ?? "").trim().slice(0, 2000) || null,
    icon: String(body.icon ?? "✨").trim().slice(0, 12) || "✨",
    accentColor: /^#[0-9a-fA-F]{6}$/.test(body.accentColor) ? body.accentColor : "#f32643",
    status: body.status === "published" ? "published" : "draft",
    actionType, actionUrl: actionUrl || null,
    sortOrder: Math.max(0, Math.min(9999, Number(body.sortOrder) || 0)),
    onboardingVersion: type === "onboarding" ? Math.max(1, Number(body.onboardingVersion) || 1) : null,
    crossings: Array.isArray(body.crossings) ? [...new Set(body.crossings.map((v: unknown) => String(v).trim()).filter(Boolean))].slice(0, 100) : [],
  };
}

export async function GET() {
  await ensureTables();
  const result = await db.execute(`SELECT * FROM app_content_items ORDER BY sort_order ASC, updated_at DESC`);
  const items = await Promise.all(result.rows.map(async (item: any) => {
    const placements = await db.execute({ sql: "SELECT crossing_id FROM app_content_placements WHERE content_id = ?", args: [item.id] });
    return { ...item, crossings: placements.rows.map((row: any) => row.crossing_id) };
  }));
  return Response.json(items);
}

export async function POST(request: Request) {
  await ensureTables();
  try {
    const body = clean(await request.json());
    const id = crypto.randomUUID();
    await db.execute({
      sql: `INSERT INTO app_content_items
        (id,title,summary,content_type,image_url,icon,accent_color,status,action_type,action_url,sort_order,onboarding_version,published_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,CASE WHEN ?='published' THEN datetime('now') ELSE NULL END)`,
      args: [id, body.title, body.summary, body.type, body.imageUrl, body.icon, body.accentColor, body.status, body.actionType, body.actionUrl, body.sortOrder, body.onboardingVersion, body.status],
    });
    for (const crossingId of body.crossings) {
      await db.execute({ sql: "INSERT INTO app_content_placements (content_id,crossing_id) VALUES (?,?)", args: [id, crossingId] });
    }
    return Response.json({ ok: true, id }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
