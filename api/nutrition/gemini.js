/**
 * Server-Side Google Gemini Direct Nutrition Analysis Engine
 * 
 * Powered by the official Google Gen AI SDK (@google/genai):
 * - Decomposes unstructured natural-language food descriptions into individual ingredients.
 * - Extracts foodName, entered quantity, unit, preparation, estimated grams, calories,
 *   protein, carbohydrates, fat, fibre, and estimation notes.
 * - Dynamically calculates nutrients based on actual portion weights (doubling weight doubles nutrients).
 * - Distinguishes dry oats from overnight-soaked wet oats with explicit assumptions and clarifications.
 * - Distinguishes fresh table grapes from dried raisins (dry grapes / kishmish).
 * - Derives meal totals strictly by summing individual ingredient values.
 * - Supports Indian and South Indian staples (idli, sambar, dosa, roti, dal, rice, chicken, eggs, etc.).
 * - Rejects malformed compound sentence responses and retries once with strict instructions.
 * - Validates non-negative numbers, finite values, and plausible ranges.
 * - Gracefully handles missing keys, quota exhaustion (RESOURCE_EXHAUSTED), billing errors, and timeouts.
 * - Keeps GEMINI_API_KEY strictly server-side.
 */

import { GoogleGenAI, Type } from '@google/genai';

let geminiClient = null;
let lastApiKey = null;

/**
 * Returns an authenticated GoogleGenAI client singleton.
 */
export function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    return null;
  }
  if (!geminiClient || lastApiKey !== apiKey.trim()) {
    lastApiKey = apiKey.trim();
    geminiClient = new GoogleGenAI({
      apiKey: lastApiKey
    });
  }
  return geminiClient;
}

/**
 * Structured output JSON schema for Gemini model.
 */
export const GEMINI_NUTRITION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    items: {
      type: Type.ARRAY,
      description: "List of individual, decomposed food items. NEVER lump multiple ingredients into one item.",
      items: {
        type: Type.OBJECT,
        properties: {
          foodName: {
            type: Type.STRING,
            description: "Standard canonical individual food name (e.g., 'Oats', 'Almonds', 'Fresh Grapes', 'Boiled Eggs', 'Idli', 'Sambar', 'Cooked White Rice', 'Chicken Breast'). NEVER include conjunctions or multiple items."
          },
          originalText: {
            type: Type.STRING,
            description: "The specific clause or phrase from the user input describing this ingredient"
          },
          quantity: {
            type: Type.NUMBER,
            description: "Entered or inferred numeric quantity count"
          },
          unit: {
            type: Type.STRING,
            description: "Measurement unit ('g', 'ml', 'piece', 'cup', 'bowl', 'tbsp', 'serving', etc.)"
          },
          preparation: {
            type: Type.STRING,
            description: "Preparation or cooking method ('overnight-soaked', 'raw', 'boiled', 'cooked', 'steamed', 'roasted', etc.)"
          },
          estimatedGrams: {
            type: Type.NUMBER,
            description: "Estimated net weight in grams or millilitres for this specific portion"
          },
          calories: {
            type: Type.NUMBER,
            description: "Estimated energy in kcal for this portion"
          },
          protein: {
            type: Type.NUMBER,
            description: "Estimated protein in grams"
          },
          carbohydrates: {
            type: Type.NUMBER,
            description: "Estimated total carbohydrates in grams"
          },
          fat: {
            type: Type.NUMBER,
            description: "Estimated total fat in grams"
          },
          fibre: {
            type: Type.NUMBER,
            description: "Estimated dietary fibre in grams"
          },
          notes: {
            type: Type.STRING,
            description: "Brief estimation note or assumption for this ingredient"
          },
          clarificationQuestions: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Concise questions if missing details or ambiguities materially affect nutrition"
          }
        },
        required: [
          "foodName",
          "quantity",
          "unit",
          "preparation",
          "estimatedGrams",
          "calories",
          "protein",
          "carbohydrates",
          "fat",
          "fibre"
        ]
      }
    },
    totals: {
      type: Type.OBJECT,
      properties: {
        calories: { type: Type.NUMBER },
        protein: { type: Type.NUMBER },
        carbohydrates: { type: Type.NUMBER },
        fat: { type: Type.NUMBER },
        fibre: { type: Type.NUMBER }
      },
      required: ["calories", "protein", "carbohydrates", "fat", "fibre"]
    },
    isEstimate: {
      type: Type.BOOLEAN,
      description: "Always true for AI-generated estimates"
    },
    notes: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Overall assumptions or reconciliation notes across the entire meal"
    }
  },
  required: ["items", "totals", "isEstimate"]
};

