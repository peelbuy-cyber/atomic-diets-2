// api/verify-payment.js
// Verifies whether a given Stripe customer has an active subscription.

import Stripe from "stripe";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const { stripeCustomerId } = req.body || {};
    if (!stripeCustomerId) {
      return res.status(400).json({ error: "Missing stripeCustomerId" });
    }

    // List subscriptions for this customer and find an active one.
    // Stripe API returns the latest subscriptions; we check status.
    const subs = await stripe.subscriptions.list({
      customer: stripeCustomerId,
      status: "active",
      expand: ["data.items.data.price"],
      limit: 10
    });

    const activeSub = subs?.data?.[0] || null;

    // If you want more robustness later, we can check item price IDs, plan types, etc.
    const result = {
      isPro: !!activeSub,
      subscription: activeSub
        ? {
            id: activeSub.id,
            status: activeSub.status,
            current_period_end: activeSub.current_period_end,
            items: (activeSub.items?.data || []).map(it => ({
              priceId: it.price?.id,
              quantity: it.quantity
            }))
          }
        : null
    };

    return res.status(200).json(result);
  } catch (err) {
    console.error("verify-payment error:", err);
    return res.status(500).json({ error: err?.message || "Server error" });
  }
}
