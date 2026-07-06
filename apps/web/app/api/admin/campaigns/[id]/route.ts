import { db } from "@/app/lib/db";

export async function PATCH(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      id: string;
    }>;
  }
) {
  const body =
    await request.json();

  const { id } =
    await params;

  await db.execute({
    sql: `
      UPDATE campaigns
      SET
        customer_id = ?,
        name = ?,
        billing_model = ?,
        cpm = ?,
        budget = ?,
        priority = ?,
        start_date = ?,
        end_date = ?
      WHERE id = ?
    `,
    args: [
      body.customerId,
      body.name,
      body.billingModel,
      body.cpm ?? null,
      body.budget ?? null,
      body.priority ?? 1,
      body.startDate,
      body.endDate,
      id,
    ],
  });

  return Response.json({
    ok: true,
  });
}
export async function DELETE(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      id: string;
    }>;
  }
) {
  const { id } =
    await params;

  await db.execute({
    sql: `
      DELETE FROM campaign_crossings
      WHERE campaign_id = ?
    `,
    args: [id],
  });

  await db.execute({
    sql: `
      DELETE FROM creatives
      WHERE campaign_id = ?
    `,
    args: [id],
  });

  await db.execute({
    sql: `
      DELETE FROM campaigns
      WHERE id = ?
    `,
    args: [id],
  });

  return Response.json({
    ok: true,
  });
}