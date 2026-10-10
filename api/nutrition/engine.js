/**
 * Deterministic Nutrition Calculation Engine
 * 
 * Rules:
 * nutrient amount = edible ingredient grams / 100 * nutrient value per 100g
 * Never predicts random macros; computes strictly from verified composition data.
 */

import { getPortionUnits, getFoodById } from './db.js';

const STANDARD_UNIT_GRAMS = {
  g: 1,
  gram: 1,
  grams: 1,
  kg: 1000,
  ml: 1,
  l: 1000,
  liter: 1000,
  litre: 1000,
  tbsp: 15,
  tablespoon: 15,
  tablespoons: 15,
  tsp: 5,
  teaspoon: 5,
  teaspoons: 5,
  cup: 200,
  cups: 200,
  katori: 150,
  katoris: 150,
  bowl: 250,
  bowls: 250,
  roti: 35,
  rotis: 35,
  chapati: 35,
  chapatis: 35,
  slice: 30,
  slices: 30,
  piece: 50,
  pieces: 50,
  serving: 150,
  servings: 150,
  plate: 350
};

/**
 * Resolves ingredient/food quantity and unit into gram weight.
 * Checks food-specific portion database, then generic standard units.
 */
export function resolveGrams(food, quantity, unit) {
  const q = Number(quantity) || 1;
  const u = String(unit || 'g').trim().toLowerCase();

  if (u === 'g' || u === 'gram' || u === 'grams') {
    return { grams: q, unit: 'g', assumption: null };
  }
  if (u === 'kg') {
    return { grams: q * 1000, unit: 'kg', assumption: null };
  }
  if (u === 'ml') {
    return { grams: q, unit: 'ml', assumption: 'Assumed 1 ml ≈ 1 g' };
  }
  if (u === 'l' || u === 'liter' || u === 'litre') {
    return { grams: q * 1000, unit: 'l', assumption: 'Assumed 1 L ≈ 1000 g' };
  }

  // If unit matches food's serving unit or generic serving/piece:
  const servUnit = (food?.serving_unit || '').toLowerCase();
  const isPieceOrServing = u === 'serving' || u === 'servings' || u === 'piece' || u === 'pieces' || u === servUnit;
  if (isPieceOrServing && food?.serving_size_g) {
    return {
      grams: q * food.serving_size_g,
      unit: food.serving_unit || u,
      assumption: `1 ${food.serving_unit || u} = ${food.serving_size_g} g`
    };
  }

  // Check food-specific portion units in database
  const foodName = food?.name || '';
  const portionRules = getPortionUnits(foodName);
  const match = portionRules.find(p => p.unit_name.toLowerCase() === u);
  if (match) {
    return {
      grams: q * match.gram_weight,
      unit: u,
      assumption: `1 ${u} = ${match.gram_weight} g (${match.food_pattern || 'standard'})`
    };
  }

  // Check standard generic unit dictionary
  if (STANDARD_UNIT_GRAMS[u]) {
    const baseGrams = STANDARD_UNIT_GRAMS[u];
    // Special cases based on food type:
    let finalGrams = baseGrams;
    let note = `1 ${u} ≈ ${baseGrams} g`;

    if (u === 'cup' && /rice|biryani|pulao/i.test(foodName)) {
      finalGrams = 150;
      note = `1 cup cooked rice ≈ 150 g`;
    } else if (u === 'cup' && /milk|curd|yogurt|tea|coffee/i.test(foodName)) {
      finalGrams = 240;
      note = `1 cup liquid ≈ 240 g`;
    } else if (/oil|ghee|butter/i.test(foodName) && (u === 'tbsp' || u === 'tablespoon')) {
      finalGrams = 14;
      note = `1 tbsp oil/fat = 14 g`;
    } else if (/oil|ghee|butter/i.test(foodName) && (u === 'tsp' || u === 'teaspoon')) {
      finalGrams = 4.5;
      note = `1 tsp oil/fat = 4.5 g`;
    }

    return {
      grams: q * finalGrams,
      unit: u,
      assumption: note
    };
  }

  // Fallback: If unit is unknown, default to food's serving size or 100g
  const defaultSize = food?.serving_size_g || 100;
  return {
    grams: q * defaultSize,
    unit: u || 'serving',
    assumption: `Unrecognized unit "${u}" — default to ${defaultSize} g per portion`
  };
}

