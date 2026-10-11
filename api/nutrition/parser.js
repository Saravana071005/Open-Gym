import { searchFoods, getFoodById } from './db.js';
import { resolveGrams, calculateNutrients } from './engine.js';
import { parseMealWithGemini } from './gemini.js';

const WORD_NUMBERS = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  half: 0.5,
  quarter: 0.25
};

const UNIT_ALIASES = {
  g: 'g', gm: 'g', gms: 'g', gram: 'g', grams: 'g',
  kg: 'kg', kgs: 'kg', kilogram: 'kg', kilograms: 'kg',
  ml: 'ml', milliliter: 'ml', millilitre: 'ml', milliliters: 'ml', millilitres: 'ml',
  l: 'l', liter: 'l', litre: 'l', liters: 'l', litres: 'l',
  cup: 'cup', cups: 'cup',
  katori: 'katori', katoris: 'katori',
  bowl: 'bowl', bowls: 'bowl',
  slice: 'slice', slices: 'slice',
  piece: 'piece', pieces: 'piece', pc: 'piece', pcs: 'piece',
  tbsp: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
  tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  serving: 'serving', servings: 'serving', portion: 'serving', portions: 'serving',
  plate: 'plate', plates: 'plate'
};

const SYNONYMS = {
  'bannana': 'banana',
  'bannanas': 'banana',
  'badam': 'almond',
  'badams': 'almonds',
  'dry grapes': 'raisins',
  'dry grape': 'raisin',
  'kishmish': 'raisins',
  'kismis': 'raisins',
  'overnight soaked oats': 'oats',
  'soaked oats': 'oats',
  'overnight oats': 'oats',
  'anda': 'egg',
  'muttai': 'egg',
  'chawal': 'rice',
  'sadam': 'rice',
  'curd': 'yogurt',
  'dahi': 'yogurt'
};

const MODIFIERS = new Set([
  'dry', 'soaked', 'overnight', 'fresh', 'hot', 'cold', 'raw',
  'boiled', 'cooked', 'fried', 'steamed', 'baked', 'roasted',
  'ripe', 'whole', 'cut', 'sliced', 'chopped', 'medium', 'large', 'small'
]);

const PREP_STATES = [
  'overnight soaked', 'soaked', 'dry roasted', 'oil roasted',
  'raw', 'roasted', 'boiled', 'cooked', 'fried', 'deep fried',
  'steamed', 'baked', 'grilled'
];

/**
 * Splits a complex input sentence into individual food clauses.
 */
export function splitMealInput(text) {
  if (!text || typeof text !== 'string') return [];
  // Split on delimiters: comma, semicolon, newline, period, " and ", " with ", " + "
  let parts = text
    .split(/\r?\n|;|,|\.|\band\b|\bwith\b|\+/i)
    .map(p => p.trim())
    .filter(p => p.length > 0 && !/^[\.\,\;\:\!\?\-\+]+$/.test(p));
  return parts;
}

/**
 * Extracts quantity, unit, preparation state, and core food name from a single clause.
 */
