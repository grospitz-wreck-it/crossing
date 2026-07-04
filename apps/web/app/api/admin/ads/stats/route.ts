import { db }
from "@/app/lib/db";

export async function GET() {
  const campaigns =
    await db.execute(`
      SELECT
        campaigns.id,
        campaigns.name,
        campaigns.billing_model,
        campaigns.cpm,

        (
          SELECT COUNT(*)
          FROM impressions
          WHERE impressions.campaign_id =
            campaigns.id
        ) AS impressions,

        (
          SELECT COUNT(*)
          FROM clicks
          WHERE clicks.campaign_id =
            campaigns.id
        ) AS clicks

      FROM campaigns
    `);

  return Response.json(
    campaigns.rows
  );
}