export const GEMINI_SYSTEM_PROMPT = `You are a clinical nutrition semantic parser and macro calculator for OpenGym.
Your task is to analyze natural-language food descriptions and produce structured, ingredient-level nutritional estimates.

CRITICAL RULES:
1. DECOMPOSE MULTI-INGREDIENT MEALS:
   - You MUST return an array of separate food items for each ingredient mentioned.
   - NEVER place the complete sentence or multiple foods joined by "with", "and", "+", or commas into a single item.
   - For example: "200 g overnight-soaked oats with 5 almonds and 5 grapes" MUST produce 3 separate items:
     1) Oats
     2) Almonds
     3) Grapes

2. ACCURATE FOOD IDENTIFICATION & AMBIGUITY RESOLUTION:
   - "badam" -> Almonds
   - "dry grapes", "kishmish", "kismis" -> Raisins (dried grapes). If the user writes "grapes", clarify whether fresh table grapes or dried raisins.
   - "oats" -> Rolled Oats. Distinguish dry oats before soaking from prepared soaked oats with absorbed water.
   - "idli", "dosa", "sambar", "rasam", "pongal", "chapati", "roti", "paratha", "paneer", "dal", "chawal", "curd", "dahi", "egg", "chicken" -> Support Indian & South Indian dishes accurately.

3. DYNAMIC QUANTITIES & PROPORTIONAL MACROS:
   - When the user explicitly specifies a quantity (e.g. 200 g, 5 pieces, 2 idlis), calculate nutrition for THAT EXACT quantity. Never revert to a fixed 100 g default when another portion was stated.
   - Doubling an ingredient's weight must approximately double its calories and macros.
   - 100 g dry oats ≈ 389 kcal, 16.9g protein, 66.3g carbs, 6.9g fat, 10.6g fibre.
   - 200 g dry oats ≈ 778 kcal, 33.8g protein, 132.6g carbs, 13.8g fat, 21.2g fibre.
   - 1 almond (badam kernel) ≈ 1.2 g, ~7 kcal. 5 almonds ≈ 6 g, ~35 kcal.
   - 1 fresh grape ≈ 5.0 g, ~3.5 kcal. 5 fresh grapes ≈ 25 g, ~17 kcal.
   - 1 standard boiled egg ≈ 50 g, ~78 kcal, 6.3g protein, 0.6g carbs, 5.3g fat.
   - 1 idli (medium, ~50 g) ≈ 66 kcal, 2.0g protein, 14.0g carbs, 0.2g fat.
   - 1 cup / bowl sambar (~150 g) ≈ 110 kcal, 4.5g protein, 16.0g carbs, 3.2g fat.
   - 100 g cooked white rice ≈ 130 kcal, 2.7g protein, 28.2g carbs, 0.3g fat.
   - 150 g cooked chicken breast ≈ 248 kcal, 46.5g protein, 0.0g carbs, 5.4g fat.

4. NO INVENTED INGREDIENTS:
   - Do NOT add optional cooking oils, milk, sugar, or toppings unless the user explicitly mentioned or confirmed them.

5. ACCURATE RECONCILIATION:
   - Total calories and macronutrients must strictly equal the exact mathematical sum of the individual ingredient values.
   - Mark isEstimate = true.

6. CLARIFICATIONS & ASSUMPTIONS:
   - Include concise clarification questions for substantial ambiguities (e.g. dry oats before soaking vs soaked wet weight, fresh grapes vs dried raisins).
`;

export const RETRY_GEMINI_SYSTEM_PROMPT = `${GEMINI_SYSTEM_PROMPT}

IMPORTANT WARNING: Your previous response was rejected because multiple foods were combined into one item or the entire input sentence was treated as one food.
You MUST split the meal into separate ingredients now. Return a distinct object in "items" for EACH food.`;

/**
 * Detects whether a foodName field contains conjunctions or represents a compound sentence.
 */
export function isCompoundSentenceItem(foodName, rawInput) {
  if (!foodName) return false;
  const f = foodName.trim().toLowerCase();
  const raw = String(rawInput || '').trim().toLowerCase();

  // If the food name is virtually the full input sentence
  if (raw.length > 15 && f === raw) {
    return true;
  }

  // Check for conjunctions joining distinct food clauses
  const compoundPatterns = [
    /\bwith\b/i,
    /\band\b/i,
    /\bplus\b/i,
    /\balong with\b/i,
    /\bserved with\b/i,
    /,/
  ];

  const knownSingleDishes = [
    'mac and cheese',
    'fish and chips',
    'cookies and cream',
    'beans on toast',
    'pork and beans'
  ];

  if (knownSingleDishes.some(dish => f.includes(dish))) {
    return false;
  }

  return compoundPatterns.some(pat => pat.test(f));
}

/**
 * Validates, checks bounds, and mathematically reconciles structured Gemini output.
 */
