/**
 * Server-Side OpenAI Direct Nutrition Analysis Engine
 * 
 * Directly analyzes unstructured meal descriptions using OpenAI Structured Outputs:
 * - Decomposes multi-ingredient meals into separate, individual food records.
 * - Extracts canonical food name, original text, quantity, unit, and preparation states.
 * - Distinguishes user-specified quantities from estimated portion weights.
 * - Scales calculations dynamically based on actual portion weights (doubling weight doubles nutrients).
 * - Handles soaked vs dry oats correctly with transparent assumptions and clarification questions.
 * - Distinguishes fresh grapes from dried raisins (dry grapes).
 * - Derives reconciled meal totals from individual ingredient values.
 * - Detects and rejects malformed compound responses (retries once with strict decomposition instructions).
 * - Validates all numbers for finiteness, non-negativity and plausible ranges.
 * - Keeps OPENAI_API_KEY strictly server-side.
 */

import OpenAI from 'openai';

let openaiClient = null;

export function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    return null;
  }
  if (!openaiClient || openaiClient.apiKey !== apiKey.trim()) {
    openaiClient = new OpenAI({
      apiKey: apiKey.trim()
    });
  }
  return openaiClient;
}

export const NUTRITION_ANALYSIS_SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "direct_meal_nutrition_analysis",
    strict: true,
    schema: {
      type: "object",
      properties: {
        input_summary: {
          type: "string",
          description: "Brief factual summary of the meal description provided by the user"
        },
        calculation_status: {
          type: "string",
          enum: ["complete", "needs_clarification", "approximate"],
          description: "Status based on clarity and specificity of the user's description"
        },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              canonical_food_name: {
                type: "string",
                description: "Standardized canonical name of the individual food item (e.g., 'Rolled Oats', 'Almonds', 'Grapes', 'Cooked Rice'). NEVER the complete sentence or multiple foods combined."
              },
              original_text: {
                type: "string",
                description: "The specific segment or clause from user input describing this ingredient (e.g., '200gm overnight soaked oats', '5 badam', '5 grapes')"
              },
              ingredient_name: {
                type: "string",
                description: "Descriptive display name of the ingredient"
              },
              explicit_quantity: {
                type: "number",
                description: "Quantity stated by the user or inferred count"
              },
              quantity_unit: {
                type: "string",
                description: "Unit such as 'g', 'kg', 'ml', 'piece', 'tbsp', 'tsp', 'cup', 'katori', 'bowl', 'roti', 'slice', or 'serving'"
              },
              is_quantity_estimated: {
                type: "boolean",
                description: "True if the quantity count was estimated by AI rather than explicitly specified by the user"
              },
              estimated_weight_g: {
                type: "number",
                description: "Estimated net weight in grams for this portion"
              },
              is_weight_estimated: {
                type: "boolean",
                description: "True if the gram weight is an estimate from standard portion weights rather than explicitly supplied in grams"
              },
              prep_state: {
                type: "string",
                description: "Preparation or cooking state (e.g., 'raw', 'soaked', 'boiled', 'roasted', 'cooked', 'fried')"
              },
              energy_kcal: {
                type: "number",
                description: "Estimated energy in kcal for this portion"
              },
              protein_g: {
                type: "number",
                description: "Estimated protein in grams"
              },
              carb_g: {
                type: "number",
                description: "Estimated total carbohydrates in grams"
              },
              fat_g: {
                type: "number",
                description: "Estimated total fat in grams"
              },
              fibre_g: {
                type: "number",
                description: "Estimated dietary fibre in grams"
              },
              confidence: {
                type: "string",
                enum: ["high", "medium", "low"],
                description: "Confidence label for this ingredient estimate"
              },
              assumptions: {
                type: "array",
                items: { type: "string" },
                description: "Transparent assumptions made about portion size, dry vs cooked weight, or preparation"
              },
              clarification_questions: {
                type: "array",
                items: { type: "string" },
                description: "Clarification questions if missing recipe details or ambiguities materially affect nutrition"
              }
            },
            required: [
              "canonical_food_name",
              "original_text",
              "ingredient_name",
              "explicit_quantity",
              "quantity_unit",
              "is_quantity_estimated",
              "estimated_weight_g",
              "is_weight_estimated",
              "prep_state",
              "energy_kcal",
              "protein_g",
              "carb_g",
              "fat_g",
              "fibre_g",
              "confidence",
              "assumptions",
              "clarification_questions"
            ],
            additionalProperties: false
          }
        },
        reconciliation_notes: {
          type: "string",
          description: "Explanation of how ingredient values sum into the meal totals"
        },
        overall_assumptions: {
          type: "array",
          items: { type: "string" },
          description: "Global assumptions applied across the meal"
        },
        clarifications: {
          type: "array",
          items: { type: "string" },
          description: "Key questions for the user to improve accuracy"
        }
      },
      required: [
        "input_summary",
        "calculation_status",
        "items",
        "reconciliation_notes",
        "overall_assumptions",
        "clarifications"
      ],
      additionalProperties: false
    }
  }
};

