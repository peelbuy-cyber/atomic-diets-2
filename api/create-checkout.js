// api/create-checkout.js
// Creates a Stripe Checkout Session for Atomic Diets subscriptions.

import Stripe from "stripe";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const body = req.body || {};
    const { plan, priceId } = body;

    // Your Stripe Price IDs (from the spec)
    const PRICE_MONTHLY = "price_1TgkZyFiax9ZHkWkVWVZypoe"; // Pro Monthly $24.99
    const PRICE_YEARLY = "price_1TgkalFiax9ZHkWk4Vm8CqYO";  // Pro Yearly $199
    const PRICE_TRAINER_MONTHLY = "price_1Tgkt6Fiax9ZHkWkdTSfViDb"; // Trainer Pro $97

    let finalPriceId = priceId || null;

    if (!finalPriceId) {
      if (plan === "pro_monthly") finalPriceId = PRICE_MONTHLY;
      if (plan === "pro_yearly") finalPriceId = PRICE_YEARLY;
      if (plan === "trainer_monthly") finalPriceId = PRICE_TRAINER_MONTHLY;
    }

    if (!finalPriceId) {
      return res.status(400).json({ error: "Invalid plan or missing priceId" });
    }

    const baseUrl = process.env.BASE_URL;
    if (!baseUrl) {
      return res.status(500).json({ error: "Missing BASE_URL env var" });
    }

    const email = body.email || undefined;

    // Note: We set success/cancel URLs to success.html.
    // Webhook will later mark the user as Pro (we haven’t wired Firebase updates yet).
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: finalPriceId, quantity: 1 }],
      allow_promotion_codes: true,
      customer_email: email,

      success_url: `${baseUrl}/success.html?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/success.html?checkout=cancel`,

      automatic_tax: { enabled: true },

      metadata: {
        app: "atomic-diets",
        plan: plan || "unknown"
      }
    });

    return res.status(200).json({ url: session.url, sessionId: session.id });
  } catch (error) {
    console.error("Checkout error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
