import { db }
from "@/app/lib/db";

function id() {
  return crypto.randomUUID();
}

export async function POST(
  request: Request
) {
  const body =
    await request.json();

  await db.execute({
    sql: `
      INSERT INTO impressions (
        id,
        campaign_id,
        creative_id,
        crossing_id,
        session_id,
        created_at
      )
      VALUES (
        ?,
        ?,
        ?,
        ?,
        ?,
        datetime('now')
      )
    `,
    args: [
      id(),
      body.campaignId,
      body.creativeId,
      body.crossingId,
      body.sessionId,
    ],
  });

  return Response.json({
    ok: true,
  });
}