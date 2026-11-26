import { db } from "@/app/lib/db";

export async function GET(_request: Request, { params }: { params: Promise<{ crossingId: string }> }) {
  const { crossingId } = await params;
  try {
    const legacyAliases: Record<string, string> = {
      kirchlengern: "kirchlengern-bahnhof-lubbecker-str-b8095d49",
    };
    const canonicalId = legacyAliases[crossingId] || crossingId;
    const ids = Array.from(new Set([crossingId, canonicalId]));
    const result = await db.execute({
      sql: `SELECT DISTINCT i.id, i.title, i.summary, i.content_type, i.image_url,
                   i.icon, i.accent_color, i.action_type, i.action_url, i.sort_order
            FROM app_content_items i
            WHERE i.status = 'published'
              AND (
                NOT EXISTS (SELECT 1 FROM app_content_placements p0 WHERE p0.content_id = i.id)
                OR EXISTS (
                  SELECT 1 FROM app_content_placements p
                  WHERE p.content_id = i.id AND p.crossing_id IN (${ids.map(() => "?").join(",")})
                )
              )
            ORDER BY i.sort_order ASC, i.published_at DESC`,
      args: ids,
    });
    return Response.json(result.rows);
  } catch (error) {
    // CMS tables are created by the admin API on first use. A public app request
    // before the first admin visit should simply return no editorial cards.
    console.error("Content feed unavailable:", error);
    return Response.json([]);
  }
}
