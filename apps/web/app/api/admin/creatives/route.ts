import { db }
from "@/app/lib/db";

function id() {
  return crypto.randomUUID();
}

export async function GET() {
  const result =
    await db.execute(`
      SELECT
        creatives.*,

        campaigns.name
          AS campaign_name

      FROM creatives

      INNER JOIN campaigns
        ON campaigns.id =
           creatives.campaign_id

      ORDER BY
        creatives.created_at DESC
    `);

  return Response.json(
    result.rows
  );
}

export async function POST(
  request: Request
) {
  const body =
    await request.json();

  await db.execute({
    sql: `
      INSERT INTO creatives (
        id,
        campaign_id,
        title,
        image_url,
        target_url,
        active,
        created_at
      )
      VALUES (
        ?,
        ?,
        ?,
        ?,
        ?,
        1,
        datetime('now')
      )
    `,
    args: [
  id(),
  body.campaignId ?? null,
  body.title ?? "",
  body.imageUrl ?? "",
  body.targetUrl ?? "",
],
  });

  return Response.json({
    ok: true,
  });
}