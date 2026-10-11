/**
 * Server-Side OpenAI Direct Nutrition Analysis Engine
 * 
 * Directly analyzes unstructured meal descriptions using OpenAI Structured Outputs:
 * - Identifies every food and ingredient mentioned without inserting unmentioned items.
 * - Extracts explicit quantities and distinguishes user-specified vs estimated portion weights.
 * - Estimates calories, protein, carbs, fat and fibre using clinical/USDA reference standards.
 * - Derives reconciled meal totals from individual ingredient values.
 * - Returns transparent assumptions, uncertainty levels and clarification questions.
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
              ingredient_name: {
                type: "string",
                description: "Name of the recognized ingredient or food item"
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
                description: "Clarification questions if missing recipe details materially affect nutrition"
              }
            },
            required: [
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
Your role is to analyze natural-language meal descriptions into structured ingredients with accurate clinical nutritional estimates.

CRITICAL INSTRUCTIONS:
1. STRICT INGREDIENT FIDELITY:
   - Identify EVERY ingredient and food item mentioned.
   - NEVER insert unmentioned ingredients (for example, NEVER insert carrots, random vegetables, or unmentioned sauces).
   - Never silently drop an explicit ingredient. All explicit foods must appear in the items list.

2. QUANTITIES, UNITS & PORTIONS:
   - If user specifies grams (e.g., '100 gm', '150 gm'), explicit_quantity is that number, unit is 'g', is_quantity_estimated is false, estimated_weight_g is that number, is_weight_estimated is false.
   - If user gives a piece count (e.g., '5 badam', '5 dry grapes', '2 wheat roti', '3 boiled eggs'):
     - explicit_quantity is the count, unit is 'piece' (or 'roti'), is_quantity_estimated is false.
     - estimated_weight_g is estimated from standard reference portions:
       * 1 almond (badam) ≈ 1.2 g (5 badam ≈ 6 g, ~35 kcal).
       * 1 raisin / dry grape (kishmish) ≈ 0.5 g (5 dry grapes ≈ 2.5 g, ~8 kcal).
       * 1 medium banana ≈ 120 g (if user explicitly specifies 150 gm, use 150 g).
       * 1 medium wheat roti / chapati ≈ 35 g (~104 kcal).
       * 1 medium whole egg ≈ 50 g (~72 kcal).
     - Set is_weight_estimated = true and document the piece weight in assumptions.
   - For dishes like 'chicken gravy':
     - Assume standard serving (1 katori / ~150 g, ~120-150 kcal).
     - Provide clarification questions on cooking oil quantity and meat proportion.
   - For 'overnight soaked oats':
     - 100 g dry rolled oats basis is ~380-390 kcal, ~16g protein.
     - Note in assumptions that water absorption during soaking increases weight without adding calories.

3. ACCURATE NUTRITIONAL STANDARDS:
   - Provide realistic macronutrients based on USDA / ICMR clinical reference standards.
   - Calculate energy, protein, carbs, fat, and fibre for the exact portion stated.

4. TRANSPARENCY:
   - Label confidence as 'high' (explicit weights of standard staples), 'medium' (standard piece counts), or 'low' (variable multi-ingredient dishes).
   - Never claim results are laboratory-verified. These are AI nutritional estimates based on reference standards.
`;

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

  const validatedItems = [];
  let sumKcal = 0;
  let sumProtein = 0;
  let sumCarb = 0;
  let sumFat = 0;
  let sumFibre = 0;

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const name = String(it.ingredient_name || '').trim();
    if (!name) continue;

    // Numerical validation
    const qty = Number(it.explicit_quantity);
    const weightG = Number(it.estimated_weight_g);
    const kcal = Number(it.energy_kcal);
    const protein = Number(it.protein_g);
    const carb = Number(it.carb_g);
    const fat = Number(it.fat_g);
    const fibre = Number(it.fibre_g);

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

    validatedItems.push({
      ingredient_name: name,
      explicit_quantity: Math.round(qty * 100) / 100,
      quantity_unit: String(it.quantity_unit || 'g').trim(),
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
      clarification_questions: Array.isArray(it.clarification_questions) ? it.clarification_questions.map(String) : []
    });
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
    raw_input: rawInput,
    input_summary: String(raw.input_summary || rawInput).trim(),
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
 * Deterministic analysis fixture for unit testing and offline verification.
 * Accurately models the exact prompt requirements without external API calls.
 */
