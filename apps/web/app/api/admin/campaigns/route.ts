import { db }
from "@/app/lib/db";

function id() {
  return crypto.randomUUID();
}

export async function GET() {
  const result =
    await db.execute(`
      SELECT
        campaigns.*,

        customers.name
          AS customer_name

      FROM campaigns

      INNER JOIN customers
        ON customers.id =
           campaigns.customer_id

      ORDER BY
        campaigns.created_at DESC
    `);

  const campaigns =
    await Promise.all(
      result.rows.map(
        async (
          campaign: any
        ) => {
          const crossings =
            await db.execute({
              sql: `
                SELECT
                  crossing_id
                FROM campaign_crossings
                WHERE campaign_id = ?
              `,
              args: [
                campaign.id,
              ],
            });
const creative =
  await db.execute({
    sql: `
      SELECT
        image_url,
        title,
        target_url
      FROM creatives
      WHERE campaign_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `,
    args: [
      campaign.id,
    ],
  });
          return {
  ...campaign,

  crossings:
    crossings.rows.map(
      (row: any) =>
        row.crossing_id
    ),

  creative:
    creative.rows?.[0] ??
    null,
};
        }
      )
    );

  return Response.json(
    campaigns
  );
}

export async function POST(
  request: Request
) {
  try {
    const body =
      await request.json();

    console.log(
      "campaign body",
      body
    );

    const campaignId =
      id();
console.log([
  campaignId,
  body.customerId,
  body.name,
  body.billingModel,
  body.cpm,
  body.fixedPrice,
  body.budget,
  body.targetImpressions,
  body.priority,
  body.startDate,
  body.endDate,
]);
    await db.execute({
      sql: `
        INSERT INTO campaigns (
          id,
          customer_id,
          name,
          billing_model,
          cpm,
          fixed_price,
          budget,
          target_impressions,
          priority,
          active,
          start_date,
          end_date,
          created_at
        )
        VALUES (
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          1,
          ?,
          ?,
          datetime('now')
        )
      `,
      args: [
  campaignId,

  body.customerId,

  body.name,

  body.billingModel,

  body.cpm ?? null,

  body.fixedPrice ?? null,

  body.budget ?? null,

  body.targetImpressions ?? null,

  body.priority ?? 1,

  body.startDate ?? null,

  body.endDate ?? null,
],
    });

    return Response.json({
      ok: true,
      id: campaignId,
    });
  } catch (error) {
    console.error(
      "CAMPAIGN ERROR",
      error
    );

    return Response.json(
      {
        error:
          String(error),
      },
      {
        status: 500,
      }
    );
  }
}
