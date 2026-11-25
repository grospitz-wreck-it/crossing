import { db } from "@/app/lib/db";

function id() { return crypto.randomUUID(); }

export async function GET() {
  const result = await db.execute("SELECT customers.id, customers.name, customers.active, customers.created_at, COUNT(DISTINCT campaigns.id) AS campaign_count, COUNT(DISTINCT CASE WHEN campaigns.start_date <= date('now') AND (campaigns.end_date IS NULL OR campaigns.end_date >= date('now')) THEN campaigns.id END) AS running_campaign_count, COUNT(DISTINCT CASE WHEN campaigns.active = 1 THEN campaigns.id END) AS active_campaign_count, COALESCE(SUM(CASE WHEN upper(campaigns.billing_model) = 'CPM' THEN (SELECT COUNT(*) FROM impressions WHERE impressions.campaign_id = campaigns.id) * COALESCE(campaigns.cpm, 0) / 1000.0 WHEN upper(campaigns.billing_model) = 'FIXED' THEN COALESCE(campaigns.fixed_price, 0) ELSE 0 END), 0) AS calculated_revenue FROM customers LEFT JOIN campaigns ON campaigns.customer_id = customers.id GROUP BY customers.id, customers.name, customers.active, customers.created_at ORDER BY customers.name COLLATE NOCASE ASC");
  return Response.json(result.rows);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const name = String(body.name ?? "").trim();
    if (!name) return Response.json({ error: "Bitte einen Kundennamen eingeben." }, { status: 400 });
    const customerId = id();
    await db.execute({
      sql: "INSERT INTO customers (id, name, active, created_at) VALUES (?, ?, 1, datetime('now'))",
      args: [customerId, name],
    });
    return Response.json({ ok: true, id: customerId });
  } catch (error) {
    console.error("CUSTOMER ERROR", error);
    return Response.json({ error: String(error) }, { status: 500 });
  }
}