export function getMockNutritionAnalysis(text) {
  const t = text.toLowerCase();

  // Test Case 1: "100gm overnight soaked oats with 5 badam and 5 dry grapes and 150 gm of banana"
  if (t.includes('oat') && (t.includes('badam') || t.includes('almond')) && (t.includes('grape') || t.includes('raisin')) && t.includes('banana')) {
    return {
      input_summary: '100g overnight soaked oats with 5 almonds, 5 raisins, and 150g banana',
      calculation_status: 'complete',
      items: [
        {
          ingredient_name: 'Rolled Oats (Overnight Soaked)',
          explicit_quantity: 100,
          quantity_unit: 'g',
          is_quantity_estimated: false,
          estimated_weight_g: 100,
          is_weight_estimated: false,
          prep_state: 'soaked',
          energy_kcal: 389,
          protein_g: 16.9,
          carb_g: 66.3,
          fat_g: 6.9,
          fibre_g: 10.6,
          confidence: 'high',
          assumptions: ['Calculated for 100 g dry rolled oats weighed before soaking. Water absorbed during soaking adds weight without adding calories.'],
          clarification_questions: ['Did the 100 g refer to dry oats or soaked wet weight?']
        },
        {
          ingredient_name: 'Almonds (Badam)',
          explicit_quantity: 5,
          quantity_unit: 'piece',
          is_quantity_estimated: false,
          estimated_weight_g: 6,
          is_weight_estimated: true,
          prep_state: 'raw',
          energy_kcal: 34.7,
          protein_g: 1.3,
          carb_g: 1.3,
          fat_g: 3.0,
          fibre_g: 0.8,
          confidence: 'medium',
          assumptions: ['Estimated at 1.2 g average weight per raw almond kernel (5 pieces = 6.0 g).'],
          clarification_questions: []
        },
        {
          ingredient_name: 'Raisins (Dry Grapes)',
          explicit_quantity: 5,
          quantity_unit: 'piece',
          is_quantity_estimated: false,
          estimated_weight_g: 2.5,
          is_weight_estimated: true,
          prep_state: 'dried',
          energy_kcal: 7.5,
          protein_g: 0.1,
          carb_g: 2.0,
          fat_g: 0.0,
          fibre_g: 0.1,
          confidence: 'medium',
          assumptions: ['Estimated at 0.5 g average weight per raisin (5 pieces = 2.5 g).'],
          clarification_questions: []
        },
        {
          ingredient_name: 'Banana (Fresh)',
          explicit_quantity: 150,
          quantity_unit: 'g',
          is_quantity_estimated: false,
          estimated_weight_g: 150,
          is_weight_estimated: false,
          prep_state: 'raw',
          energy_kcal: 133.5,
          protein_g: 1.7,
          carb_g: 34.2,
          fat_g: 0.5,
          fibre_g: 3.9,
          confidence: 'high',
          assumptions: ['Calculated for 150 g peeled ripe banana as specified.'],
          clarification_questions: []
        }
      ],
      reconciliation_notes: 'Total meal calories (564.7 kcal) are reconciled by exact summation of the 4 ingredient estimates.',
      overall_assumptions: ['Standard USDA / ICMR nutrient composition tables applied.'],
      clarifications: ['Portions are editable before saving to your profile.']
    };
  }

  // Test Case 2: "2 wheat roti with chicken gravy"
  if (t.includes('roti') && (t.includes('gravy') || t.includes('curry'))) {
    return {
      input_summary: '2 wheat rotis with chicken gravy',
      calculation_status: 'needs_clarification',
      items: [
        {
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

  // Test Case 3: "100 g roasted peanuts"
  if (t.includes('peanut')) {
    return {
      input_summary: '100 g roasted peanuts',
      calculation_status: 'complete',
      items: [
        {
          ingredient_name: 'Roasted Peanuts',
          explicit_quantity: 100,
          quantity_unit: 'g',
          is_quantity_estimated: false,
          estimated_weight_g: 100,
          is_weight_estimated: false,
          prep_state: 'roasted',
          energy_kcal: 585,
          protein_g: 24.5,
          carb_g: 21.0,
          fat_g: 49.7,
          fibre_g: 8.0,
          confidence: 'high',
          assumptions: ['Dry roasted peanuts without added oil.'],
          clarification_questions: []
        }
      ],
      reconciliation_notes: 'Exact 100 g portion matches reference composition.',
      overall_assumptions: ['Dry roasted peanuts.'],
      clarifications: []
    };
  }

  // Test Case 4: "150 g rice, 100 g chicken and 1 tablespoon oil"
  if (t.includes('rice') && t.includes('chicken') && t.includes('oil')) {
    return {
      input_summary: '150 g rice, 100 g chicken, and 1 tablespoon oil',
      calculation_status: 'complete',
      items: [
        {
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

  // Fallback generic single item for generic inputs
  return {
    input_summary: text,
    calculation_status: 'approximate',
    items: [
      {
        ingredient_name: text.trim(),
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
      }
    ],
    reconciliation_notes: 'Single estimated item.',
    overall_assumptions: [],
    clarifications: []
  };
}

/**
 * Executes direct AI nutrition analysis via OpenAI API with strict JSON schema.
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

  // Test / offline fixture mode when OPENAI_API_KEY is unset or set to mock
  if (!client || process.env.OPENAI_API_KEY === 'mock-key' || process.env.NODE_ENV === 'test') {
    if (!client && process.env.NODE_ENV !== 'test') {
      throw new Error('OpenAI API key is not configured. Please set OPENAI_API_KEY in the server environment (.env) to enable AI nutrition analysis.');
    }
    const mock = getMockNutritionAnalysis(cleanText);
    return validateNutritionResponse(mock, cleanText);
  }

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
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
    if (err.name === 'TimeoutError' || err.code === 'ETIMEDOUT') {
      throw new Error(`OpenAI request timed out after ${timeoutMs / 1000} seconds. Please try again.`);
    }
    if (err.status === 401) {
      throw new Error('Authentication failed: Invalid OPENAI_API_KEY. Please verify your API key in .env.');
    }
    if (err.status === 429) {
      throw new Error('OpenAI rate limit or quota exceeded. Please check your account usage and limits.');
    }
    throw new Error(`OpenAI nutrition analysis failed: ${err.message || 'Unknown provider error'}`);
  }
}

export const parseMealWithOpenAI = analyzeMealDirectly;