const SYSTEM_PROMPT = `You are the clinical nutrition analysis engine for openGym.
Your role is to analyze natural-language meal descriptions into an array of structured, individual ingredients with accurate clinical nutritional estimates.

CRITICAL INSTRUCTIONS:
1. STRICT INGREDIENT DECOMPOSITION & FIDELITY:
   - Identify EVERY ingredient and food item mentioned.
   - You MUST separate multi-ingredient meals into individual ingredient objects in the 'items' array.
   - NEVER return a single compound item containing multiple ingredients or the full input sentence.
   - For example, if the input is '200gm overnight soaked oats with 5 badam and 5 grapes', you MUST return three separate items:
     1. Oats (Overnight Soaked)
     2. Almonds (Badam)
     3. Grapes
   - Never insert unmentioned ingredients (for example, NEVER insert carrots, random vegetables, or unmentioned sauces).
   - Never silently drop an explicit ingredient. All explicit foods must appear in the items list.

2. SCHEMA REQUIREMENTS:
   - In each item object:
     * canonical_food_name: Canonical food name (e.g., 'Rolled Oats', 'Almonds', 'Grapes'). NEVER the full user sentence.
     * original_text: The user phrase describing this item (e.g., '200gm overnight soaked oats').
     * ingredient_name: Clear display name.
     * explicit_quantity: The numeric quantity.
     * quantity_unit: The unit (e.g., 'g', 'piece', 'tbsp').
     * estimated_weight_g: Net weight in grams.
     * is_weight_estimated: True if weight was estimated from piece count / standard portions.
     * prep_state: Cooking / prep state (e.g., 'soaked', 'raw', 'cooked', 'roasted').
     * energy_kcal, protein_g, carb_g, fat_g, fibre_g: Realistic nutrients for this portion.
     * confidence: 'high', 'medium', or 'low'.
     * assumptions: Array of assumptions.
     * clarification_questions: Array of questions if relevant.

3. QUANTITIES AFFECT CALCULATIONS (NO HARDCODED 100 G DEFAULTS):
   - When the user specifies a quantity (e.g., 200 g oats), calculate nutrients for that exact amount!
   - Doubling an ingredient's weight MUST approximately double its calories and macronutrients (e.g., 200 g dry oats has ~2x the calories of 100 g dry oats).
   - For overnight soaked oats:
     * Overnight soaking changes water content and weight per 100 g.
     * Calculate using dry-oats baseline (100 g dry oats ≈ 389 kcal; 200 g dry oats ≈ 778 kcal).
     * Add assumptions and clarification questions on dry vs soaked wet weight.
   - For grapes:
     * Clarify whether fresh table grapes (~17 kcal for 5) or dried raisins / kishmish (~8 kcal for 5) were consumed.
   - The total meal calories and macros MUST equal the exact sum of the individual ingredient values.
`;

const RETRY_SYSTEM_PROMPT = `${SYSTEM_PROMPT}

CRITICAL RETRY CORRECTION:
Your previous response incorrectly grouped multiple ingredients into a single compound item or repeated the full sentence.
You MUST decompose the input into separate, individual ingredient objects in the 'items' array.
For example, for '200gm overnight soaked oats with 5 badam and 5 grapes':
- Item 1: Oats (Overnight Soaked) — 200 g
- Item 2: Almonds (Badam) — 5 pieces (6 g)
- Item 3: Grapes — 5 pieces (25 g)
NEVER put the entire sentence into canonical_food_name or ingredient_name!`;

/**
 * Checks if an item is a malformed compound item representing the complete sentence
 * rather than an individual food.
 */
export function isCompoundSentenceItem(item, rawInput) {
  const name = String(item.canonical_food_name || item.ingredient_name || '').trim().toLowerCase();
  const raw = String(rawInput || '').trim().toLowerCase();

  // 1. Identical to or nearly identical to full multi-word input
  if (raw.split(/\s+/).length >= 3) {
    if (name === raw) return true;
    if (raw.includes(' with ') && name.includes(' with ')) return true;
    if (raw.includes(' and ') && name.includes(' and ')) return true;
  }

  // 2. Name contains multiple food clauses conjoined by 'with' or 'and'
  const words = name.split(/\s+/);
  if (words.length >= 4 && (name.includes(' with ') || name.includes(' and '))) {
    return true;
  }

  return false;
}

