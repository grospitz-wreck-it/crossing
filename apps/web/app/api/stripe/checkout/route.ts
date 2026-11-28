import { randomBytes, randomUUID } from "crypto";
import { auth } from "../../../../auth";
import { authDb } from "../../../lib/auth-db";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { billingCountry?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Bitte bestätige dein Rechnungsland." }, { status: 400 });
  }
  if (body?.billingCountry !== "DE") {
    return Response.json({ error: "Der Kauf ist zum Start nur mit einer Rechnungsadresse in Deutschland möglich." }, { status: 400 });
  }

  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Bitte melde dich erneut an." }, { status: 401 });
  }

  const secret = process.env.STRIPE_SECRET_KEY;
  const taxRateId = process.env.STRIPE_TAX_RATE_ID;
  if (!secret || !taxRateId) {
    return Response.json(
      { error: "Der Bezahlvorgang ist noch nicht vollständig eingerichtet." },
      { status: 503 },
    );
  }

  // Launch uses one fixed, inclusive 19% German VAT rate. Stripe Tax remains off.
  const taxRateResponse = await fetch("https://api.stripe.com/v1/tax_rates/" + encodeURIComponent(taxRateId), {
    headers: { Authorization: "Basic " + Buffer.from(secret + ":").toString("base64") },
    cache: "no-store",
  });
  const taxRate = await taxRateResponse.json();
  if (
    !taxRateResponse.ok ||
    taxRate?.active !== true ||
    taxRate?.country !== "DE" ||
    taxRate?.inclusive !== true ||
    Number(taxRate?.percentage) !== 19
  ) {
    console.error("[STRIPE] Tax rate must be active, German, inclusive, and 19 percent.");
    return Response.json(
      { error: "Die deutsche Umsatzsteuerregel ist noch nicht korrekt eingerichtet." },
      { status: 503 },
    );
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

  // This offer is deliberately fixed to ten extra crossing slots for 365 days.
  // Price can be changed later without accidentally changing the purchased entitlement.
  if (
    slots !== 10 ||
    durationDays !== 365 ||
    !Number.isInteger(amount) ||
    amount < 1 ||
    currency !== "eur"
  ) {
    return Response.json(
      { error: "Die Paketkonfiguration muss 10 zusätzliche Plätze für 365 Tage in EUR enthalten." },
      { status: 500 },
    );
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
    form.set("origin_context", "web");
    form.set("locale", "de");
    form.set("client_reference_id", session.user.id);
    form.set("customer_creation", "always");
    form.set("billing_address_collection", "required");
    form.set("invoice_creation[enabled]", "true");
    form.set("invoice_creation[invoice_data][description]", "10 zusätzliche Schranken-Plätze für 365 Tage");
    form.set("success_url", `${(process.env.NEXTAUTH_URL || process.env.AUTH_URL || new URL(request.url).origin).replace(/\/$/, "")}/app/meine-schranken?payment=success`);
    form.set("cancel_url", `${(process.env.NEXTAUTH_URL || process.env.AUTH_URL || new URL(request.url).origin).replace(/\/$/, "")}/app/meine-schranken?payment=cancelled`);
    form.set("line_items[0][quantity]", "1");
    form.set("line_items[0][price_data][currency]", currency);
    form.set("line_items[0][price_data][unit_amount]", String(amount));
    form.set("line_items[0][price_data][product_data][name]", "10 zusätzliche Schranken-Plätze · 365 Tage");
    form.set(
      "line_items[0][price_data][product_data][description]",
      "Einmaliger Kauf von 10 zusätzlichen persönlichen Bahnübergängen für 365 Tage. Keine automatische Verlängerung.",
    );
    form.set("metadata[purchaseId]", purchaseId);
    form.set("metadata[userId]", session.user.id);
    form.set("metadata[packageSlots]", String(slots));
    form.set("metadata[durationDays]", String(durationDays));
    form.set("metadata[billingCountry]", "DE");
    form.set("payment_intent_data[metadata][purchaseId]", purchaseId);
    form.set("payment_intent_data[metadata][userId]", session.user.id);

    form.append("line_items[0][tax_rates][0]", taxRateId);

    if (session.user.email) form.set("customer_email", session.user.email);

    const suffix = Array.from(randomBytes(8), (byte) => String.fromCharCode(97 + (byte % 26))).join("");
    form.set("integration_identifier", `meineschranke-${suffix}`);

    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${secret}:`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Stripe-Version": "2026-11-18.endive",
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
