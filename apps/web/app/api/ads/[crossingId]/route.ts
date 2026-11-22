import { db } from "@/app/lib/db";

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
  const { crossingId: requestedCrossingId } =
    await params;

  // Older clients may still store the legacy Kirchlengern ID while campaigns
  // are linked to the canonical crossing record.
  const legacyAliases: Record<string, string> = {
    kirchlengern: "kirchlengern-bahnhof-lubbecker-str-b8095d49",
  };
  const canonicalCrossingId = legacyAliases[requestedCrossingId] || requestedCrossingId;
  const legacyCrossingId = Object.entries(legacyAliases).find(([, canonical]) => canonical === canonicalCrossingId)?.[0];
  const crossingIds = Array.from(new Set([canonicalCrossingId, requestedCrossingId, legacyCrossingId].filter(Boolean)));

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
          campaign_crossings.crossing_id IN (${crossingIds.map(() => "?").join(",")})

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
      `,
      args: crossingIds,
    });

  const ads = result.rows.map(
    (ad: any) => ({
      id: ad.id,

      campaignId:
        ad.campaign_id,

      title:
        ad.title,

      imageUrl:
        ad.image_url,

      targetUrl:
        ad.target_url?.startsWith(
          "http"
        )
          ? ad.target_url
          : `https://${ad.target_url}`,
    })
  );

  return Response.json(ads);
}