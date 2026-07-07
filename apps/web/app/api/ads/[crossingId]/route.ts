import { db }
from "@/app/lib/db";

export async function GET(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      crossingId: string;
    }>;
  }
) {
  const {
    crossingId,
  } = await params;

  const result =
    await db.execute({
      sql: `
        SELECT
          creatives.id,
          creatives.title,
          creatives.image_url,
          creatives.target_url,

          campaigns.id
            AS campaign_id

        FROM creatives

        INNER JOIN campaigns
          ON campaigns.id =
             creatives.campaign_id

        INNER JOIN campaign_crossings
          ON campaign_crossings.campaign_id =
             campaigns.id

        WHERE
          campaign_crossings.crossing_id = ?

          AND campaigns.active = 1

          AND creatives.active = 1

          AND date('now')
              BETWEEN
              date(campaigns.start_date)
              AND
              date(campaigns.end_date)

        ORDER BY
          campaigns.priority DESC,
          creatives.created_at DESC

        LIMIT 1
      `,
      args: [
        crossingId,
      ],
    });

  const ad =
  result.rows?.[0] as any;

if (!ad) {
  return Response.json(
    null
  );
}

return Response.json({
  id: ad.id,

  campaignId:
    ad.campaign_id,

  title:
    ad.title,

  imageUrl:
    ad.image_url,

  targetUrl:
    ad.target_url.startsWith("http")
      ? ad.target_url
      : `https://${ad.target_url}`,
});
  
}