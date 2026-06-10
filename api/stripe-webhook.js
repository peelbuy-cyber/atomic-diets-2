// api/stripe-webhook.js
// Stripe Webhook endpoint for Atomic Diets

import Stripe from "stripe";

export default async function handler(req, res) {
  // Webhooks require raw body for signature verification.
  // Vercel/Next-like environments provide body parsing; to keep compatibility,
  // we attempt to use req.body as-is and also allow string fallback.
  try {
    if (req.method !== "POST") {
      return res.status(405).send("Method not allowed");
    }

    const sig = req.headers["stripe-signature"];
    if (!sig) {
      return res.status(400).send("Missing stripe-signature header");
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      return res.status(500).send("Missing STRIPE_WEBHOOK_SECRET env var");
    }

    // If your platform supplies parsed JSON, signature verification will fail.
    // In Vercel, you may need to disable body parsing for this function.
    // For now we try to reconstruct raw body if possible.
    const rawBody =
      typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});

    const event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);

    // Handle the event types we care about
    // (You can expand later.)
    const eventType = event.type;
    const obj = event.data?.object || {};

    console.log("[stripe webhook] type:", eventType);

    // Common objects:
    // - checkout.session.completed (Checkout)
    // - customer.subscription.created/updated/deleted
    // - invoice.payment_succeeded
    //
    // We will primarily log identifiers and metadata now.
    // Later we will connect to Firebase REST calls for mapping userId <-> stripeCustomerId.

    if (eventType === "checkout.session.completed") {
      console.log("[stripe webhook] checkout.session.completed:", {
        sessionId: obj.id,
        customerId: obj.customer,
        subscriptionId: obj.subscription,
        metadata: obj.metadata
      });
    }

    if (
      eventType === "customer.subscription.created" ||
      eventType === "customer.subscription.updated"
    ) {
      console.log("[stripe webhook] subscription event:", {
        subscriptionId: obj.id,
        customerId: obj.customer,
        status: obj.status,
        metadata: obj.metadata
      });
    }

    // Return 200 quickly to acknowledge receipt
    res.status(200).json({ received: true });
  } catch (err) {
    console.error("stripe webhook error:", err?.message || err);
    // Signature mismatch returns 400
    return res.status(400).send(`Webhook Error: ${err?.message || "Bad Request"}`);
  }
}    else if (typeof value === 'number') fields[key] = { integerValue: value };
    else fields[key] = { stringValue: String(value) };
  }

  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${userId}?key=${FIREBASE_API_KEY}&updateMask.fieldPaths=${Object.keys(data).join('&updateMask.fieldPaths=')}`;

  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields })
  });

  return response.ok;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

  try {
    const rawBody = await getRawBody(req);
    const rawBodyStr = rawBody.toString('utf8');
    const signature = req.headers['stripe-signature'];

    // Verify webhook signature
    const isValid = await verifyStripeSignature(rawBodyStr, signature, WEBHOOK_SECRET);
    if (!isValid) {
      console.error('Invalid webhook signature');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const event = JSON.parse(rawBodyStr);
    console.log('Webhook event:', event.type);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const userId = session.metadata?.userId;
      const customerId = session.customer;
      const subscriptionId = session.subscription;

      if (!userId) {
        console.error('No userId in session metadata');
        return res.status(400).json({ error: 'No userId found' });
      }

      // Update Firebase — mark user as Pro
      const updated = await updateFirebase(userId, {
        isPro: true,
        stripeCustomerId: customerId || '',
        subscriptionId: subscriptionId || '',
        proSince: new Date().toISOString()
      });

      if (updated) {
        console.log('User upgraded to Pro:', userId);
      } else {
        console.error('Firebase update failed for user:', userId);
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      // Subscription cancelled — revoke Pro access
      const subscription = event.data.object;
      const userId = subscription.metadata?.userId;
      if (userId) {
        await updateFirebase(userId, { isPro: false });
        console.log('Pro access revoked for user:', userId);
      }
    }

    if (event.type === 'invoice.payment_failed') {
      // Payment failed — you could send email here
      console.log('Payment failed for customer:', event.data.object.customer);
    }

    return res.status(200).json({ received: true });

  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: 'Webhook handler failed' });
  }
}
