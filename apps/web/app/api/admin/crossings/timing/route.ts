import { db } from "../../../../lib/db";

async function ensureSettings() {
  await db.execute(`CREATE TABLE IF NOT EXISTS crossing_timing_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
}

export async function GET() {
  try {
    await ensureSettings();
    const result = await db.execute({
      sql: "SELECT setting_value FROM crossing_timing_settings WHERE setting_key = ? LIMIT 1",
      args: ["global_crossing_time_correction_seconds"],
    });
    const stored = result.rows[0]?.setting_value;
    const fallback = Number(process.env.CROSSING_TIME_CORRECTION_SECONDS ?? 0);
    const value = stored == null ? (Number.isFinite(fallback) ? fallback : 0) : Number(stored);
    return Response.json({ crossingTimeCorrectionSeconds: Number.isFinite(value) ? value : 0 });
  } catch (error) {
    console.error("[ADMIN TIMING] load failed", error);
    return Response.json({ error: "Globale Zeitkorrektur konnte nicht geladen werden." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const value = Number(body.crossingTimeCorrectionSeconds);
    if (!Number.isFinite(value) || Math.abs(value) > 3600) {
      return Response.json({ error: "Bitte einen Wert zwischen -3600 und 3600 Sekunden eingeben." }, { status: 400 });
    }
    await ensureSettings();
    await db.execute({
      sql: `INSERT INTO crossing_timing_settings (setting_key, setting_value, updated_at)
            VALUES (?, ?, datetime('now'))
            ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = datetime('now')`,
      args: ["global_crossing_time_correction_seconds", String(Math.round(value))],
    });
    return Response.json({ ok: true, crossingTimeCorrectionSeconds: Math.round(value) });
  } catch (error) {
    console.error("[ADMIN TIMING] save failed", error);
    return Response.json({ error: "Globale Zeitkorrektur konnte nicht gespeichert werden." }, { status: 500 });
  }
}
