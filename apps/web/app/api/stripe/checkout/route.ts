import { randomUUID } from "crypto";
import { auth } from "../../../../auth";
import { authDb } from "../../../lib/auth-db";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";

const APP_URL = (process.env.NEXTAUTH_URL || process.env.AUTH_URL || "https://meineschranke.de").replace(/\/$/, "");

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Bitte melde dich erneut an." }, { status: 401 });
  }

  const secret = process.env.STRIPE_SECRET_KEY;
  const taxRateId = process.env.STRIPE_TAX_RATE_ID;
  if (!secret || !taxRateId) {
    return Response.json({ error: "Der Bezahlvorgang ist noch nicht vollständig eingerichtet." }, { status: 503 });
  }

  const configRows = await authDb.all<{
    premium_package_slots: number;
    premium_package_price_cents: number;
    premium_package_currency: string;
    premium_package_duration_days: number;
    premium_enabled: number;
  }>(sql`
    SELECT premium_package_slots, premium_package_price_cents,
      premium_package_currency, premium_package_duration_days, premium_enabled
    FROM subscription_config WHERE id = 1 LIMIT 1
  `);
  const config = configRows[0];
  if (!config || Number(config.premium_enabled) !== 1) {
    return Response.json({ error: "Das Zusatzpaket ist derzeit noch nicht freigeschaltet." }, { status: 403 });
  }

  const slots = Number(config.premium_package_slots);
  const amount = Number(config.premium_package_price_cents);
  const currency = String(config.premium_package_currency || "eur").toLowerCase();
  const durationDays = Number(config.premium_package_duration_days);
  if (!Number.isInteger(slots) || slots < 1 || !Number.isInteger(amount) || amount < 1 ||
      !Number.isInteger(durationDays) || durationDays < 1 || currency !== "eur") {
    return Response.json({ error: "Die Paketkonfiguration ist ungültig." }, { status: 500 });
  }

  const purchaseId = randomUUID();
  await authDb.run(sql`
    INSERT INTO user_crossing_purchases
      (id, user_id, package_slots, amount_cents, currency, status)
    VALUES
      (${purchaseId}, ${session.user.id}, ${slots}, ${amount}, ${currency.toUpperCase()}, 'pending')
  `);

  try {
    const form = new URLSearchParams();
    form.set("mode", "payment");
    form.set("client_reference_id", session.user.id);
    form.set("success_url", `${APP_URL}/app/meine-schranken?payment=success`);
    form.set("cancel_url", `${APP_URL}/app/meine-schranken?payment=cancelled`);
    form.set("line_items[0][quantity]", "1");
    form.set("line_items[0][price_data][currency]", currency);
    form.set("line_items[0][price_data][unit_amount]", String(amount));
    form.set("line_items[0][price_data][product_data][name]", `10 zusätzliche Schranken-Plätze`);
    form.set("line_items[0][price_data][product_data][description]", `Zusätzliche persönliche Bahnübergänge für ${durationDays} Tage`);
    form.append("line_items[0][tax_rates][0]", taxRateId);
    form.set("invoice_creation[enabled]", "true");
    form.set("metadata[purchaseId]", purchaseId);
    form.set("metadata[userId]", session.user.id);
    form.set("metadata[packageSlots]", String(slots));
    form.set("metadata[durationDays]", String(durationDays));
    form.set("payment_intent_data[metadata][purchaseId]", purchaseId);
    form.set("payment_intent_data[metadata][userId]", session.user.id);

    if (session.user.email) form.set("customer_email", session.user.email);

    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${secret}:`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": `crossings-purchase-${purchaseId}`,
      },
      body: form,
      cache: "no-store",
    });
    const checkout = await response.json();
    if (!response.ok || !checkout?.url || !checkout?.id) {
      console.error("[STRIPE] Checkout session creation failed:", checkout?.error?.message || response.status);
      throw new Error("Der Bezahlvorgang konnte nicht gestartet werden. Bitte versuche es später erneut.");
    }

    await authDb.run(sql`
      UPDATE user_crossing_purchases
      SET stripe_checkout_session_id = ${checkout.id}, updated_at = datetime('now')
      WHERE id = ${purchaseId} AND user_id = ${session.user.id}
    `);

    return Response.json({ url: checkout.url });
  } catch (error) {
    await authDb.run(sql`
      UPDATE user_crossing_purchases
      SET status = 'failed', updated_at = datetime('now')
      WHERE id = ${purchaseId} AND status = 'pending'
    `);
    return Response.json({
      error: error instanceof Error ? error.message : "Der Bezahlvorgang konnte nicht gestartet werden.",
    }, { status: 502 });
  }
}