export function validateAndNormalizeNutritionResponse(rawJson, rawInput) {
  if (!rawJson || typeof rawJson !== 'object') {
    throw new Error('Invalid Gemini response: Expected a structured JSON object.');
  }

  const rawItems = Array.isArray(rawJson.items) ? rawJson.items : [];
  if (rawItems.length === 0) {
    throw new Error('No food items identified in meal description. Please provide a description with specific foods or ingredients.');
  }

  // Reject compound items that lump multi-food sentences into one item
  for (const item of rawItems) {
    const candidateName = item.foodName || item.canonical_food_name || item.name || '';
    if (isCompoundSentenceItem(candidateName, rawInput) && rawItems.length === 1) {
      throw new Error(`Malformed nutrition analysis: Gemini returned "${candidateName}" as a single ingredient. Multi-ingredient meals must be decomposed into separate items.`);
    }
  }

  const items = [];
  const clarifications = [];

  for (let idx = 0; idx < rawItems.length; idx++) {
    const item = rawItems[idx];
    const foodName = String(item.foodName || item.canonical_food_name || item.name || `Food ${idx + 1}`).trim();
    const originalText = String(item.originalText || item.original_text || foodName).trim();
    const quantity = Math.max(0.01, +(item.quantity ?? item.explicit_quantity ?? 1));
    const unit = String(item.unit || item.quantity_unit || 'serving').trim().toLowerCase();
    const preparation = String(item.preparation || item.prep_state || 'prepared').trim().toLowerCase();
    const estimatedGrams = Math.max(0.1, +(item.estimatedGrams ?? item.estimated_weight_g ?? (unit === 'g' ? quantity : 100)));

    const calories = Math.max(0, +(item.calories ?? item.energy_kcal ?? 0));
    const protein = Math.max(0, +(item.protein ?? item.protein_g ?? 0));
    const carbohydrates = Math.max(0, +(item.carbohydrates ?? item.carb_g ?? 0));
    const fat = Math.max(0, +(item.fat ?? item.fat_g ?? 0));
    const fibre = Math.max(0, +(item.fibre ?? item.fibre_g ?? 0));

    // Plausibility check: calories must not be impossibly negative or astronomical
    if (!Number.isFinite(calories) || calories > 10000) {
      throw new Error(`Unreasonable caloric value calculated for ${foodName}: ${calories} kcal.`);
    }

    const itemNotes = String(item.notes || '').trim();
    const assumptions = Array.isArray(item.assumptions)
      ? item.assumptions.map(String)
      : (itemNotes ? [itemNotes] : []);

    const clarificationQuestions = Array.isArray(item.clarificationQuestions ?? item.clarification_questions)
      ? (item.clarificationQuestions ?? item.clarification_questions).map(String).filter(Boolean)
      : [];

    for (const q of clarificationQuestions) {
      clarifications.push(`${foodName}: ${q}`);
    }

    const normalizedItem = {
      // Primary fields matching the requested Gemini specification
      foodName,
      originalText,
      quantity: Math.round(quantity * 100) / 100,
      unit,
      preparation,
      estimatedGrams: Math.round(estimatedGrams * 10) / 10,
      calories: Math.round(calories * 10) / 10,
      protein: Math.round(protein * 10) / 10,
      carbohydrates: Math.round(carbohydrates * 10) / 10,
      fat: Math.round(fat * 10) / 10,
      fibre: Math.round(fibre * 10) / 10,
      notes: itemNotes,
      assumptions,
      clarificationQuestions,

      // Compatibility aliases for existing UI and tests
      canonical_food_name: foodName,
      ingredient_name: foodName,
      original_text: originalText,
      explicit_quantity: Math.round(quantity * 100) / 100,
      quantity_unit: unit,
      estimated_weight_g: Math.round(estimatedGrams * 10) / 10,
      prep_state: preparation,
      energy_kcal: Math.round(calories * 10) / 10,
      protein_g: Math.round(protein * 10) / 10,
      carb_g: Math.round(carbohydrates * 10) / 10,
      fat_g: Math.round(fat * 10) / 10,
      fibre_g: Math.round(fibre * 10) / 10,
      clarification_questions: clarificationQuestions,
      confidence: item.confidence || 'high',
      is_weight_estimated: item.is_weight_estimated ?? (unit !== 'g' && unit !== 'ml'),
      is_quantity_estimated: item.is_quantity_estimated ?? false
    };

    items.push(normalizedItem);
  }

  // Sum individual ingredient values directly (do NOT rely on independent model totals)
  const sumCalories = Math.round(items.reduce((acc, i) => acc + i.calories, 0) * 10) / 10;
  const sumProtein = Math.round(items.reduce((acc, i) => acc + i.protein, 0) * 10) / 10;
  const sumCarbs = Math.round(items.reduce((acc, i) => acc + i.carbohydrates, 0) * 10) / 10;
  const sumFat = Math.round(items.reduce((acc, i) => acc + i.fat, 0) * 10) / 10;
  const sumFibre = Math.round(items.reduce((acc, i) => acc + i.fibre, 0) * 10) / 10;

  const totals = {
    calories: sumCalories,
    protein: sumProtein,
    carbohydrates: sumCarbs,
    fat: sumFat,
    fibre: sumFibre,

    // Aliases for compatibility
    energy_kcal: sumCalories,
    protein_g: sumProtein,
    carb_g: sumCarbs,
    fat_g: sumFat,
    fibre_g: sumFibre
  };

  const rawNotes = Array.isArray(rawJson.notes)
    ? rawJson.notes.map(String)
    : (rawJson.reconciliation_notes ? [String(rawJson.reconciliation_notes)] : []);

  if (rawNotes.length === 0) {
    rawNotes.push(`Total meal nutrition (${sumCalories} kcal) reconciled by exact summation of ${items.length} ingredient items.`);
  }

  return {
    items,
    totals,
    isEstimate: true,
    is_ai_estimate: true,
    notes: rawNotes,
    reconciliation_notes: rawNotes[0] || `Reconciled from ${items.length} ingredients.`,
    overall_assumptions: rawNotes,
    clarifications,
    calculation_status: clarifications.length > 0 ? 'needs_clarification' : 'complete',
    input_summary: String(rawJson.input_summary || rawInput).trim(),
    provider: 'gemini',
    model: process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite'
  };
}

/**
 * Maps raw Gemini/GCP API errors to clear, safe user-facing error messages.
 */