export function extractEntities(phrase) {
  let cleaned = phrase.trim();

  // Strip leading fluff: "a plate of", "some", "bowl of"
  cleaned = cleaned.replace(/^(a\s+plate\s+of|some|a\s+bowl\s+of|a\s+cup\s+of|a\s+handful\s+of)\s+/i, '');

  let quantity = 1;
  let unit = null;
  let prepState = null;
  let hasExplicitQuantity = false;

  // 1. Detect preparation state
  for (const ps of PREP_STATES) {
    const reg = new RegExp(`\\b${ps}\\b`, 'i');
    if (reg.test(cleaned)) {
      prepState = ps;
      cleaned = cleaned.replace(reg, ' ').replace(/\s+/, ' ').trim();
      break;
    }
  }

  // 2. Check fraction e.g. 1/2 cup
  const fracMatch = cleaned.match(/^(\d+)\s*\/\s*(\d+)\s*([a-zA-Z]+)?\s*(.*)$/);
  if (fracMatch) {
    hasExplicitQuantity = true;
    quantity = Number(fracMatch[1]) / Number(fracMatch[2]);
    const potentialUnit = fracMatch[3]?.toLowerCase();
    if (potentialUnit && UNIT_ALIASES[potentialUnit]) {
      unit = UNIT_ALIASES[potentialUnit];
      cleaned = fracMatch[4].trim();
    } else {
      cleaned = `${fracMatch[3] || ''} ${fracMatch[4] || ''}`.trim();
    }
  } else {
    // Number followed by optional unit (e.g. "150gm banana", "100 gm oats", "5 badam")
    const numMatch = cleaned.match(/^(-?\d+(?:\.\d+)?)\s*([a-zA-Z]+)?\s*(.*)$/);
    if (numMatch) {
      hasExplicitQuantity = true;
      quantity = Number(numMatch[1]);
      const potentialUnit = numMatch[2]?.toLowerCase();
      if (potentialUnit && UNIT_ALIASES[potentialUnit]) {
        unit = UNIT_ALIASES[potentialUnit];
        cleaned = numMatch[3].trim();
      } else if (potentialUnit) {
        cleaned = `${numMatch[2]} ${numMatch[3] || ''}`.trim();
      }
      cleaned = cleaned.replace(/^of\s+/i, '');
    } else {
      // Check word number (e.g. "two wheat roti")
      const words = cleaned.split(/\s+/);
      const firstWord = words[0]?.toLowerCase();
      if (WORD_NUMBERS[firstWord] !== undefined) {
        hasExplicitQuantity = true;
        quantity = WORD_NUMBERS[firstWord];
        const secondWord = words[1]?.toLowerCase();
        if (secondWord && UNIT_ALIASES[secondWord]) {
          unit = UNIT_ALIASES[secondWord];
          cleaned = words.slice(2).join(' ');
        } else {
          cleaned = words.slice(1).join(' ');
        }
      }
    }
  }

  // If unit is still null, look for unit at end or middle (e.g. "wheat roti 2 pieces")
  if (!unit) {
    for (const [alias, standard] of Object.entries(UNIT_ALIASES)) {
      const uRegex = new RegExp(`\\b${alias}\\b`, 'i');
      if (uRegex.test(cleaned)) {
        unit = standard;
        const stripped = cleaned.replace(uRegex, ' ').replace(/\s+/, ' ').trim();
        if (stripped.length > 0 && !['wheat', 'cooked', 'steamed', 'white', 'brown', 'raw', 'boiled'].includes(stripped.toLowerCase())) {
          cleaned = stripped;
        }
        break;
      }
    }
  }

  // Default unit if not set
  if (!unit) {
    // If condiment/liquid sweetener mentioned without quantity, default to tbsp
    if (/honey|oil|ghee|butter|sugar/i.test(cleaned)) {
      unit = 'tbsp';
    } else {
      unit = hasExplicitQuantity ? 'piece' : 'serving';
    }
  }

  return {
    rawPhrase: phrase,
    coreFoodQuery: cleaned.trim(),
    quantity,
    hasExplicitQuantity,
    unit,
    prepState
  };
}

/**
 * Matches core query to food database and calculates nutrition.
 */