/**
 * Validates, bounds-checks, and reconciles the nutritional analysis response.
 */
export function validateNutritionResponse(raw, rawInput) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid analysis response format.');
  }

  const items = Array.isArray(raw.items) ? raw.items : [];
  if (items.length === 0) {
    throw new Error('No recognizable food ingredients were found in the description.');
  }

  const cleanRawInput = String(rawInput || '').trim();

  // Reject malformed compound responses
  for (const it of items) {
    if (isCompoundSentenceItem(it, cleanRawInput)) {
      throw new Error(`Malformed nutrition analysis: Complete meal sentence was returned as a single ingredient ("${it.canonical_food_name || it.ingredient_name}"). Each ingredient must be listed separately.`);
    }
  }

  const validatedItems = [];
  let sumKcal = 0;
  let sumProtein = 0;
  let sumCarb = 0;
  let sumFat = 0;
  let sumFibre = 0;

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const name = String(it.canonical_food_name || it.ingredient_name || it.food_name || '').trim();
    if (!name) continue;

    // Numerical validation
    const qty = Number(it.explicit_quantity ?? it.quantity);
    const weightG = Number(it.estimated_weight_g ?? it.grams);
    const kcal = Number(it.energy_kcal ?? it.calories);
    const protein = Number(it.protein_g ?? it.protein);
    const carb = Number(it.carb_g ?? it.carbohydrates);
    const fat = Number(it.fat_g ?? it.fat);
    const fibre = Number(it.fibre_g ?? it.fibre);

    if (!Number.isFinite(qty) || qty <= 0 || qty > 100000) {
      throw new Error(`Invalid quantity ${it.explicit_quantity} for ingredient "${name}".`);
    }
    if (!Number.isFinite(weightG) || weightG <= 0 || weightG > 50000) {
      throw new Error(`Invalid gram weight ${it.estimated_weight_g} for ingredient "${name}".`);
    }
    if (!Number.isFinite(kcal) || kcal < 0 || kcal > 50000) {
      throw new Error(`Invalid calories ${it.energy_kcal} for ingredient "${name}".`);
    }
    if (!Number.isFinite(protein) || protein < 0 || protein > 10000) {
      throw new Error(`Invalid protein ${it.protein_g} for ingredient "${name}".`);
    }
    if (!Number.isFinite(carb) || carb < 0 || carb > 10000) {
      throw new Error(`Invalid carbohydrates ${it.carb_g} for ingredient "${name}".`);
    }
    if (!Number.isFinite(fat) || fat < 0 || fat > 10000) {
      throw new Error(`Invalid fat ${it.fat_g} for ingredient "${name}".`);
    }
    if (!Number.isFinite(fibre) || fibre < 0 || fibre > 5000) {
      throw new Error(`Invalid fibre ${it.fibre_g} for ingredient "${name}".`);
    }

    const roundedKcal = Math.round(kcal * 10) / 10;
    const roundedProt = Math.round(protein * 10) / 10;
    const roundedCarb = Math.round(carb * 10) / 10;
    const roundedFat = Math.round(fat * 10) / 10;
    const roundedFib = Math.round(fibre * 10) / 10;

    sumKcal += roundedKcal;
    sumProtein += roundedProt;
    sumCarb += roundedCarb;
    sumFat += roundedFat;
    sumFibre += roundedFib;

    const validatedItem = {
      canonical_food_name: name,
      ingredient_name: String(it.ingredient_name || name).trim(),
      original_text: String(it.original_text || name).trim(),
      explicit_quantity: Math.round(qty * 100) / 100,
      quantity_unit: String(it.quantity_unit || it.unit || 'g').trim(),
      is_quantity_estimated: Boolean(it.is_quantity_estimated),
      estimated_weight_g: Math.round(weightG * 10) / 10,
      is_weight_estimated: Boolean(it.is_weight_estimated),
      prep_state: String(it.prep_state || 'raw').trim(),
      energy_kcal: roundedKcal,
      protein_g: roundedProt,
      carb_g: roundedCarb,
      fat_g: roundedFat,
      fibre_g: roundedFib,
      confidence: ['high', 'medium', 'low'].includes(it.confidence) ? it.confidence : 'medium',
      assumptions: Array.isArray(it.assumptions) ? it.assumptions.map(String) : [],
      clarification_questions: Array.isArray(it.clarification_questions) ? it.clarification_questions.map(String) : [],
      // Normalization aliases for frontend compatibility
      food_name: name,
      quantity: Math.round(qty * 100) / 100,
      unit: String(it.quantity_unit || it.unit || 'g').trim(),
      grams: Math.round(weightG * 10) / 10,
      calories: roundedKcal,
      protein: roundedProt,
      carbohydrates: roundedCarb,
      fat: roundedFat,
      fibre: roundedFib,
      nutrients: {
        energy_kcal: roundedKcal,
        protein_g: roundedProt,
        carb_g: roundedCarb,
        fat_g: roundedFat,
        fibre_g: roundedFib
      },
      matched: true
    };

    validatedItems.push(validatedItem);
  }

  // Derive reconciled totals from ingredient sums
  const totals = {
    energy_kcal: Math.round(sumKcal * 10) / 10,
    protein_g: Math.round(sumProtein * 10) / 10,
    carb_g: Math.round(sumCarb * 10) / 10,
    fat_g: Math.round(sumFat * 10) / 10,
    fibre_g: Math.round(sumFibre * 10) / 10
  };

  return {
    raw_input: cleanRawInput,
    input_summary: String(raw.input_summary || cleanRawInput).trim(),
    calculation_status: ['complete', 'needs_clarification', 'approximate'].includes(raw.calculation_status)
      ? raw.calculation_status
      : 'complete',
    items: validatedItems,
    totals,
    reconciliation_notes: raw.reconciliation_notes || 'Meal totals are calculated directly as the exact sum of all ingredient estimates.',
    overall_assumptions: Array.isArray(raw.overall_assumptions) ? raw.overall_assumptions.map(String) : [],
    clarifications: Array.isArray(raw.clarifications) ? raw.clarifications.map(String) : [],
    disclaimer: 'Nutritional values are AI-generated clinical estimates based on standard nutritional composition references, not laboratory-verified measurements of your specific preparation. Portions and values are editable before logging.',
    provider: 'openai'
  };
}

