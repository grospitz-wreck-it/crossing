import { createHmac, timingSafeEqual } from "crypto";
import { authDb } from "../../../lib/auth-db";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";

function verifyStripeSignature(payload: string, header: string, secret: string) {
  const parts = header.split(",").map((part) => part.trim().split("="));
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!timestamp || signatures.length === 0) return false;

  const timestampNumber = Number(timestamp);
  if (!Number.isFinite(timestampNumber) || Math.abs(Date.now() / 1000 - timestampNumber) > 300) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`, "utf8").digest();
  return signatures.some((signature) => {
    if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
    const received = Buffer.from(signature, "hex");
    return received.length === expected.length && timingSafeEqual(received, expected);
  });
}

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[STRIPE] STRIPE_WEBHOOK_SECRET is missing");
    return Response.json({ error: "Webhook is not configured" }, { status: 503 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature") || "";
  if (!verifyStripeSignature(rawBody, signature, secret)) {
    return Response.json({ error: "Invalid Stripe signature" }, { status: 400 });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid event payload" }, { status: 400 });
  }
  if (!event?.id || !event?.type) {
    return Response.json({ error: "Invalid event" }, { status: 400 });
  }

  const checkoutSession = event.data?.object;
  const checkoutSessionId = typeof checkoutSession?.id === "string" ? checkoutSession.id : null;

  try {
    await authDb.transaction(async (tx) => {
      const inserted = await tx.run(sql`
        INSERT OR IGNORE INTO stripe_webhook_events (id, event_type, checkout_session_id)
        VALUES (${event.id}, ${event.type}, ${checkoutSessionId})
      `);
      if (Number(inserted.rowsAffected || 0) === 0) return;

      const isPaidEvent =
        event.type === "checkout.session.async_payment_succeeded" ||
        (event.type === "checkout.session.completed" && checkoutSession?.payment_status === "paid");

      const isFailedEvent =
        event.type === "checkout.session.async_payment_failed" ||
        event.type === "checkout.session.expired";

      if (!checkoutSessionId || (!isPaidEvent && !isFailedEvent)) return;
      if (
        checkoutSession?.mode !== "payment" ||
        !checkoutSession?.metadata?.purchaseId ||
        !checkoutSession?.metadata?.userId
      ) {
        throw new Error("Stripe Checkout event does not match the one-time slot purchase flow.");
      }

      const purchaseId = String(checkoutSession.metadata.purchaseId);
      const userId = String(checkoutSession.metadata.userId);
      const metadataSlots = Number(checkoutSession.metadata.packageSlots);
      const durationDays = Number(checkoutSession.metadata.durationDays);
      const paymentIntentId = typeof checkoutSession.payment_intent === "string"
        ? checkoutSession.payment_intent
        : checkoutSession.payment_intent?.id || null;

      const purchaseRows = await tx.all<{
        package_slots: number;
        amount_cents: number;
        currency: string;
        status: string;
      }>(sql`
        SELECT package_slots, amount_cents, currency, status
        FROM user_crossing_purchases
        WHERE id = ${purchaseId}
          AND user_id = ${userId}
          AND stripe_checkout_session_id = ${checkoutSessionId}
        LIMIT 1
      `);
      const purchase = purchaseRows[0];
      if (!purchase) {
        throw new Error("Matching local purchase record not found for Stripe Checkout session.");
      }

      if (
        metadataSlots !== 10 ||
        metadataSlots !== Number(purchase.package_slots) ||
        durationDays !== 365 ||
        String(checkoutSession.client_reference_id || "") !== userId
      ) {
        throw new Error("Stripe Checkout metadata does not match the 10-slot / 365-day offer.");
      }

      if (isPaidEvent) {
        const amountSubtotal = Number(checkoutSession.amount_subtotal);
        const eventCurrency = String(checkoutSession.currency || "").toUpperCase();
        if (
          checkoutSession.payment_status !== "paid" ||
          amountSubtotal !== Number(purchase.amount_cents) ||
          eventCurrency !== String(purchase.currency).toUpperCase()
        ) {
          throw new Error("Paid Checkout Session amount or currency does not match the local purchase.");
        }

        await tx.run(sql`
          UPDATE user_crossing_purchases
          SET status = 'paid',
              stripe_payment_intent_id = ${paymentIntentId},
              purchased_at = datetime('now'),
              valid_until = datetime('now', '+' || ${durationDays} || ' days'),
              updated_at = datetime('now')
          WHERE id = ${purchaseId}
            AND user_id = ${userId}
            AND stripe_checkout_session_id = ${checkoutSessionId}
            AND status = 'pending'
        `);
      } else if (isFailedEvent) {
        await tx.run(sql`
          UPDATE user_crossing_purchases
          SET status = 'failed', updated_at = datetime('now')
          WHERE id = ${purchaseId}
            AND user_id = ${userId}
            AND stripe_checkout_session_id = ${checkoutSessionId}
            AND status = 'pending'
        `);
      }
    });
  } catch (error) {
    console.error("[STRIPE] Webhook processing failed:", error);
    return Response.json({ error: "Webhook processing failed" }, { status: 500 });
  }

  return Response.json({ received: true });
}