/**
 * Calculates nutrients from food composition given gram weight.
 */
export function calculateNutrients(food, grams) {
  const g = Math.max(0, Number(grams) || 0);
  const basis = food.serving_basis_g || 100;
  const factor = g / basis;

  return {
    grams: Math.round(g * 10) / 10,
    energy_kcal: Math.round((food.energy_kcal || 0) * factor * 10) / 10,
    protein_g: Math.round((food.protein_g || 0) * factor * 10) / 10,
    carb_g: Math.round((food.carb_g || 0) * factor * 10) / 10,
    fat_g: Math.round((food.fat_g || 0) * factor * 10) / 10,
    fibre_g: Math.round((food.fibre_g || 0) * factor * 10) / 10,
    sugar_g: Math.round((food.sugar_g || 0) * factor * 10) / 10,
    sodium_mg: Math.round((food.sodium_mg || 0) * factor * 10) / 10
  };
}

/**
 * Calculates complete recipe nutrition from a list of ingredients.
 * ingredients: [{ food_id, amount, unit }]
 */
export function calculateRecipeNutrition(ingredients, recipeServings = 1) {
  let totalGrams = 0;
  let totalKcal = 0;
  let totalProtein = 0;
  let totalCarb = 0;
  let totalFat = 0;
  let totalFibre = 0;
  const ingredientDetails = [];
  const assumptions = [];

  for (const ing of ingredients) {
    const food = ing.food || (ing.food_id ? getFoodById(ing.food_id) : null);
    if (!food) {
      assumptions.push(`Warning: Unknown ingredient "${ing.name || ing.food_id}" skipped.`);
      continue;
    }
    const portion = resolveGrams(food, ing.amount, ing.unit);
    const nuts = calculateNutrients(food, portion.grams);

    totalGrams += portion.grams;
    totalKcal += nuts.energy_kcal;
    totalProtein += nuts.protein_g;
    totalCarb += nuts.carb_g;
    totalFat += nuts.fat_g;
    totalFibre += nuts.fibre_g;

    ingredientDetails.push({
      food_id: food.id,
      name: food.name,
      amount: ing.amount,
      unit: ing.unit,
      grams: portion.grams,
      energy_kcal: nuts.energy_kcal,
      protein_g: nuts.protein_g,
      carb_g: nuts.carb_g,
      fat_g: nuts.fat_g,
      fibre_g: nuts.fibre_g,
      assumption: portion.assumption
    });

    if (portion.assumption) assumptions.push(`${food.name}: ${portion.assumption}`);
  }

  const servings = Math.max(1, Number(recipeServings) || 1);
  const factor100 = totalGrams > 0 ? (100 / totalGrams) : 0;

  return {
    total_recipe_grams: Math.round(totalGrams * 10) / 10,
    servings,
    per_100g: {
      energy_kcal: Math.round(totalKcal * factor100 * 10) / 10,
      protein_g: Math.round(totalProtein * factor100 * 10) / 10,
      carb_g: Math.round(totalCarb * factor100 * 10) / 10,
      fat_g: Math.round(totalFat * factor100 * 10) / 10,
      fibre_g: Math.round(totalFibre * factor100 * 10) / 10
    },
    per_serving: {
      serving_grams: Math.round((totalGrams / servings) * 10) / 10,
      energy_kcal: Math.round((totalKcal / servings) * 10) / 10,
      protein_g: Math.round((totalProtein / servings) * 10) / 10,
      carb_g: Math.round((totalCarb / servings) * 10) / 10,
      fat_g: Math.round((totalFat / servings) * 10) / 10,
      fibre_g: Math.round((totalFibre / servings) * 10) / 10
    },
    ingredients: ingredientDetails,
    assumptions
  };
}