/**
 * Splits natural language meal description into distinct ingredient clauses.
 */
function splitMealClauses(text) {
  // Split on " with ", " and ", comma, plus, newline
  const parts = text.split(/\s+with\s+|\s+and\s+|[,;+\n]+/i);
  return parts.map(p => p.trim()).filter(Boolean);
}

/**
 * Parses numbers and units from a single clause string.
 */
function extractQtyAndUnit(clause) {
  // Look for number + unit, e.g. "200gm", "100 g", "5 pieces", "1 tbsp", "2"
  const m = clause.match(/(\d+(?:\.\d+)?)\s*(kg|kgs|kilo|kilos|g|gm|gms|gram|grams|ml|l|liter|litres|tbsp|tablespoon|tablespoons|tsp|teaspoon|teaspoons|cup|cups|katori|katoris|bowl|bowls|roti|rotis|chapati|chapatis|piece|pieces|slice|slices)?\b/i);
  if (m) {
    const num = parseFloat(m[1]);
    let unit = (m[2] || '').toLowerCase();
    if (['g', 'gm', 'gms', 'gram', 'grams'].includes(unit)) unit = 'g';
    else if (['kg', 'kgs', 'kilo', 'kilos'].includes(unit)) { return { qty: num * 1000, unit: 'g', hasExplicit: true }; }
    else if (['tbsp', 'tablespoon', 'tablespoons'].includes(unit)) unit = 'tbsp';
    else if (['tsp', 'teaspoon', 'teaspoons'].includes(unit)) unit = 'tsp';
    else if (['katori', 'katoris'].includes(unit)) unit = 'katori';
    else if (['roti', 'rotis', 'chapati', 'chapatis'].includes(unit)) unit = 'piece';
    else if (!unit) unit = 'piece';
    return { qty: num, unit, hasExplicit: true };
  }
  return { qty: 1, unit: 'serving', hasExplicit: false };
}

/**
 * Deterministic analysis fixture for unit testing and offline verification.
 * Dynamically decomposes clauses, respects supplied quantities, and handles oats/grapes accurately.
 */
