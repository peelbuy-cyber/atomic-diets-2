// api/generate-report.js
// Generates the personalized health transformation plan using Anthropic Claude.
// Returns strict JSON for the frontend dashboard.

import Stripe from "stripe"; // (not used, but safe to remove later if you want)

function buildPrompt(input) {
  const {
    goal,
    name,
    age,
    gender,
    heightCm,
    weightKg,
    activityLevel,
    country,
    dietType,
    workoutTiming
  } = input;

  return `
You are an expert fitness nutrition coach and health content writer.

Generate a COMPLETE personalized health transformation plan for the user below.

IMPORTANT REQUIREMENTS:
1) Output MUST be valid JSON only (no markdown, no extra text).
2) Include a "healthScore" integer from 0 to 100.
3) Include "timeline" as monthly target weights for 4 months:
   Month 1, Month 2, Month 3, Month 4.
4) Include "mayHaveRiskFactors" as an array of strings.
   - Each string MUST start with: "may have risk factors associated with"
   - Never use medical diagnoses (never say "you have diabetes", etc.)
5) Include meal plan:
   - "mealPlan7Days": an array of 7 days.
   - Each day has "meals": 3 meals with keys:
     - time (8am/1pm/7pm style)
     - mealName
     - portionsGrams (object with item->grams)
     - calories
     - macros (protein_g, carbs_g, fat_g)
6) Include workout plan:
   - "workoutPlan7Days": an array of 7 days.
   - Each day has "workouts": list of exercises.
   - Each exercise must include:
     - exerciseName
     - sets
     - reps
     - restSeconds
     - howToPerform (short)
     - estimatedCaloriesBurned
   - Include "workoutTiming" preference in each day output if possible.
7) Weekly grocery list:
   - "weeklyGroceryList": an array of items with approx totals.

Return JSON schema:
{
  "healthScore": number,
  "fullHealthAnalysis": {
    "summary": string,
    "whatToFocusOn": string[],
    "consistencyPlan": string
  },
  "timeline": {
    "month1Kg": number,
    "month2Kg": number,
    "month3Kg": number,
    "month4Kg": number,
    "milestones": string[]
  },
  "mayHaveRiskFactors": string[],
  "mealPlan7Days": [
    {
      "dayLabel": "Day 1",
      "meals": [
        {
          "time": "8am",
          "mealName": "string",
          "portionsGrams": { "item": 0 },
          "calories": 0,
          "macros": { "protein_g": 0, "carbs_g": 0, "fat_g": 0 }
        }
      ]
    }
  ],
  "weeklyGroceryList": [
    {"item":"string","approxTotal":"string"}
  ],
  "workoutPlan7Days": [
    {
      "dayLabel": "Day 1",
      "workoutTiming": "Morning|Afternoon|Evening|string",
      "workouts": [
        {
          "exerciseName":"string",
          "sets":0,
          "reps":0,
          "restSeconds":0,
          "howToPerform":"string",
          "estimatedCaloriesBurned":0
        }
      ]
    }
  ]
}

USER DATA:
- Name: ${name}
- Goal: ${goal}
- Age: ${age}
- Gender: ${gender}
- HeightCm: ${heightCm}
- CurrentWeightKg: ${weightKg}
- ActivityLevel: ${activityLevel}
- Country: ${country}
- DietType: ${dietType}
- WorkoutTiming: ${workoutTiming}

Now generate the JSON.`;
}

async function callAnthropic(prompt) {
  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 5000,
      temperature: 0.4,
      messages: [{ role: "user", content: prompt }]
    })
  });

  const text = await anthropicRes.text();
  if (!anthropicRes.ok) {
    throw new Error(`Anthropic API error ${anthropicRes.status}: ${text.slice(0, 1200)}`);
  }

  const data = JSON.parse(text);
  const contentText = data?.content?.[0]?.text;
  if (!contentText) throw new Error("Unexpected Anthropic response format (missing content[0].text)");

  // Claude should output JSON only. Still, handle if it includes wrappers.
  let reportJson;
  try {
    reportJson = JSON.parse(contentText);
  } catch (e) {
    // Try to extract first {...} block
    const firstBrace = contentText.indexOf("{");
    const lastBrace = contentText.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1) {
      reportJson = JSON.parse(contentText.slice(firstBrace, lastBrace + 1));
    } else {
      throw new Error("AI did not return valid JSON. " + (e?.message || String(e)));
    }
  }

  return reportJson;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const input = req.body || {};
    const required = ["goal", "name", "age", "gender", "heightCm", "weightKg", "activityLevel", "country", "dietType", "workoutTiming"];
    for (const k of required) {
      if (input[k] === undefined || input[k] === null || input[k] === "") {
        return res.status(400).json({ error: `Missing field: ${k}` });
      }
    }

    const prompt = buildPrompt(input);

    const report = await callAnthropic(prompt);

    return res.status(200).json({ report });
  } catch (err) {
    console.error("generate-report error:", err);
    return res.status(500).json({ error: err?.message || "Server error" });
  }
}2) Include a "healthScore" integer from 0 to 100.
3) Include "timeline" as monthly target weights for 4 months:
   Month 1, Month 2, Month 3, Month 4.
