// /api/generate-report.js
// POST-only. Generates report via Claude, enforces monthly limits (personal plan),
// saves to Firestore via REST.
// Expects req.body to include:
// - userId, idToken, name, age, gender, height, weight, country, goal,
//   activityLevel, dietaryRestrictions, healthConditions, planType
//
// IMPORTANT: Do not paste secrets into the repo.
// This function uses env vars:
// - ANTHROPIC_API_KEY
// - FIREBASE_API_KEY
// - FIREBASE_PROJECT_ID

const jsonError = (res, status, error, details) => {
  res.status(status).json({ success: false, error, ...(details ? { details } : {}) });
};

const requireEnv = (name, value) => {
  if (!value) throw new Error(`Missing env var: ${name}`);
};

const normalizeNumber = (v, fallback = 0) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const isoDateKey = (d = new Date()) => {
  return d.toISOString().slice(0, 10);
};

function buildClaudePrompt({
  name,
  age,
  gender,
  height,
  weight,
  bmi,
  country,
  mealRegion,
  goal,
  activityLevel,
  dietaryRestrictions,
  healthConditions,
  targetCalories,
  tdee
}) {
  return `You are an expert nutritionist and personal trainer. Generate a complete, highly personalised health plan for:

Name: ${name || "N/A"}
Age: ${age ?? "N/A"}
Gender: ${gender || "N/A"}
Height: ${height ?? "N/A"}cm
Weight: ${weight ?? "N/A"}kg
BMI: ${bmi}
Country: ${country || "N/A"} (Meal Region: ${mealRegion})
Primary Goal: ${goal || "N/A"}
Activity Level: ${activityLevel || "N/A"}
Dietary Restrictions: ${dietaryRestrictions || "None"}
Health Conditions: ${healthConditions || "None"}
Daily Calorie Target: ${targetCalories} kcal
TDEE: ${tdee} kcal

Return ONLY valid JSON â€” no markdown, no explanation, no backticks. Structure exactly:

{
  "healthAnalysis": {
    "bmi": "${String(bmi)}",
    "bmiCategory": "",
    "bmiVsHealthyRange": "",
    "timelineToGoal": "",
    "keyRisks": [],
    "ageSpecificConcerns": [],
    "genderSpecificRisks": [],
    "priorityActions": []
  },
  "mealPlan": {
    "dailyCalories": ${Number(targetCalories)},
    "macroTargets": { "proteinG": 0, "carbsG": 0, "fatG": 0 },
    "mealTiming": "",
    "days": [
      {
        "day": "Monday",
        "meals": [
          {
            "time": "",
            "name": "",
            "ingredients": [{ "item": "", "grams": 0 }],
            "calories": 0,
            "protein": 0,
            "carbs": 0,
            "fat": 0,
            "prepTip": ""
          }
        ],
        "dayTotals": { "calories": 0, "protein": 0, "carbs": 0, "fat": 0 }
      }
    ]
  },
  "workoutPlan": {
    "weeklySchedule": [
      {
        "day": "Monday",
        "focus": "",
        "estimatedCaloriesBurned": 0,
        "duration": "",
        "exercises": [
          {
            "name": "",
            "sets": 0,
            "reps": "",
            "restSeconds": 0,
            "instructions": "",
            "musclesWorked": []
          }
        ]
      }
    ],
    "progressionTip": "",
    "weeklyCaloriesBurned": 0
  }
}

Rules:
- Meal Plan: All 7 days (Mondayâ€“Sunday). Use culturally appropriate foods for ${mealRegion} region. Exact grams for every ingredient. 4â€“5 meals per day. Real food names.
- Workout Plan: All 7 days. Rest days have light activity (walk/stretch). Exact sets, reps, rest times. Clear instructions.
- Health Analysis: Be specific. Real timelines (e.g. "8â€“10 weeks to lose 5kg at current deficit"). Real risks based on age/gender/BMI. No generic filler.
- JSON must be 100% valid. No trailing commas. No comments.`;
}

async function callClaude(anthropicApiKey, prompt) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicApiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8000,
      messages: [{ role: "user", content: prompt }]
    })
  });

  const text = await r.text();
  if (!r.ok) {
    throw new Error(`Claude request failed: ${r.status} ${r.statusText} - ${text.slice(0, 1000)}`);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Claude returned non-JSON response.");
  }

  const rawText =
    data?.content?.[0]?.text ||
    (typeof data?.content?.[0] === "string" ? data.content[0] : null);

  if (!rawText || typeof rawText !== "string") {
    throw new Error("Claude returned no text content.");
  }

  const cleaned = rawText
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  // Extract first JSON object if Claude included extra text
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  const jsonString = firstBrace !== -1 && lastBrace !== -1 ? cleaned.slice(firstBrace, lastBrace + 1) : cleaned;

  try {
    return JSON.parse(jsonString);
  } catch (e) {
    throw new Error(`Failed to parse Claude JSON: ${e.message}`);
  }
}

