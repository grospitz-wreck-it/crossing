import { db } from "@/app/lib/db";

async function ensureTables() {
  await db.execute(`CREATE TABLE IF NOT EXISTS app_content_items (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
    content_type TEXT NOT NULL DEFAULT 'feature_tip', image_url TEXT,
    icon TEXT NOT NULL DEFAULT '✨', accent_color TEXT NOT NULL DEFAULT '#f32643',
    status TEXT NOT NULL DEFAULT 'draft', action_type TEXT NOT NULL DEFAULT 'none',
    action_url TEXT, sort_order INTEGER NOT NULL DEFAULT 0, onboarding_version INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), published_at TEXT
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS app_content_placements (
    content_id TEXT NOT NULL, crossing_id TEXT NOT NULL, PRIMARY KEY (content_id,crossing_id),
    FOREIGN KEY (content_id) REFERENCES app_content_items(id) ON DELETE CASCADE
  )`);
}
const TYPES = new Set(["onboarding","feature_tip","local_news","event","partner"]);
const ACTIONS = new Set(["none","location","install_help","open_url"]);
function clean(body: any) {
  const title = String(body.title ?? "").trim().slice(0,120);
  if (!title) throw new Error("Bitte einen Titel eingeben.");
  const actionType = ACTIONS.has(body.actionType) ? body.actionType : "none";
  const actionUrl = String(body.actionUrl ?? "").trim().slice(0,1000);
  if (actionType === "open_url" && actionUrl) {
    const url = new URL(actionUrl);
    if (!["https:","http:"].includes(url.protocol)) throw new Error("Nur http(s)-Links sind erlaubt.");
  }
  const contentType = TYPES.has(body.contentType) ? body.contentType : "feature_tip";
  return {
    title, summary: String(body.summary ?? "").trim().slice(0,600), contentType,
    imageUrl: String(body.imageUrl ?? "").trim().slice(0,2000) || null,
    icon: String(body.icon ?? "✨").trim().slice(0,12) || "✨",
    accentColor: /^#[0-9a-fA-F]{6}$/.test(body.accentColor) ? body.accentColor : "#f32643",
    status: body.status === "published" ? "published" : "draft", actionType,
    actionUrl: actionUrl || null, sortOrder: Math.max(0,Math.min(9999,Number(body.sortOrder)||0)),
    onboardingVersion: contentType === "onboarding" ? Math.max(1,Number(body.onboardingVersion)||1) : null,
    crossings: Array.isArray(body.crossings) ? [...new Set(body.crossings.map((v: unknown)=>String(v).trim()).filter(Boolean))].slice(0,100) : [],
  };
}
export async function PATCH(request: Request, { params }: { params: Promise<{id:string}> }) {
  await ensureTables();
  const { id } = await params;
  try {
    const body = clean(await request.json());
    await db.execute({ sql: `UPDATE app_content_items SET title=?,summary=?,content_type=?,image_url=?,icon=?,accent_color=?,status=?,action_type=?,action_url=?,sort_order=?,onboarding_version=?,updated_at=datetime('now'),published_at=CASE WHEN ?='published' THEN COALESCE(published_at,datetime('now')) ELSE NULL END WHERE id=?`,
      args:[body.title,body.summary,body.contentType,body.imageUrl,body.icon,body.accentColor,body.status,body.actionType,body.actionUrl,body.sortOrder,body.onboardingVersion,body.status,id] });
    await db.execute({sql:"DELETE FROM app_content_placements WHERE content_id=?",args:[id]});
    for (const crossingId of body.crossings) await db.execute({sql:"INSERT INTO app_content_placements (content_id,crossing_id) VALUES (?,?)",args:[id,crossingId]});
    return Response.json({ok:true});
  } catch(error) {
    return Response.json({error:error instanceof Error?error.message:String(error)},{status:400});
  }
}
export async function DELETE(_request: Request, { params }: { params: Promise<{id:string}> }) {
  await ensureTables();
  const { id } = await params;
  await db.execute({sql:"DELETE FROM app_content_placements WHERE content_id=?",args:[id]});
  await db.execute({sql:"DELETE FROM app_content_items WHERE id=?",args:[id]});
  return Response.json({ok:true});
}