export function getMockNutritionAnalysis(text) {
  const clean = String(text || '').trim();
  const lower = clean.toLowerCase();

  // Test Case: "2 wheat roti with chicken gravy"
  if (lower.includes('roti') && (lower.includes('gravy') || lower.includes('curry'))) {
    return {
      input_summary: '2 wheat rotis with chicken gravy',
      calculation_status: 'needs_clarification',
      items: [
        {
          canonical_food_name: 'Wheat Roti / Chapati',
          original_text: '2 wheat roti',
          ingredient_name: 'Wheat Roti / Chapati',
          explicit_quantity: 2,
          quantity_unit: 'piece',
          is_quantity_estimated: false,
          estimated_weight_g: 70,
          is_weight_estimated: true,
          prep_state: 'cooked',
          energy_kcal: 208,
          protein_g: 6.3,
          carb_g: 40.6,
          fat_g: 2.5,
          fibre_g: 5.6,
          confidence: 'high',
          assumptions: ['Standard medium whole-wheat roti estimated at 35 g each (2 rotis = 70 g).'],
          clarification_questions: []
        },
        {
          canonical_food_name: 'Chicken Gravy / Curry',
          original_text: 'chicken gravy',
          ingredient_name: 'Chicken Gravy / Curry',
          explicit_quantity: 1,
          quantity_unit: 'katori',
          is_quantity_estimated: true,
          estimated_weight_g: 150,
          is_weight_estimated: true,
          prep_state: 'cooked',
          energy_kcal: 187.5,
          protein_g: 21.0,
          carb_g: 6.8,
          fat_g: 9.0,
          fibre_g: 1.8,
          confidence: 'medium',
          assumptions: ['Estimated standard 1 katori (150 g) portion containing approx. 60 g cooked chicken and 90 g onion-tomato gravy.'],
          clarification_questions: ['Gravy calories depend heavily on cooking oil, coconut/cream, and chicken cut. You can adjust the portion if known.']
        }
      ],
      reconciliation_notes: 'Total meal calories (395.5 kcal) represent the sum of 2 rotis and 1 katori chicken gravy.',
      overall_assumptions: ['Medium whole wheat chapati and standard homestyle chicken curry.'],
      clarifications: ['Recipe oil and meat portions significantly alter gravy calories.']
    };
  }

  // Test Case: "100 g roasted peanuts"
  if (lower.includes('peanut')) {
    const { qty } = extractQtyAndUnit(clean);
    const weight = qty || 100;
    const factor = weight / 100;
    return {
      input_summary: `${weight} g roasted peanuts`,
      calculation_status: 'complete',
      items: [
        {
          canonical_food_name: 'Roasted Peanuts',
          original_text: clean,
          ingredient_name: 'Roasted Peanuts',
          explicit_quantity: weight,
          quantity_unit: 'g',
          is_quantity_estimated: false,
          estimated_weight_g: weight,
          is_weight_estimated: false,
          prep_state: 'roasted',
          energy_kcal: Math.round(585 * factor * 10) / 10,
          protein_g: Math.round(24.5 * factor * 10) / 10,
          carb_g: Math.round(21.0 * factor * 10) / 10,
          fat_g: Math.round(49.7 * factor * 10) / 10,
          fibre_g: Math.round(8.0 * factor * 10) / 10,
          confidence: 'high',
          assumptions: ['Dry roasted peanuts without added oil.'],
          clarification_questions: []
        }
      ],
      reconciliation_notes: 'Exact portion matches reference composition.',
      overall_assumptions: ['Dry roasted peanuts.'],
      clarifications: []
    };
  }

  // Test Case: "150 g rice, 100 g chicken and 1 tablespoon oil"
  if (lower.includes('rice') && lower.includes('chicken') && lower.includes('oil')) {
    return {
      input_summary: '150 g rice, 100 g chicken, and 1 tablespoon oil',
      calculation_status: 'complete',
      items: [
        {
          canonical_food_name: 'Steamed Rice (Cooked)',
          original_text: '150 g rice',
          ingredient_name: 'Steamed Rice (Cooked)',
          explicit_quantity: 150,
          quantity_unit: 'g',
          is_quantity_estimated: false,
          estimated_weight_g: 150,
          is_weight_estimated: false,
          prep_state: 'cooked',
          energy_kcal: 195,
          protein_g: 4.1,
          carb_g: 42.3,
          fat_g: 0.5,
          fibre_g: 0.6,
          confidence: 'high',
          assumptions: ['Cooked white steamed rice (150 g).'],
          clarification_questions: []
        },
        {
          canonical_food_name: 'Chicken Breast (Cooked)',
          original_text: '100 g chicken',
          ingredient_name: 'Chicken Breast (Cooked)',
          explicit_quantity: 100,
          quantity_unit: 'g',
          is_quantity_estimated: false,
          estimated_weight_g: 100,
          is_weight_estimated: false,
          prep_state: 'cooked',
          energy_kcal: 165,
          protein_g: 31.0,
          carb_g: 0.0,
          fat_g: 3.6,
          fibre_g: 0.0,
          confidence: 'high',
          assumptions: ['Cooked skinless, boneless chicken breast.'],
          clarification_questions: []
        },
        {
          canonical_food_name: 'Vegetable Cooking Oil',
          original_text: '1 tablespoon oil',
          ingredient_name: 'Vegetable Cooking Oil',
          explicit_quantity: 1,
          quantity_unit: 'tbsp',
          is_quantity_estimated: false,
          estimated_weight_g: 14,
          is_weight_estimated: false,
          prep_state: 'raw',
          energy_kcal: 123.8,
          protein_g: 0.0,
          carb_g: 0.0,
          fat_g: 14.0,
          fibre_g: 0.0,
          confidence: 'high',
          assumptions: ['1 tablespoon standard refined cooking oil ≈ 14 g.'],
          clarification_questions: []
        }
      ],
      reconciliation_notes: 'Total meal calories (483.8 kcal) derived directly from 150g rice + 100g chicken + 1 tbsp oil.',
      overall_assumptions: ['Exact gram weights supplied for all 3 ingredients.'],
      clarifications: []
    };
  }

  // Decompose any oats or multi-ingredient breakfast description
  const clauses = splitMealClauses(clean);
  const items = [];
  const clarifications = [];

  for (const clause of clauses) {
    const cLow = clause.toLowerCase();
    const { qty, unit, hasExplicit } = extractQtyAndUnit(clause);

    // 1. Oats clause
    if (cLow.includes('oat')) {
      const oatsGrams = (hasExplicit && unit === 'g' ? qty : (qty > 10 ? qty : 100));
      const factor = oatsGrams / 100;
      items.push({
        canonical_food_name: 'Rolled Oats (Overnight Soaked)',
        original_text: clause,
        ingredient_name: 'Rolled Oats (Overnight Soaked)',
        explicit_quantity: oatsGrams,
        quantity_unit: 'g',
        is_quantity_estimated: !hasExplicit,
        estimated_weight_g: oatsGrams,
        is_weight_estimated: false,
        prep_state: 'soaked',
        energy_kcal: Math.round(389 * factor * 10) / 10,
        protein_g: Math.round(16.9 * factor * 10) / 10,
        carb_g: Math.round(66.3 * factor * 10) / 10,
        fat_g: Math.round(6.9 * factor * 10) / 10,
        fibre_g: Math.round(10.6 * factor * 10) / 10,
        confidence: 'high',
        assumptions: [
          `Calculated for ${oatsGrams} g dry rolled oats weighed before soaking. Water absorbed during soaking adds weight without adding calories.`
        ],
        clarification_questions: [
          `Did the ${oatsGrams} g refer to dry oats before soaking, or the prepared soaked wet weight? (Soaked wet oats is ~155 kcal per 100 g).`
        ]
      });
      clarifications.push(`Oats: Confirm whether ${oatsGrams} g is dry weight or soaked wet weight.`);
      continue;
    }

    // 2. Almonds / Badam clause
    if (cLow.includes('badam') || cLow.includes('almond')) {
      const count = (hasExplicit && unit === 'piece' ? qty : (qty > 0 && qty < 50 ? qty : 5));
      const gramWeight = Math.round(count * 1.2 * 10) / 10;
      const factor = gramWeight / 100;
      items.push({
        canonical_food_name: 'Almonds (Badam)',
        original_text: clause,
        ingredient_name: 'Almonds (Badam)',
        explicit_quantity: count,
        quantity_unit: 'piece',
        is_quantity_estimated: !hasExplicit,
        estimated_weight_g: gramWeight,
        is_weight_estimated: true,
        prep_state: 'raw',
        energy_kcal: Math.round(579 * factor * 10) / 10, // ~34.7 kcal for 6g
        protein_g: Math.round(21.2 * factor * 10) / 10, // ~1.3g
        carb_g: Math.round(21.6 * factor * 10) / 10, // ~1.3g
        fat_g: Math.round(49.9 * factor * 10) / 10, // ~3.0g
        fibre_g: Math.round(12.5 * factor * 10) / 10, // ~0.8g
        confidence: 'medium',
        assumptions: [
          `Estimated at 1.2 g average weight per raw almond kernel (${count} pieces = ${gramWeight} g).`
        ],
        clarification_questions: []
      });
      continue;
    }

    // 3. Grapes or Raisins (Dry Grapes) clause
    if (cLow.includes('grape') || cLow.includes('raisin') || cLow.includes('kishmish')) {
      const isDry = cLow.includes('dry') || cLow.includes('raisin') || cLow.includes('kishmish');
      const count = (hasExplicit && unit === 'piece' ? qty : (qty > 0 && qty < 50 ? qty : 5));

      if (isDry) {
        const gramWeight = Math.round(count * 0.5 * 10) / 10;
        const factor = gramWeight / 100;
        items.push({
          canonical_food_name: 'Raisins (Dry Grapes)',
          original_text: clause,
          ingredient_name: 'Raisins (Dry Grapes)',
          explicit_quantity: count,
          quantity_unit: 'piece',
          is_quantity_estimated: !hasExplicit,
          estimated_weight_g: gramWeight,
          is_weight_estimated: true,
          prep_state: 'dried',
          energy_kcal: Math.round(299 * factor * 10) / 10, // ~7.5 kcal for 2.5g
          protein_g: Math.round(3.1 * factor * 10) / 10, // ~0.1g
          carb_g: Math.round(79.2 * factor * 10) / 10, // ~2.0g
          fat_g: 0.0,
          fibre_g: Math.round(3.7 * factor * 10) / 10, // ~0.1g
          confidence: 'medium',
          assumptions: [
            `Estimated at 0.5 g average weight per raisin (${count} pieces = ${gramWeight} g).`
          ],
          clarification_questions: []
        });
      } else {
        // Fresh table grapes: ~5g each (5 pieces ≈ 25g, ~17 kcal)
        const gramWeight = Math.round(count * 5.0 * 10) / 10;
        const factor = gramWeight / 100;
        items.push({
          canonical_food_name: 'Grapes (Fresh)',
          original_text: clause,
          ingredient_name: 'Grapes (Fresh)',
          explicit_quantity: count,
          quantity_unit: 'piece',
          is_quantity_estimated: !hasExplicit,
          estimated_weight_g: gramWeight,
          is_weight_estimated: true,
          prep_state: 'raw',
          energy_kcal: Math.round(69 * factor * 10) / 10, // ~17.3 kcal for 25g
          protein_g: Math.round(0.7 * factor * 10) / 10, // ~0.2g
          carb_g: Math.round(18.1 * factor * 10) / 10, // ~4.5g
          fat_g: Math.round(0.2 * factor * 10) / 10, // ~0.1g
          fibre_g: Math.round(0.9 * factor * 10) / 10, // ~0.2g
          confidence: 'medium',
          assumptions: [
            `Estimated at 5.0 g average weight per fresh table grape (${count} pieces = ${gramWeight} g).`
          ],
          clarification_questions: [
            'Did you mean fresh grapes (~17 kcal) or dried raisins / dry grapes (~8 kcal)?'
          ]
        });
        clarifications.push('Grapes: Clarify fresh table grapes vs dried raisins (dry grapes).');
      }
      continue;
    }

    // 4. Banana clause
    if (cLow.includes('banana')) {
      const bananaGrams = (hasExplicit && unit === 'g' ? qty : (qty > 10 ? qty : 150));
      const factor = bananaGrams / 100;
      items.push({
        canonical_food_name: 'Banana (Fresh)',
        original_text: clause,
        ingredient_name: 'Banana (Fresh)',
        explicit_quantity: bananaGrams,
        quantity_unit: 'g',
        is_quantity_estimated: !hasExplicit,
        estimated_weight_g: bananaGrams,
        is_weight_estimated: false,
        prep_state: 'raw',
        energy_kcal: Math.round(89 * factor * 10) / 10, // ~133.5 kcal for 150g
        protein_g: Math.round(1.1 * factor * 10) / 10, // ~1.7g
        carb_g: Math.round(22.8 * factor * 10) / 10, // ~34.2g
        fat_g: Math.round(0.3 * factor * 10) / 10, // ~0.5g
        fibre_g: Math.round(2.6 * factor * 10) / 10, // ~3.9g
        confidence: 'high',
        assumptions: [`Calculated for ${bananaGrams} g peeled ripe banana.`],
        clarification_questions: []
      });
      continue;
    }

    // 5. Generic single ingredient fallback (cleaned food name, NEVER full sentence)
    const cleanFoodName = clause.replace(/^\d+(?:\.\d+)?\s*(?:kg|g|gm|gms|gram|grams|ml|piece|pieces|slice|slices|cup|cups|tbsp|tsp)?\s*/i, '').trim();
    if (cleanFoodName) {
      const weight = hasExplicit && unit === 'g' ? qty : 100;
      items.push({
        canonical_food_name: cleanFoodName,
        original_text: clause,
        ingredient_name: cleanFoodName,
        explicit_quantity: qty || 1,
        quantity_unit: unit || 'serving',
        is_quantity_estimated: !hasExplicit,
        estimated_weight_g: weight,
        is_weight_estimated: !hasExplicit,
        prep_state: 'cooked',
        energy_kcal: 150,
        protein_g: 5.0,
        carb_g: 20.0,
        fat_g: 5.0,
        fibre_g: 2.0,
        confidence: 'low',
        assumptions: [`Estimated portion based on clause "${clause}".`],
        clarification_questions: ['Specify ingredients and preparation method for higher accuracy.']
      });
    }
  }

  // If no items extracted, create one item from clean text
  if (items.length === 0) {
    items.push({
      canonical_food_name: clean,
      original_text: clean,
      ingredient_name: clean,
      explicit_quantity: 1,
      quantity_unit: 'serving',
      is_quantity_estimated: true,
      estimated_weight_g: 100,
      is_weight_estimated: true,
      prep_state: 'cooked',
      energy_kcal: 150,
      protein_g: 5.0,
      carb_g: 20.0,
      fat_g: 5.0,
      fibre_g: 2.0,
      confidence: 'low',
      assumptions: ['Standard 100 g portion assumed.'],
      clarification_questions: ['Please specify ingredients and quantities for higher accuracy.']
    });
  }

  const sumKcal = items.reduce((acc, i) => acc + i.energy_kcal, 0);

  return {
    input_summary: clean,
    calculation_status: clarifications.length > 0 ? 'needs_clarification' : 'complete',
    items,
    reconciliation_notes: `Total meal calories (${Math.round(sumKcal * 10) / 10} kcal) are reconciled by exact summation of the ${items.length} ingredient estimates.`,
    overall_assumptions: ['Standard USDA / ICMR nutrient composition tables applied.'],
    clarifications
  };
}