export function matchAndCalculate(parsedItem) {
  const { coreFoodQuery, quantity, hasExplicitQuantity, unit, prepState, rawPhrase } = parsedItem;
  const assumptions = [];
  let clarification = null;

  // Validate quantity
  const qNum = Number(quantity);
  if (isNaN(qNum) || qNum <= 0 || qNum > 100000) {
    return {
      query: rawPhrase,
      coreQuery: coreFoodQuery,
      food_name: coreFoodQuery,
      quantity: 0,
      unit: unit || 'g',
      matched: false,
      error: `Invalid food quantity "${quantity}". Please enter a valid portion size.`,
      alternatives: []
    };
  }

  // Apply synonym/typo normalization
  let lookupQuery = coreFoodQuery.toLowerCase().trim();
  if (SYNONYMS[lookupQuery]) {
    lookupQuery = SYNONYMS[lookupQuery];
  }

  // Search candidate foods
  let candidates = searchFoods(lookupQuery, 5);

  // If no match and multi-word query, search with non-modifier tokens
  if (!candidates.length && lookupQuery.includes(' ')) {
    const tokens = lookupQuery.split(/\s+/).filter(t => t.length > 2 && !MODIFIERS.has(t));
    for (const tok of tokens) {
      const sub = SYNONYMS[tok] || tok;
      candidates = searchFoods(sub, 5);
      if (candidates.length) break;
    }
  }

  // If still no candidates, search raw original phrase without prep state
  if (!candidates.length && coreFoodQuery.toLowerCase() !== lookupQuery) {
    candidates = searchFoods(coreFoodQuery, 5);
  }

  if (!candidates.length) {
    return {
      query: rawPhrase,
      coreQuery: coreFoodQuery,
      food_name: coreFoodQuery,
      quantity: qNum,
      unit: unit || 'serving',
      matched: false,
      error: `Could not find verified food matching "${coreFoodQuery}".`,
      alternatives: []
    };
  }

  const bestFood = candidates[0];
  const alternatives = candidates.slice(1).map(c => ({ id: c.id, name: c.name, source: c.source }));

  // Check ambiguity & generate clarifications
  const qLower = lookupQuery.toLowerCase();
  if (qLower.includes('peanut') || qLower.includes('groundnut')) {
    if (!prepState) {
      clarification = "Are the peanuts raw, dry-roasted, or oil-roasted? (Defaulting to dry-roasted values)";
      assumptions.push("Assumed dry-roasted peanuts");
    }
  }

  if (qLower.includes('roti') || qLower.includes('chapati')) {
    assumptions.push(`Calculated for standard medium roti (~35 g each)`);
  }

  if (qLower.includes('gravy') || qLower.includes('curry')) {
    if (!hasExplicitQuantity || unit === 'serving') {
      clarification = "Portion assumed as 1 katori (150 g). You can adjust grams if known.";
      assumptions.push("Assumed 1 katori (~150 g) gravy");
    }
  }

  if (!hasExplicitQuantity && !['tbsp', 'piece'].includes(unit)) {
    assumptions.push(`Default portion assumed (${bestFood.serving_size_g || 100} ${bestFood.serving_unit || 'g'}) — editable before logging`);
  }

  // Resolve grams and nutrients
  const portion = resolveGrams(bestFood, qNum, unit);
  if (portion.assumption) assumptions.push(portion.assumption);

  const nutrients = calculateNutrients(bestFood, portion.grams);

  return {
    query: rawPhrase,
    coreQuery: coreFoodQuery,
    matched: true,
    food_id: bestFood.id,
    food_name: bestFood.name,
    tamil_name: bestFood.tamil_name || null,
    source: bestFood.source,
    is_recipe: !!bestFood.is_recipe,
    quantity: qNum,
    unit: portion.unit,
    grams: portion.grams,
    prep_state: prepState || bestFood.prep_state || 'cooked',
    nutrients: {
      energy_kcal: nutrients.energy_kcal,
      protein_g: nutrients.protein_g,
      carb_g: nutrients.carb_g,
      fat_g: nutrients.fat_g,
      fibre_g: nutrients.fibre_g,
      sugar_g: nutrients.sugar_g,
      sodium_mg: nutrients.sodium_mg
    },
    confidence: bestFood.confidence || 'high',
    assumptions,
    clarification,
    alternatives
  };
}

/**
 * Parses full natural-language meal input and aggregates total nutrients synchronously.
 */
