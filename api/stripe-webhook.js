export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function verifyStripeSignature(rawBody, signature, secret) {
  const encoder = new TextEncoder();
  const parts = signature.split(',');
  let timestamp = '';
  let sigHash = '';
  for (const part of parts) {
    if (part.startsWith('t=')) timestamp = part.slice(2);
    if (part.startsWith('v1=')) sigHash = part.slice(3);
  }
  const payload = `${timestamp}.${rawBody}`;
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const computed = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  return computed === sigHash;
}

async function updateFirebase(userId, data) {
  const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
  const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'atomic-diets';

  const fields = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'boolean') fields[key] = { booleanValue: value };
    else if (typeof value === 'number') fields[key] = { integerValue: value };
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