// Convert JS values to Firestore REST "fields" format (minimal)
function toFirestoreValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "number") {
    if (Number.isInteger(v)) return { integerValue: String(v) };
    return { doubleValue: v };
  }
  if (typeof v === "boolean") return { booleanValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFirestoreValue) } };
  if (typeof v === "object") {
    const fields = {};
    for (const [k, val] of Object.entries(v)) fields[k] = toFirestoreValue(val);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

async function firestorePatchDoc({ projectId, apiKey, docPath, fields }) {
  // PATCH document
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    projectId
  )}/databases/(default)/documents/${docPath}?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields })
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Firestore PATCH failed: ${res.status} ${res.statusText} - ${t.slice(0, 1000)}`);
  }
  return true;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return jsonError(res, 405, "Method not allowed");

    const {
      userId,
      idToken,
      name,
      age,
      gender,
      height,
      weight,
      country,
      goal,
      activityLevel,
      dietaryRestrictions,
      healthConditions,
      planType
    } = req.body || {};

    if (!userId || !idToken) return jsonError(res, 401, "Unauthorized", { missing: "userId or idToken" });

    // Env
    requireEnv("ANTHROPIC_API_KEY", process.env.ANTHROPIC_API_KEY);
    requireEnv("FIREBASE_PROJECT_ID", process.env.FIREBASE_PROJECT_ID);
    requireEnv("FIREBASE_API_KEY", process.env.FIREBASE_API_KEY);

    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    const firebaseProjectId = process.env.FIREBASE_PROJECT_ID;
    const firebaseApiKey = process.env.FIREBASE_API_KEY;

    // Meal region mapping (same as your earlier mapping; kept as-is)
    const regionMap = {
      India: "South Asia",
      Pakistan: "South Asia",
      Bangladesh: "South Asia",
      "Sri Lanka": "South Asia",
      Nepal: "South Asia",
      Nigeria: "West Africa",
      Ghana: "West Africa",
      Senegal: "West Africa",
      "CÃ´te d'Ivoire": "West Africa",
      Cameroon: "West Africa",
      Thailand: "Southeast Asia",
      Vietnam: "Southeast Asia",
      Indonesia: "Southeast Asia",
      Philippines: "Southeast Asia",
      Malaysia: "Southeast Asia",
      Singapore: "Southeast Asia",
      "Saudi Arabia": "Middle East",
      UAE: "Middle East",
      Egypt: "Middle East",
      Jordan: "Middle East",
      Lebanon: "Middle East",
      Iraq: "Middle East",
      Mexico: "Latin America",
      Brazil: "Latin America",
      Colombia: "Latin America",
      Argentina: "Latin America",
      Peru: "Latin America",
      Chile: "Latin America",
      Ethiopia: "East Africa",
      Kenya: "East Africa",
      Tanzania: "East Africa",
      Uganda: "East Africa",
      Rwanda: "East Africa",
      "United States": "Western",
      "United Kingdom": "Western",
      Canada: "Western",
      Australia: "Western",
      Germany: "Western",
      France: "Western",
      Italy: "Western",
      Spain: "Western",
      Netherlands: "Western"
    };
    const mealRegion = regionMap[country] || "Universal";

    // Basic BMI + calories context
    const ageN = normalizeNumber(age, 0);
    const heightCm = normalizeNumber(height, 0);
    const weightKg = normalizeNumber(weight, 0);

    const heightM = heightCm / 100;
    const bmi = heightM > 0 ? Number((weightKg / (heightM * heightM)).toFixed(1)) : 0;

    const activityMultipliers = {
      sedentary: 1.2,
      light: 1.375,
      moderate: 1.55,
      active: 1.725,
      very_active: 1.9
    };
    const multiplier = activityMultipliers[activityLevel] || 1.55;

    const genderStr = (gender || "").toLowerCase();
    const bmrBase =
      genderStr === "female"
        ? 447.593 + 9.247 * weightKg + 3.098 * heightCm - 4.330 * ageN
        : 88.362 + 13.397 * weightKg + 4.799 * heightCm - 5.677 * ageN;

    const tdee = Math.round(bmrBase * multiplier);
    const targetCalories =
      goal === "lose_weight" ? tdee - 500 : goal === "gain_muscle" ? tdee + 300 : tdee;

    // PERSONAL PLAN LIMITS (best-effort: do NOT block if limits doc missing)
    const now = new Date();
    const dateKey = isoDateKey(now);

    if (planType === "personal") {
      // Read limits doc
      const limitsDocPath = `users/${encodeURIComponent(userId)}/limits/reportLimits`;
      const getUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
        firebaseProjectId
      )}/databases/(default)/documents/${limitsDocPath}?key=${encodeURIComponent(firebaseApiKey)}`;

      try {
        const limitsRes = await fetch(getUrl, {
          method: "GET",
          headers: { Authorization: `Bearer ${idToken}` }
        });

        if (limitsRes.ok) {
          const limitsData = await limitsRes.json();
          const fields = limitsData?.fields || {};
          const count = parseInt(fields?.reportsThisMonth?.integerValue || "0", 10);
          const resetDate = fields?.reportResetDate?.stringValue;
          const reset = resetDate ? new Date(resetDate) : null;

          const nowD = new Date();
          const isExpired = !reset || nowD > reset;

          if (!isExpired && count >= 3) {
            return jsonError(res, 429, "Report limit reached", {
              message: "Personal plan allows 3 reports per month. Upgrade to Trainer plan for unlimited reports.",
              resetsOn: resetDate || null
            });
          }
        }
      } catch {
        // If limits check fails, we still generate to avoid breaking the app.
      }
    }

    const prompt = buildClaudePrompt({
      name,
      age: ageN,
      gender,
      height: heightCm,
      weight: weightKg,
      bmi: String(bmi),
      country,
      mealRegion,
      goal,
      activityLevel,
      dietaryRestrictions,
      healthConditions,
      targetCalories,
      tdee
    });

    const generated = await callClaude(anthropicApiKey, prompt);

    // Save report to Firestore
    const reportDocPath = `users/${encodeURIComponent(userId)}/reports/${encodeURIComponent(dateKey)}`;

    // Store generatedData as a string to avoid Firestore struct mismatches
    const fields = {
      userId: toFirestoreValue(userId),
      generatedAt: toFirestoreValue(now.toISOString()),
      dateKey: toFirestoreValue(dateKey),
      userInputs: toFirestoreValue({
        name: name || "",
        age: ageN,
        gender: gender || "",
        heightCm: heightCm,
        weightKg: weightKg,
        country: country || "",
        goal: goal || "",
        activityLevel: activityLevel || "",
        dietaryRestrictions: dietaryRestrictions || "",
        healthConditions: healthConditions || "",
        mealRegion
      }),
      reportData: toFirestoreValue(generated)
    };

    await firestorePatchDoc({
      projectId: firebaseProjectId,
      apiKey: firebaseApiKey,
      docPath: reportDocPath,
      fields
    });

    // Update usage counter (best-effort)
    if (planType === "personal") {
      const limitsDocPath = `users/${encodeURIComponent(userId)}/limits/reportLimits`;
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

      try {
        // Best-effort increment: set to 1 if missing / expired, else increment.
        // We do a read-then-write to avoid relying on FieldValue transforms.
        const getUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
          firebaseProjectId
        )}/databases/(default)/documents/${limitsDocPath}?key=${encodeURIComponent(firebaseApiKey)}`;

        let currentCount = 0;
        let resetDateStr = null;

        const curRes = await fetch(getUrl, {
          method: "GET",
          headers: { Authorization: `Bearer ${idToken}` }
        });

        if (curRes.ok) {
          const cur = await curRes.json();
          const f = cur?.fields || {};
          currentCount = parseInt(f?.reportsThisMonth?.integerValue || "0", 10);
          resetDateStr = f?.reportResetDate?.stringValue || null;
        }

        const reset = resetDateStr ? new Date(resetDateStr) : null;
        const isExpired = !reset || new Date() > reset;

        const nextCount = isExpired ? 1 : currentCount + 1;
        const resetTo = isExpired ? nextMonth.toISOString() : resetDateStr;

        // PATCH
        const patchUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
          firebaseProjectId
        )}/databases/(default)/documents/${limitsDocPath}?key=${encodeURIComponent(firebaseApiKey)}`;

        await fetch(patchUrl, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`
          },
          body: JSON.stringify({
            fields: {
              reportsThisMonth: { integerValue: String(nextCount) },
              reportResetDate: { stringValue: resetTo || nextMonth.toISOString() },
              lastReportDate: { stringValue: now.toISOString() }
            }
          })
        });
      } catch {
        // Non-fatal
      }
    }

    return res.status(200).json({
      success: true,
      dateKey,
      report: generated
    });
  } catch (e) {
    return jsonError(res, 500, "Generate report failed", String(e?.message || e));
  }
}
