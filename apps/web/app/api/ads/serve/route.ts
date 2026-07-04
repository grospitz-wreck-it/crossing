import { db }
from "@/app/lib/db";

export async function GET(
  request: Request
) {
  const { searchParams } =
    new URL(request.url);

  const crossingId =
    searchParams.get(
      "crossingId"
    );

  const result =
    await db.execute({
      sql: `
        SELECT
          creatives.id,
          creatives.image_url,
          creatives.target_url,
          campaigns.id AS campaign_id
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

        LIMIT 1
      `,
      args: [
        crossingId,
      ],
    });

  return Response.json(
    result.rows[0] ??
      null
  );
}