export function parseMeal(text) {
  const clauses = splitMealInput(text);
  const items = [];
  const totals = {
    energy_kcal: 0,
    protein_g: 0,
    carb_g: 0,
    fat_g: 0,
    fibre_g: 0
  };

  for (const clause of clauses) {
    const parsed = extractEntities(clause);
    if (!parsed.coreFoodQuery) continue;
    const calcResult = matchAndCalculate(parsed);
    items.push(calcResult);

    if (calcResult.matched && calcResult.nutrients) {
      totals.energy_kcal += calcResult.nutrients.energy_kcal;
      totals.protein_g += calcResult.nutrients.protein_g;
      totals.carb_g += calcResult.nutrients.carb_g;
      totals.fat_g += calcResult.nutrients.fat_g;
      totals.fibre_g += calcResult.nutrients.fibre_g;
    }
  }

  // Round totals
  totals.energy_kcal = Math.round(totals.energy_kcal * 10) / 10;
  totals.protein_g = Math.round(totals.protein_g * 10) / 10;
  totals.carb_g = Math.round(totals.carb_g * 10) / 10;
  totals.fat_g = Math.round(totals.fat_g * 10) / 10;
  totals.fibre_g = Math.round(totals.fibre_g * 10) / 10;

  return {
    raw_input: text,
    items,
    totals,
    item_count: items.length,
    all_matched: items.length > 0 && items.every(i => i.matched)
  };
}

/**
 * Asynchronously parses meal input using Google Gemini structured output when configured,
 * falling back gracefully to local deterministic rule-based parser.
 */
export async function parseMealAsync(text) {
  // 1. Attempt Gemini structured parsing if client configured
  const aiItems = await parseMealWithGemini(text);
  if (aiItems && Array.isArray(aiItems) && aiItems.length > 0) {
    const items = [];
    const totals = {
      energy_kcal: 0,
      protein_g: 0,
      carb_g: 0,
      fat_g: 0,
      fibre_g: 0
    };

    for (const aiItem of aiItems) {
      const parsed = {
        rawPhrase: aiItem.originalText || aiItem.raw_phrase || aiItem.foodName || aiItem.food_name,
        coreFoodQuery: aiItem.foodName || aiItem.food_name,
        quantity: aiItem.quantity,
        hasExplicitQuantity: true,
        unit: aiItem.unit,
        prepState: aiItem.preparation || aiItem.prep_state || null,
        ingredients: aiItem.ingredients || []
      };

      const calcResult = matchAndCalculate(parsed);
      if ((aiItem.clarificationQuestions?.[0] || aiItem.clarification_needed) && !calcResult.clarification) {
        calcResult.clarification = aiItem.clarificationQuestions?.[0] || aiItem.clarification_needed;
      }
      items.push(calcResult);

      if (calcResult.matched && calcResult.nutrients) {
        totals.energy_kcal += calcResult.nutrients.energy_kcal;
        totals.protein_g += calcResult.nutrients.protein_g;
        totals.carb_g += calcResult.nutrients.carb_g;
        totals.fat_g += calcResult.nutrients.fat_g;
        totals.fibre_g += calcResult.nutrients.fibre_g;
      }
    }

    totals.energy_kcal = Math.round(totals.energy_kcal * 10) / 10;
    totals.protein_g = Math.round(totals.protein_g * 10) / 10;
    totals.carb_g = Math.round(totals.carb_g * 10) / 10;
    totals.fat_g = Math.round(totals.fat_g * 10) / 10;
    totals.fibre_g = Math.round(totals.fibre_g * 10) / 10;

    return {
      raw_input: text,
      items,
      totals,
      item_count: items.length,
      all_matched: items.length > 0 && items.every(i => i.matched),
      provider: 'gemini'
    };
  }

  // 2. Fallback to local rule-based deterministic parser
  const result = parseMeal(text);
  result.provider = 'local_nlp';
  return result;
}
