export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
    const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'atomic-diets';

    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${userId}?key=${FIREBASE_API_KEY}`;

    const response = await fetch(url);
    if (!response.ok) return res.status(200).json({ isPro: false });

    const data = await response.json();
    const isPro = data.fields?.isPro?.booleanValue === true;

    return res.status(200).json({ isPro });

  } catch (error) {
    console.error('Verify error:', error);
    return res.status(500).json({ isPro: false });
  }
}