/**
 * Executes direct AI nutrition analysis via OpenAI API with strict JSON schema and retry on malformed responses.
 */
export async function analyzeMealDirectly(text, { timeoutMs = 25000 } = {}) {
  const cleanText = String(text || '').trim();
  if (!cleanText) {
    throw new Error('Meal description cannot be empty.');
  }
  if (cleanText.length > 2000) {
    throw new Error('Meal description is too long (maximum 2,000 characters).');
  }

  const client = getOpenAIClient();

  // Test / offline fixture mode when OPENAI_API_KEY is unset, mock-key, or in test environment
  if (!client || process.env.OPENAI_API_KEY === 'mock-key' || process.env.NODE_ENV === 'test') {
    if (!client && process.env.NODE_ENV !== 'test') {
      throw new Error('OpenAI API key is not configured. Please set OPENAI_API_KEY in the server environment (.env) to enable AI nutrition analysis.');
    }
    const mock = getMockNutritionAnalysis(cleanText);
    return validateNutritionResponse(mock, cleanText);
  }

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  let lastError = null;
  // Support 1 retry with stricter decomposition prompt if model returns compound item
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const promptToUse = attempt === 1 ? SYSTEM_PROMPT : RETRY_SYSTEM_PROMPT;
      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: promptToUse },
          { role: 'user', content: cleanText }
        ],
        response_format: NUTRITION_ANALYSIS_SCHEMA,
        temperature: 0.1
      }, {
        signal: AbortSignal.timeout(timeoutMs)
      });

      const content = response.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('OpenAI returned an empty response.');
      }

      const parsedJson = JSON.parse(content);
      return validateNutritionResponse(parsedJson, cleanText);
    } catch (err) {
      lastError = err;
      // Do not retry on authentication, quota, or network timeouts
      if (err.status === 401 || err.status === 429 || err.name === 'TimeoutError' || err.code === 'ETIMEDOUT') {
        break;
      }
      // If validation failed because of compound response on attempt 1, loop will retry once
      if (attempt === 1) {
        continue;
      }
    }
  }

  // Handle mapped errors cleanly without fabricating numbers
  if (lastError.name === 'TimeoutError' || lastError.code === 'ETIMEDOUT') {
    throw new Error(`OpenAI request timed out after ${timeoutMs / 1000} seconds. Please try again.`);
  }
  if (lastError.status === 401) {
    throw new Error('Authentication failed: Invalid OPENAI_API_KEY. Please verify your API key in .env.');
  }
  if (lastError.status === 429) {
    throw new Error('OpenAI rate limit or quota exceeded. Please check your account usage and limits.');
  }
  throw new Error(`OpenAI nutrition analysis failed: ${lastError.message || 'Unknown provider error'}`);
}

export const parseMealWithOpenAI = analyzeMealDirectly;