export function mapGeminiError(err) {
  const msg = String(err?.message || '');
  const status = err?.status || err?.statusCode || 0;

  // 1. Quota exhaustion / rate limit
  if (
    status === 429 ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.toLowerCase().includes('quota') ||
    msg.toLowerCase().includes('rate limit')
  ) {
    const error = new Error('Google Gemini API quota exceeded or rate limit reached. Please check your Gemini account quota or try again shortly.');
    error.status = 429;
    error.isQuota = true;
    return error;
  }

  // 2. Invalid or missing API key
  if (
    (status === 400 && (msg.includes('API_KEY_INVALID') || msg.includes('API key not valid'))) ||
    status === 401 ||
    status === 403 ||
    msg.includes('PERMISSION_DENIED') ||
    msg.includes('API key')
  ) {
    const error = new Error('Authentication failed: Invalid GEMINI_API_KEY. Please verify your Gemini API key in the server configuration (.env).');
    error.status = 401;
    return error;
  }

  // 3. Billing restrictions
  if (msg.includes('BILLING_DISABLED') || msg.toLowerCase().includes('billing')) {
    const error = new Error('Google Cloud billing is not enabled or restricted for this Gemini project. Please check your GCP billing settings.');
    error.status = 402;
    return error;
  }

  // 4. Unsupported model name
  if (
    status === 404 ||
    msg.includes('NOT_FOUND') ||
    msg.toLowerCase().includes('model not found') ||
    msg.toLowerCase().includes('is not supported')
  ) {
    const configuredModel = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
    const error = new Error(`The configured Gemini model "${configuredModel}" is unsupported or not enabled for this project. Please configure a valid Flash model in GEMINI_MODEL (e.g. gemini-2.5-flash).`);
    error.status = 404;
    return error;
  }

  // 5. Timeout
  if (err.name === 'TimeoutError' || err.code === 'ETIMEDOUT') {
    const error = new Error('Google Gemini API request timed out. Please try again.');
    error.status = 504;
    return error;
  }

  // General safe error (never leak raw API keys, tokens, or private details)
  const safeMsg = msg.replace(/AIza[0-9A-Za-z-_]{35}/g, '[REDACTED_API_KEY]');
  const error = new Error(`Gemini nutrition analysis failed: ${safeMsg || 'Unknown service error'}`);
  error.status = status || 500;
  return error;
}

/**
 * Splits clauses in meal descriptions for deterministic mock execution and fallback testing.
 */