4) Include "mayHaveRiskFactors" as an array of strings.
   - Each string MUST start with: "may have risk factors associated with"
   - Never use medical diagnoses (never say "you have diabetes", etc.)
5) Include meal plan:
   - "mealPlan7Days": an array of 7 days.
   - Each day has "meals": 3 meals with keys:
     - time (8am/1pm/7pm style)
     - mealName
     - portionsGrams (object with item->grams)
     - calories
     - macros (protein_g, carbs_g, fat_g)
   - "weeklyGroceryList": an array of items with approximate total grams/units.
6) Include workout plan:
   - "workoutPlan7Days": an array of 7 days.
   - Each day has "workouts": list of exercises.
   - Each exercise must include:
     - exerciseName
     - sets
     - reps
     - restSeconds
     - howToPerform (short)
     - estimatedCaloriesBurned
   - Include "workoutTiming" preference.
7) Keep content actionable, safe, and generic enough for educational guidance.

USER DATA:
- Name: ${name}
- Goal: ${goal}
- Age: ${age}
- Gender: ${gender}
- HeightCm: ${heightCm}
- CurrentWeightKg: ${weightKg}
- ActivityLevel: ${activityLevel}
- Country: ${country}
- DietType: ${dietType}
- WorkoutTiming: ${workoutTiming}

Return JSON schema:
{
  "healthScore": number,
  "fullHealthAnalysis": {
    "summary": string,
    "whatToFocusOn": string[],
    "consistencyPlan": string
  },
  "timeline": {
    "month1Kg": number,
    "month2Kg": number,
    "month3Kg": number,
    "month4Kg": number,
    "milestones": string[]
  },
  "mayHaveRiskFactors": string[],
  "mealPlan7Days": [
    {
      "dayLabel": "Day 1",
      "meals": [
        {
          "time": "8am",
          "mealName": "string",
          "portionsGrams": {"item":"grams"},
          "calories": number,
          "macros": {"protein_g": number, "carbs_g": number, "fat_g": number}
        },
        {
          "time": "1pm",
          "mealName": "string",
          "portionsGrams": {"item":"grams"},
          "calories": number,
          "macros": {"protein_g": number, "carbs_g": number, "fat_g": number}
        },
        {
          "time": "7pm",
          "mealName": "string",
          "portionsGrams": {"item":"grams"},
          "calories": number,
          "macros": {"protein_g": number, "carbs_g": number, "fat_g": number}
        }
      ]
    }
  ],
  "weeklyGroceryList": [
    {"item":"string","approxTotal":"string"}
  ],
  "workoutPlan7Days": [
    {
      "dayLabel": "Day 1",
      "workouts": [
        {
          "exerciseName": "string",
          "sets": number,
          "reps": number,
          "restSeconds": number,
          "howToPerform": "string",
          "estimatedCaloriesBurned": number
        }
      ],
      "workoutTiming": "string"
    }
  ]
}

Now generate the JSON.`;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const promptInput = req.body || {};

    const required = ["goal", "name", "age", "gender", "heightCm", "weightKg", "activityLevel", "country", "dietType", "workoutTiming"];
    for (const k of required) {
      if (promptInput[k] === undefined || promptInput[k] === null || promptInput[k] === "") {
        return res.status(400).json({ error: `Missing field: ${k}` });
      }
    }

    const prompt = buildPrompt(promptInput);

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 5000,
        temperature: 0.4,
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      })
    });

    const text = await anthropicRes.text();
    if (!anthropicRes.ok) {
      return res.status(500).json({
        error: "Anthropic API error",
        status: anthropicRes.status,
        details: text
      });
    }

    const data = JSON.parse(text);

    // Anthropic returns content blocks; we need the text
    const contentText = data?.content?.[0]?.text;
    if (!contentText) {
      return res.status(500).json({ error: "Unexpected Anthropic response format", data });
    }

    // Content must be JSON only; parse it
    let reportJson;
    try {
      reportJson = JSON.parse(contentText);
    } catch (e) {
      return res.status(500).json({
        error: "AI did not return valid JSON",
        raw: contentText.slice(0, 2000),
        parseError: e?.message || String(e)
      });
    }

    return res.status(200).json({ report: reportJson });
  } catch (err) {
    console.error("generate-report error:", err);
    return res.status(500).json({ error: err?.message || "Server error" });
  }
}  bmi,
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
