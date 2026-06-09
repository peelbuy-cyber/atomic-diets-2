export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

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
  } = req.body;

  if (!userId || !idToken) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // --- Verify Firebase ID token via REST ---
  try {
    const verifyRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${process.env.FIREBASE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken })
      }
    );
    const verifyData = await verifyRes.json();
    if (!verifyData.users || verifyData.users[0].localId !== userId) {
      return res.status(401).json({ error: "Invalid token" });
    }
  } catch (e) {
    return res.status(401).json({ error: "Token verification failed" });
  }

  const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${process.env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;

  // --- Check report limit for personal plan ---
  if (planType === "personal") {
    try {
      const limitsRes = await fetch(
        `${FIRESTORE_BASE}/users/${userId}/limits/reportLimits`,
        { headers: { Authorization: `Bearer ${idToken}` } }
      );
      const limitsData = await limitsRes.json();

      if (limitsData.fields) {
        const count = parseInt(limitsData.fields.reportsThisMonth?.integerValue || "0");
        const resetDate = limitsData.fields.reportResetDate?.stringValue;
        const now = new Date();
        const reset = resetDate ? new Date(resetDate) : null;

        // Reset counter if past reset date
        if (!reset || now > reset) {
          // Counter will be reset below after generation
        } else if (count >= 3) {
          return res.status(429).json({
            error: "Report limit reached",
            message: "Personal plan allows 3 reports per month. Upgrade to Trainer plan for unlimited reports.",
            resetsOn: resetDate
          });
        }
      }
    } catch (e) {
      // If no limits doc exists yet, allow generation
    }
  }

  // --- Determine meal region from country ---
  const regionMap = {
    "India": "South Asia", "Pakistan": "South Asia", "Bangladesh": "South Asia",
    "Sri Lanka": "South Asia", "Nepal": "South Asia",
    "Nigeria": "West Africa", "Ghana": "West Africa", "Senegal": "West Africa",
    "Côte d'Ivoire": "West Africa", "Cameroon": "West Africa",
    "Thailand": "Southeast Asia", "Vietnam": "Southeast Asia", "Indonesia": "Southeast Asia",
    "Philippines": "Southeast Asia", "Malaysia": "Southeast Asia", "Singapore": "Southeast Asia",
    "Saudi Arabia": "Middle East", "UAE": "Middle East", "Egypt": "Middle East",
    "Jordan": "Middle East", "Lebanon": "Middle East", "Iraq": "Middle East",
    "Mexico": "Latin America", "Brazil": "Latin America", "Colombia": "Latin America",
    "Argentina": "Latin America", "Peru": "Latin America", "Chile": "Latin America",
    "Ethiopia": "East Africa", "Kenya": "East Africa", "Tanzania": "East Africa",
    "Uganda": "East Africa", "Rwanda": "East Africa",
    "United States": "Western", "United Kingdom": "Western", "Canada": "Western",
    "Australia": "Western", "Germany": "Western", "France": "Western",
    "Italy": "Western", "Spain": "Western", "Netherlands": "Western"
  };
  const mealRegion = regionMap[country] || "Universal";

  // --- Build BMI and calorie context ---
  const heightM = parseFloat(height) / 100;
  const weightKg = parseFloat(weight);
  const bmi = (weightKg / (heightM * heightM)).toFixed(1);

  const activityMultipliers = {
    sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9
  };
  const multiplier = activityMultipliers[activityLevel] || 1.55;
  const bmrBase = gender === "female"
    ? 447.593 + (9.247 * weightKg) + (3.098 * parseFloat(height)) - (4.330 * parseFloat(age))
    : 88.362 + (13.397 * weightKg) + (4.799 * parseFloat(height)) - (5.677 * parseFloat(age));
  const tdee = Math.round(bmrBase * multiplier);
  const targetCalories = goal === "lose_weight" ? tdee - 500 : goal === "gain_muscle" ? tdee + 300 : tdee;

  // --- Build Claude prompt ---
  const prompt = `You are an expert nutritionist and personal trainer. Generate a complete, highly personalised health plan for:

Name: ${name}
Age: ${age}
Gender: ${gender}
Height: ${height}cm
Weight: ${weight}kg
BMI: ${bmi}
Country: ${country} (Meal Region: ${mealRegion})
Primary Goal: ${goal}
Activity Level: ${activityLevel}
Dietary Restrictions: ${dietaryRestrictions || "None"}
Health Conditions: ${healthConditions || "None"}
Daily Calorie Target: ${targetCalories} kcal
TDEE: ${tdee} kcal

Return ONLY valid JSON — no markdown, no explanation, no backticks. Structure exactly:

{
  "healthAnalysis": {
    "bmi": "${bmi}",
    "bmiCategory": "",
    "bmiVsHealthyRange": "",
    "timelineToGoal": "",
    "keyRisks": [],
    "ageSpecificConcerns": [],
    "genderSpecificRisks": [],
    "priorityActions": []
  },
  "mealPlan": {
    "dailyCalories": ${targetCalories},
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
- Meal Plan: All 7 days (Monday–Sunday). Use culturally appropriate foods for ${mealRegion} region. Exact grams for every ingredient. 4–5 meals per day. Real food names.
- Workout Plan: All 7 days. Rest days have light activity (walk/stretch). Exact sets, reps, rest times. Clear instructions.
- Health Analysis: Be specific. Real timelines (e.g. "8–10 weeks to lose 5kg at current deficit"). Real risks based on age/gender/BMI. No generic filler.
- JSON must be 100% valid. No trailing commas. No comments.`;

  // --- Call Claude API ---
  let generatedData;
  try {
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8000,
        messages: [{ role: "user", content: prompt }]
      })
    });

    const claudeData = await claudeRes.json();

    if (claudeData.error) {
      return res.status(500).json({ error: "Claude API error", detail: claudeData.error.message });
    }

    const rawText = claudeData.content[0].text.trim();
    // Strip any accidental markdown fences
    const cleaned = rawText.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
    generatedData = JSON.parse(cleaned);
  } catch (e) {
    return res.status(500).json({ error: "Failed to generate or parse report", detail: e.message });
  }

  // --- Save to Firestore via REST ---
  const now = new Date();
  const dateKey = now.toISOString().split("T")[0];

  const reportDocument = {
    fields: {
      userId: { stringValue: userId },
      generatedAt: { stringValue: now.toISOString() },
      dateKey: { stringValue: dateKey },
      userInputs: {
        mapValue: {
          fields: {
            name: { stringValue: name || "" },
            age: { integerValue: parseInt(age) },
            gender: { stringValue: gender || "" },
            height: { doubleValue: parseFloat(height) },
            weight: { doubleValue: parseFloat(weight) },
            country: { stringValue: country || "" },
            goal: { stringValue: goal || "" },
            activityLevel: { stringValue: activityLevel || "" },
            dietaryRestrictions: { stringValue: dietaryRestrictions || "" },
            healthConditions: { stringValue: healthConditions || "" },
            mealRegion: { stringValue: mealRegion },
            bmi: { stringValue: bmi },
            targetCalories: { integerValue: targetCalories }
          }
        }
      },
      reportData: { stringValue: JSON.stringify(generatedData) }
    }
  };

  try {
    await fetch(
      `${FIRESTORE_BASE}/users/${userId}/reports/${dateKey}?updateMask.fieldPaths=userId&updateMask.fieldPaths=generatedAt&updateMask.fieldPaths=dateKey&updateMask.fieldPaths=userInputs&updateMask.fieldPaths=reportData`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify(reportDocument)
      }
    );
  } catch (e) {
    // Non-fatal — still return the data even if save fails
    console.error("Firestore save failed:", e.message);
  }

  // --- Update report usage counter ---
  if (planType === "personal") {
    try {
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      await fetch(
        `${FIRESTORE_BASE}/users/${userId}/limits/reportLimits`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`
          },
          body: JSON.stringify({
            fields: {
              reportsThisMonth: { integerValue: 1 },
              reportResetDate: { stringValue: nextMonth.toISOString() },
              lastReportDate: { stringValue: now.toISOString() }
            }
          })
        }
      );

      // Attempt increment by fetching current value first
      const limitsRes = await fetch(
        `${FIRESTORE_BASE}/users/${userId}/limits/reportLimits`,
        { headers: { Authorization: `Bearer ${idToken}` } }
      );
      const limitsData = await limitsRes.json();
      if (limitsData.fields) {
        const currentCount = parseInt(limitsData.fields.reportsThisMonth?.integerValue || "0");
        const resetDate = limitsData.fields.reportResetDate?.stringValue;
        const isExpired = !resetDate || new Date() > new Date(resetDate);
        await fetch(
          `${FIRESTORE_BASE}/users/${userId}/limits/reportLimits`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${idToken}`
            },
            body: JSON.stringify({
              fields: {
                reportsThisMonth: { integerValue: isExpired ? 1 : currentCount + 1 },
                reportResetDate: { stringValue: isExpired ? new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString() : resetDate },
                lastReportDate: { stringValue: now.toISOString() }
              }
            })
          }
        );
      }
    } catch (e) {
      console.error("Limit update failed:", e.message);
    }
  }

  return res.status(200).json({
    success: true,
    dateKey,
    report: generatedData
  });
}