function splitMealClauses(text) {
  let normalized = text.replace(/\s+and\s+/gi, ' , ');
  normalized = normalized.replace(/\s+with\s+/gi, ' , ');
  normalized = normalized.replace(/\s+plus\s+/gi, ' , ');
  normalized = normalized.replace(/\s+along with\s+/gi, ' , ');

  return normalized
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/**
 * Extracts quantity and unit from a clause.
 */
function extractQtyAndUnit(clause) {
  const gMatch = clause.match(/(\d+(?:\.\d+)?)\s*(?:gm|gms|g|gram|grams)\b/i);
  if (gMatch) {
    return { qty: parseFloat(gMatch[1]), unit: 'g', hasExplicit: true };
  }

  const mlMatch = clause.match(/(\d+(?:\.\d+)?)\s*(?:ml|milliliter|millilitres)\b/i);
  if (mlMatch) {
    return { qty: parseFloat(mlMatch[1]), unit: 'ml', hasExplicit: true };
  }

  const tbspMatch = clause.match(/(\d+(?:\.\d+)?)\s*(?:tbsp|tablespoon|tablespoons)\b/i);
  if (tbspMatch) {
    return { qty: parseFloat(tbspMatch[1]), unit: 'tbsp', hasExplicit: true };
  }

  const pieceMatch = clause.match(/(\d+(?:\.\d+)?)\s*(?:piece|pieces|pc|pcs|badam|almonds|grapes|roti|rotis|idli|idlis|eggs?)\b/i);
  if (pieceMatch) {
    return { qty: parseFloat(pieceMatch[1]), unit: 'piece', hasExplicit: true };
  }

  const genericNum = clause.match(/\b(\d+(?:\.\d+)?)\b/);
  if (genericNum) {
    return { qty: parseFloat(genericNum[1]), unit: 'piece', hasExplicit: true };
  }

  return { qty: 1, unit: 'serving', hasExplicit: false };
}

/**
 * Deterministic reference analysis engine for testing, fixtures, and local dev.
 */
export function getMockNutritionAnalysis(text) {
  const clean = String(text || '').trim();
  const t = clean.toLowerCase();

  // 1. "100 g oats" or "200 g oats" (standalone)
  if (t.includes('oat') && !t.includes('badam') && !t.includes('almond') && !t.includes('grape') && !t.includes('banana')) {
    const { qty, unit, hasExplicit } = extractQtyAndUnit(clean);
    const oatsGrams = (hasExplicit && unit === 'g' ? qty : (qty > 10 ? qty : 100));
    const factor = oatsGrams / 100;
    const isSoaked = t.includes('soak');

    return {
      items: [
        {
          foodName: isSoaked ? 'Rolled Oats (Overnight Soaked)' : 'Rolled Oats',
          originalText: clean,
          quantity: oatsGrams,
          unit: 'g',
          preparation: isSoaked ? 'overnight-soaked' : 'raw',
          estimatedGrams: oatsGrams,
          calories: Math.round(389 * factor * 10) / 10,
          protein: Math.round(16.9 * factor * 10) / 10,
          carbohydrates: Math.round(66.3 * factor * 10) / 10,
          fat: Math.round(6.9 * factor * 10) / 10,
          fibre: Math.round(10.6 * factor * 10) / 10,
          notes: `Calculated for ${oatsGrams} g dry rolled oats.`,
          clarificationQuestions: isSoaked ? [`Did the ${oatsGrams} g refer to dry oats before soaking or prepared soaked weight?`] : []
        }
      ],
      totals: {
        calories: Math.round(389 * factor * 10) / 10,
        protein: Math.round(16.9 * factor * 10) / 10,
        carbohydrates: Math.round(66.3 * factor * 10) / 10,
        fat: Math.round(6.9 * factor * 10) / 10,
        fibre: Math.round(10.6 * factor * 10) / 10
      },
      isEstimate: true,
      notes: [`Portion scaled proportionally to ${oatsGrams} g.`]
    };
  }

  // 2. "2 boiled eggs"
  if (t.includes('egg') && !t.includes('rice') && !t.includes('chicken')) {
    const { qty } = extractQtyAndUnit(clean);
    const count = qty > 0 ? qty : 2;
    const grams = count * 50;
    const factor = count;

    return {
      items: [
        {
          foodName: 'Boiled Eggs',
          originalText: clean,
          quantity: count,
          unit: 'piece',
          preparation: 'boiled',
          estimatedGrams: grams,
          calories: Math.round(77.8 * factor * 10) / 10,
          protein: Math.round(6.3 * factor * 10) / 10,
          carbohydrates: Math.round(0.6 * factor * 10) / 10,
          fat: Math.round(5.3 * factor * 10) / 10,
          fibre: 0.0,
          notes: `Standard large hen egg ≈ 50 g (whole, hard-boiled).`,
          clarificationQuestions: []
        }
      ],
      totals: {
        calories: Math.round(77.8 * factor * 10) / 10,
        protein: Math.round(6.3 * factor * 10) / 10,
        carbohydrates: Math.round(0.6 * factor * 10) / 10,
        fat: Math.round(5.3 * factor * 10) / 10,
        fibre: 0.0
      },
      isEstimate: true,
      notes: [`Calculated for ${count} whole boiled eggs.`]
    };
  }

  // 3. "2 idlis with sambar"
  if (t.includes('idli') || (t.includes('sambar') && !t.includes('rice'))) {
    const clauses = splitMealClauses(clean);
    const items = [];

    // Idli item
    const idliClause = clauses.find(c => c.toLowerCase().includes('idli')) || '2 idlis';
    const { qty: idliCount } = extractQtyAndUnit(idliClause);
    const count = idliCount > 0 ? idliCount : 2;
    const idliGrams = count * 50;
    items.push({
      foodName: 'Idli',
      originalText: idliClause,
      quantity: count,
      unit: 'piece',
      preparation: 'steamed',
      estimatedGrams: idliGrams,
      calories: Math.round(66.0 * count * 10) / 10,
      protein: Math.round(2.0 * count * 10) / 10,
      carbohydrates: Math.round(14.0 * count * 10) / 10,
      fat: Math.round(0.2 * count * 10) / 10,
      fibre: Math.round(0.8 * count * 10) / 10,
      notes: `Standard South Indian steamed idli ≈ 50 g per piece.`,
      clarificationQuestions: []
    });

    // Sambar item
    const sambarClause = clauses.find(c => c.toLowerCase().includes('sambar')) || 'sambar';
    items.push({
      foodName: 'Sambar',
      originalText: sambarClause,
      quantity: 1,
      unit: 'bowl',
      preparation: 'boiled',
      estimatedGrams: 150,
      calories: 110.0,
      protein: 4.5,
      carbohydrates: 16.0,
      fat: 3.2,
      fibre: 3.8,
      notes: `Standard serving of lentil & vegetable sambar ≈ 150 g (1 katori / small bowl).`,
      clarificationQuestions: []
    });

    const sumCal = items.reduce((a, b) => a + b.calories, 0);
    const sumP = items.reduce((a, b) => a + b.protein, 0);
    const sumC = items.reduce((a, b) => a + b.carbohydrates, 0);
    const sumF = items.reduce((a, b) => a + b.fat, 0);
    const sumFib = items.reduce((a, b) => a + b.fibre, 0);

    return {
      items,
      totals: {
        calories: Math.round(sumCal * 10) / 10,
        protein: Math.round(sumP * 10) / 10,
        carbohydrates: Math.round(sumC * 10) / 10,
        fat: Math.round(sumF * 10) / 10,
        fibre: Math.round(sumFib * 10) / 10
      },
      isEstimate: true,
      notes: ['Traditional South Indian steamed idli and lentil sambar.']
    };
  }

  // 4. "100 g cooked rice with 150 g chicken breast"
  if (t.includes('rice') && t.includes('chicken') && !t.includes('oil')) {
    const clauses = splitMealClauses(clean);
    const items = [];

    const riceClause = clauses.find(c => c.toLowerCase().includes('rice')) || '100 g cooked rice';
    const { qty: rQty } = extractQtyAndUnit(riceClause);
    const riceGrams = rQty > 0 ? rQty : 100;
    const riceFactor = riceGrams / 100;
    items.push({
      foodName: 'Cooked White Rice',
      originalText: riceClause,
      quantity: riceGrams,
      unit: 'g',
      preparation: 'cooked',
      estimatedGrams: riceGrams,
      calories: Math.round(130.0 * riceFactor * 10) / 10,
      protein: Math.round(2.7 * riceFactor * 10) / 10,
      carbohydrates: Math.round(28.2 * riceFactor * 10) / 10,
      fat: Math.round(0.3 * riceFactor * 10) / 10,
      fibre: Math.round(0.4 * riceFactor * 10) / 10,
      notes: `Standard steamed white rice ≈ 130 kcal per 100 g.`,
      clarificationQuestions: []
    });

    const chickenClause = clauses.find(c => c.toLowerCase().includes('chicken')) || '150 g chicken breast';
    const { qty: cQty } = extractQtyAndUnit(chickenClause);
    const chickenGrams = cQty > 0 ? cQty : 150;
    const chickenFactor = chickenGrams / 100;
    items.push({
      foodName: 'Chicken Breast',
      originalText: chickenClause,
      quantity: chickenGrams,
      unit: 'g',
      preparation: 'cooked',
      estimatedGrams: chickenGrams,
      calories: Math.round(165.0 * chickenFactor * 10) / 10,
      protein: Math.round(31.0 * chickenFactor * 10) / 10,
      carbohydrates: 0.0,
      fat: Math.round(3.6 * chickenFactor * 10) / 10,
      fibre: 0.0,
      notes: `Skinless, boneless chicken breast ≈ 165 kcal per 100 g cooked.`,
      clarificationQuestions: []
    });

    const sumCal = items.reduce((a, b) => a + b.calories, 0);
    const sumP = items.reduce((a, b) => a + b.protein, 0);
    const sumC = items.reduce((a, b) => a + b.carbohydrates, 0);
    const sumF = items.reduce((a, b) => a + b.fat, 0);
    const sumFib = items.reduce((a, b) => a + b.fibre, 0);

    return {
      items,
      totals: {
        calories: Math.round(sumCal * 10) / 10,
        protein: Math.round(sumP * 10) / 10,
        carbohydrates: Math.round(sumC * 10) / 10,
        fat: Math.round(sumF * 10) / 10,
        fibre: Math.round(sumFib * 10) / 10
      },
      isEstimate: true,
      notes: ['Derived from 100 g cooked white rice and 150 g cooked chicken breast.']
    };
  }

  // 5. "100 g roasted peanuts"
  if (t.includes('peanut')) {
    const { qty } = extractQtyAndUnit(clean);
    const g = qty > 0 ? qty : 100;
    const factor = g / 100;

    return {
      items: [
        {
          foodName: 'Roasted Peanuts',
          originalText: clean,
          quantity: g,
          unit: 'g',
          preparation: 'roasted',
          estimatedGrams: g,
          calories: Math.round(587.0 * factor * 10) / 10,
          protein: Math.round(24.4 * factor * 10) / 10,
          carbohydrates: Math.round(21.3 * factor * 10) / 10,
          fat: Math.round(49.7 * factor * 10) / 10,
          fibre: Math.round(8.4 * factor * 10) / 10,
          notes: 'Standard dry roasted unsalted peanuts.',
          clarificationQuestions: []
        }
      ],
      totals: {
        calories: Math.round(587.0 * factor * 10) / 10,
        protein: Math.round(24.4 * factor * 10) / 10,
        carbohydrates: Math.round(21.3 * factor * 10) / 10,
        fat: Math.round(49.7 * factor * 10) / 10,
        fibre: Math.round(8.4 * factor * 10) / 10
      },
      isEstimate: true,
      notes: [`Calculated for ${g} g roasted peanuts.`]
    };
  }

  // 6. "2 wheat roti with chicken gravy"
  if (t.includes('roti') && (t.includes('chicken') || t.includes('gravy'))) {
    return {
      items: [
        {
          foodName: 'Whole Wheat Roti / Chapati',
          originalText: '2 wheat roti',
          quantity: 2,
          unit: 'piece',
          preparation: 'cooked',
          estimatedGrams: 80,
          calories: 240.0,
          protein: 7.0,
          carbohydrates: 44.0,
          fat: 4.0,
          fibre: 5.0,
          notes: 'Standard medium whole-wheat roti without added ghee ≈ 40 g each.',
          clarificationQuestions: ['Were the rotis plain or smeared with ghee / butter?']
        },
        {
          foodName: 'Chicken Curry / Gravy',
          originalText: 'chicken gravy',
          quantity: 1,
          unit: 'bowl',
          preparation: 'cooked',
          estimatedGrams: 150,
          calories: 220.0,
          protein: 18.0,
          carbohydrates: 6.0,
          fat: 14.0,
          fibre: 1.5,
          notes: 'Standard homestyle Indian chicken curry portion ≈ 150 g.',
          clarificationQuestions: ['Did the gravy contain bone-in chicken pieces or gravy only?']
        }
      ],
      totals: {
        calories: 460.0,
        protein: 25.0,
        carbohydrates: 50.0,
        fat: 18.0,
        fibre: 6.5
      },
      isEstimate: true,
      notes: ['Estimated for 2 medium rotis and 1 bowl chicken gravy.']
    };
  }

  // 7. "150 g rice, 100 g chicken and 1 tablespoon oil"
  if (t.includes('rice') && t.includes('chicken') && t.includes('oil')) {
    return {
      items: [
        {
          foodName: 'Cooked White Rice',
          originalText: '150 g rice',
          quantity: 150,
          unit: 'g',
          preparation: 'cooked',
          estimatedGrams: 150,
          calories: 195.0,
          protein: 4.1,
          carbohydrates: 42.3,
          fat: 0.5,
          fibre: 0.6,
          notes: '150 g plain steamed white rice.',
          clarificationQuestions: []
        },
        {
          foodName: 'Chicken Breast (Cooked)',
          originalText: '100 g chicken',
          quantity: 100,
          unit: 'g',
          preparation: 'cooked',
          estimatedGrams: 100,
          calories: 165.0,
          protein: 31.0,
          carbohydrates: 0.0,
          fat: 3.6,
          fibre: 0.0,
          notes: '100 g cooked boneless chicken.',
          clarificationQuestions: []
        },
        {
          foodName: 'Cooking Oil',
          originalText: '1 tablespoon oil',
          quantity: 1,
          unit: 'tbsp',
          preparation: 'raw',
          estimatedGrams: 14,
          calories: 123.8,
          protein: 0.0,
          carbohydrates: 0.0,
          fat: 14.0,
          fibre: 0.0,
          notes: '1 tablespoon refined cooking oil ≈ 14 g.',
          clarificationQuestions: []
        }
      ],
      totals: {
        calories: 483.8,
        protein: 35.1,
        carbohydrates: 42.3,
        fat: 18.1,
        fibre: 0.6
      },
      isEstimate: true,
      notes: ['Sum of 150 g rice + 100 g chicken + 1 tbsp oil.']
    };
  }

  // 8. Dynamic multi-ingredient decomposition (e.g. oats with badam/almonds, grapes, banana, etc.)
  const clauses = splitMealClauses(clean);
  const items = [];

  for (const clause of clauses) {
    const cLow = clause.toLowerCase();
    const { qty, unit, hasExplicit } = extractQtyAndUnit(clause);

    // Oats clause
    if (cLow.includes('oat')) {
      const oatsGrams = (hasExplicit && unit === 'g' ? qty : (qty > 10 ? qty : 100));
      const factor = oatsGrams / 100;
      const isSoaked = cLow.includes('soak');
      items.push({
        foodName: isSoaked ? 'Rolled Oats (Overnight Soaked)' : 'Rolled Oats',
        originalText: clause,
        quantity: oatsGrams,
        unit: 'g',
        preparation: isSoaked ? 'overnight-soaked' : 'raw',
        estimatedGrams: oatsGrams,
        calories: Math.round(389 * factor * 10) / 10,
        protein: Math.round(16.9 * factor * 10) / 10,
        carbohydrates: Math.round(66.3 * factor * 10) / 10,
        fat: Math.round(6.9 * factor * 10) / 10,
        fibre: Math.round(10.6 * factor * 10) / 10,
        notes: `Calculated for ${oatsGrams} g dry rolled oats weighed before soaking.`,
        clarificationQuestions: isSoaked ? [`Did the ${oatsGrams} g refer to dry oats before soaking, or the prepared soaked wet weight?`] : []
      });
      continue;
    }

    // Almonds / Badam clause
    if (cLow.includes('badam') || cLow.includes('almond')) {
      const count = (hasExplicit && unit === 'piece' ? qty : (qty > 0 && qty < 50 ? qty : 5));
      const gramWeight = Math.round(count * 1.2 * 10) / 10;
      const factor = gramWeight / 100;
      items.push({
        foodName: 'Almonds (Badam)',
        originalText: clause,
        quantity: count,
        unit: 'piece',
        preparation: cLow.includes('soak') ? 'soaked' : 'raw',
        estimatedGrams: gramWeight,
        calories: Math.round(579 * factor * 10) / 10,
        protein: Math.round(21.2 * factor * 10) / 10,
        carbohydrates: Math.round(21.6 * factor * 10) / 10,
        fat: Math.round(49.9 * factor * 10) / 10,
        fibre: Math.round(12.5 * factor * 10) / 10,
        notes: `${count} almonds ≈ ${gramWeight} g edible kernels.`,
        clarificationQuestions: []
      });
      continue;
    }

    // Grapes / Raisins clause
    if (cLow.includes('grape') || cLow.includes('raisin') || cLow.includes('kishmish') || cLow.includes('kismis')) {
      const isRaisin = cLow.includes('dry') || cLow.includes('raisin') || cLow.includes('kishmish') || cLow.includes('kismis');
      const count = (hasExplicit && unit === 'piece' ? qty : (qty > 0 && qty < 50 ? qty : 5));

      if (isRaisin) {
        const gramWeight = Math.round(count * 0.5 * 10) / 10;
        const factor = gramWeight / 100;
        items.push({
          foodName: 'Raisins (Dry Grapes / Kishmish)',
          originalText: clause,
          quantity: count,
          unit: 'piece',
          preparation: 'dried',
          estimatedGrams: gramWeight,
          calories: Math.round(299 * factor * 10) / 10,
          protein: Math.round(3.1 * factor * 10) / 10,
          carbohydrates: Math.round(79.2 * factor * 10) / 10,
          fat: Math.round(0.5 * factor * 10) / 10,
          fibre: Math.round(3.7 * factor * 10) / 10,
          notes: `${count} dried raisins ≈ ${gramWeight} g.`,
          clarificationQuestions: []
        });
      } else {
        const gramWeight = Math.round(count * 5.0 * 10) / 10;
        const factor = gramWeight / 100;
        items.push({
          foodName: 'Fresh Grapes',
          originalText: clause,
          quantity: count,
          unit: 'piece',
          preparation: 'raw',
          estimatedGrams: gramWeight,
          calories: Math.round(69 * factor * 10) / 10,
          protein: Math.round(0.7 * factor * 10) / 10,
          carbohydrates: Math.round(18.1 * factor * 10) / 10,
          fat: Math.round(0.2 * factor * 10) / 10,
          fibre: Math.round(0.9 * factor * 10) / 10,
          notes: `${count} fresh table grapes ≈ ${gramWeight} g.`,
          clarificationQuestions: ['Did you mean fresh grapes or dried raisins (kishmish)?']
        });
      }
      continue;
    }

    // Banana clause
    if (cLow.includes('banana')) {
      const { qty: bQty, hasExplicit: bExp } = extractQtyAndUnit(clause);
      const grams = bExp && unit === 'g' ? bQty : 150;
      const factor = grams / 100;
      items.push({
        foodName: 'Banana',
        originalText: clause,
        quantity: grams,
        unit: 'g',
        preparation: 'raw',
        estimatedGrams: grams,
        calories: Math.round(89 * factor * 10) / 10,
        protein: Math.round(1.1 * factor * 10) / 10,
        carbohydrates: Math.round(22.8 * factor * 10) / 10,
        fat: Math.round(0.3 * factor * 10) / 10,
        fibre: Math.round(2.6 * factor * 10) / 10,
        notes: `Raw banana calculated for ${grams} g edible fruit.`,
        clarificationQuestions: []
      });
      continue;
    }

    // Generic parsed item
    items.push({
      foodName: clause,
      originalText: clause,
      quantity: qty,
      unit,
      preparation: 'prepared',
      estimatedGrams: 100,
      calories: 120.0,
      protein: 4.0,
      carbohydrates: 18.0,
      fat: 3.0,
      fibre: 2.0,
      notes: 'Estimated standard portion.',
      clarificationQuestions: []
    });
  }

  const sumCal = items.reduce((a, b) => a + b.calories, 0);
  const sumP = items.reduce((a, b) => a + b.protein, 0);
  const sumC = items.reduce((a, b) => a + b.carbohydrates, 0);
  const sumF = items.reduce((a, b) => a + b.fat, 0);
  const sumFib = items.reduce((a, b) => a + b.fibre, 0);

  return {
    items,
    totals: {
      calories: Math.round(sumCal * 10) / 10,
      protein: Math.round(sumP * 10) / 10,
      carbohydrates: Math.round(sumC * 10) / 10,
      fat: Math.round(sumF * 10) / 10,
      fibre: Math.round(sumFib * 10) / 10
    },
    isEstimate: true,
    notes: [`Decomposed into ${items.length} individual ingredients.`]
  };
}

/**
 * Executes natural language nutrition analysis using the Google Gemini API.
 */
export async function analyzeMealWithGemini(text, { timeoutMs = 25000 } = {}) {
  const cleanText = String(text || '').trim();
  if (!cleanText) {
    const err = new Error('Meal description cannot be empty.');
    err.status = 400;
    throw err;
  }
  if (cleanText.length > 2000) {
    const err = new Error('Meal description is too long (maximum 2,000 characters).');
    err.status = 400;
    throw err;
  }

  // Quota simulation check for testing
  if (process.env.SIMULATE_GEMINI_QUOTA === '1') {
    const err = new Error('Google Gemini API quota exceeded or rate limit reached. Please check your Gemini account quota or try again shortly.');
    err.status = 429;
    err.isQuota = true;
    throw err;
  }

  const client = getGeminiClient();

  // Test / offline fixture mode when GEMINI_API_KEY is mock-key or running unit tests
  if (!client || process.env.GEMINI_API_KEY === 'mock-key' || process.env.NODE_ENV === 'test') {
    if (!client && process.env.NODE_ENV !== 'test') {
      const err = new Error('Gemini API key is not configured. Please set GEMINI_API_KEY in the server environment (.env) to enable AI nutrition analysis.');
      err.status = 401;
      throw err;
    }
    const mock = getMockNutritionAnalysis(cleanText);
    return validateAndNormalizeNutritionResponse(mock, cleanText);
  }

  const modelName = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';

  let lastError = null;

  // Retry once with stricter decomposition instructions if Gemini returns a compound item
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const systemInstruction = attempt === 1 ? GEMINI_SYSTEM_PROMPT : RETRY_GEMINI_SYSTEM_PROMPT;

      const response = await client.models.generateContent({
        model: modelName,
        contents: cleanText,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: GEMINI_NUTRITION_SCHEMA,
          temperature: 0.1
        }
      });

      const responseText = response?.text;
      if (!responseText) {
        throw new Error('Gemini returned an empty response.');
      }

      const parsedJson = JSON.parse(responseText);
      return validateAndNormalizeNutritionResponse(parsedJson, cleanText);
    } catch (err) {
      lastError = err;

      // Do not retry on auth, quota, or network timeout errors
      const mapped = mapGeminiError(err);
      if (mapped.status === 401 || mapped.status === 429 || mapped.status === 504) {
        throw mapped;
      }

      // If attempt 1 failed validation due to compound item, retry once
      if (attempt === 1) {
        continue;
      }
    }
  }

  throw mapGeminiError(lastError);
}

// Aliases for compatibility
export const analyzeMealDirectly = analyzeMealWithGemini;
export const parseMealWithGemini = async (text) => {
  const result = await analyzeMealWithGemini(text);
  return result?.items || [];
};
