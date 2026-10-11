import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getFoodById,
  searchFoods,
  getUserTargets,
  setUserTargets,
  getMealLogs,
  addMealLog,
  updateMealLog,
  deleteMealLog,
  getRecipeIngredients
} from '../nutrition/db.js'
import { resolveGrams, calculateNutrients, calculateRecipeNutrition } from '../nutrition/engine.js'
import { parseMeal } from '../nutrition/parser.js'

test('Phase 10: Dataset import validation and repeatability', () => {
  // Database should contain the core staples with verified compositions
  const roti = getFoodById('STAPLE:roti')
  assert.ok(roti, 'STAPLE:roti exists')
  assert.ok(roti.canonical_name.includes('wheat roti'))
  assert.equal(roti.prep_state, 'cooked')
  assert.equal(roti.energy_kcal, 297)
  assert.equal(roti.protein_g, 9)

  const rice = getFoodById('STAPLE:cooked_rice')
  assert.ok(rice, 'STAPLE:cooked_rice exists')
  assert.equal(rice.energy_kcal, 130)
  assert.equal(rice.protein_g, 2.7)

  const chicken = getFoodById('STAPLE:chicken_cooked')
  assert.ok(chicken, 'STAPLE:chicken_cooked exists')
  assert.equal(chicken.energy_kcal, 165)
  assert.equal(chicken.protein_g, 31)

  const oil = getFoodById('STAPLE:cooking_oil')
  assert.ok(oil, 'STAPLE:cooking_oil exists')
  assert.equal(oil.energy_kcal, 884)
  assert.equal(oil.fat_g, 100)

  const peanuts = getFoodById('STAPLE:peanuts_roasted')
  assert.ok(peanuts, 'STAPLE:peanuts_roasted exists')
  assert.equal(peanuts.energy_kcal, 585)
  assert.equal(peanuts.protein_g, 24.5)
})

test('Phase 10: Nutrient calculations per 100 g and per serving', () => {
  const rice = getFoodById('STAPLE:cooked_rice')
  // 150 g cooked rice: 150 / 100 * 130 kcal = 195 kcal
  const portion = resolveGrams(rice, 150, 'g')
  assert.equal(portion.grams, 150)
  const nutrients = calculateNutrients(rice, portion.grams)
  assert.equal(nutrients.energy_kcal, 195)
  assert.equal(nutrients.protein_g, 4.1) // rounded to 1 decimal place: 4.05 -> 4.1
  assert.equal(nutrients.carb_g, 42.3)
  assert.equal(nutrients.fat_g, 0.5) // 0.45 -> 0.5
})

test('Phase 10: Unit conversions and portion scaling', () => {
  const roti = getFoodById('STAPLE:roti')
  // 1 roti = 35g. 2 roti = 70g.
  // 70 / 100 * 297 = 207.9 kcal; 70 / 100 * 9 = 6.3 g protein
  const rotiPortion = resolveGrams(roti, 2, 'piece')
  assert.equal(rotiPortion.grams, 70)
  const rotiNutrients = calculateNutrients(roti, rotiPortion.grams)
  assert.equal(rotiNutrients.energy_kcal, 207.9)
  assert.equal(rotiNutrients.protein_g, 6.3)

  // 1 tablespoon oil = 14g.
  // 14 / 100 * 884 = 123.8 kcal; 14g fat
  const oil = getFoodById('STAPLE:cooking_oil')
  const oilPortion = resolveGrams(oil, 1, 'tbsp')
  assert.equal(oilPortion.grams, 14)
  const oilNutrients = calculateNutrients(oil, oilPortion.grams)
  assert.equal(oilNutrients.energy_kcal, 123.8)
  assert.equal(oilNutrients.fat_g, 14)
})

test('Phase 10: Missing values, trace values, and null safety', () => {
  const customFood = {
    id: 'TEST:001',
    name: 'Sample Food',
    serving_basis_g: 100,
    energy_kcal: 100,
    protein_g: 5,
    carb_g: 15,
    fat_g: 2,
    fibre_g: null, // missing value
    sugar_g: undefined, // undefined
    sodium_mg: 0
  }
  const calc = calculateNutrients(customFood, 100)
  assert.equal(calc.energy_kcal, 100)
  assert.equal(calc.protein_g, 5)
  assert.equal(calc.fibre_g, 0, 'Missing fibre defaults to 0 safely')
  assert.equal(calc.sugar_g, 0, 'Missing sugar defaults to 0 safely')
  assert.ok(!Number.isNaN(calc.energy_kcal))
})

test('Phase 10: Raw versus cooked ingredients separation', () => {
  const cookedChicken = getFoodById('STAPLE:chicken_cooked')
  assert.equal(cookedChicken.prep_state, 'cooked')
  assert.equal(cookedChicken.energy_kcal, 165)
  assert.equal(cookedChicken.protein_g, 31)

  // Inverted search for chicken cooked returns cooked profile
  const searchCooked = searchFoods('chicken cooked', 5)
  assert.ok(searchCooked.length > 0)
  assert.equal(searchCooked[0].id, 'STAPLE:chicken_cooked')
})

test('Phase 10: Recipe ingredient totals and cooked yield', () => {
  const dosa = getFoodById('RECIPE:BFP148')
  if (dosa) {
    assert.equal(dosa.is_recipe, 1)
    const ings = getRecipeIngredients(dosa.source_id || 'BFP148')
    assert.ok(Array.isArray(ings))
    // Nutrition of recipe
    const portion = resolveGrams(dosa, 2, 'piece')
    assert.ok(portion.grams > 0)
    const nuts = calculateNutrients(dosa, portion.grams)
    assert.ok(nuts.energy_kcal > 0)
    assert.ok(nuts.protein_g > 0)
  }
})

test('Phase 10: Conflicting food matches and ambiguous quantities parsing', () => {
  // 1. Bare "Peanuts" should detect ambiguity and ask clarification
  const resPeanuts = parseMeal('Peanuts')
  assert.equal(resPeanuts.items.length, 1)
  assert.ok(resPeanuts.items[0].clarification, 'Peanuts without portion should trigger clarification')
  assert.ok(resPeanuts.items[0].clarification.includes('raw or roasted') || resPeanuts.items[0].clarification.includes('peanuts'))

  // 2. "100 g roasted peanuts" should be unambiguous
  const resRoasted = parseMeal('100 g roasted peanuts')
  assert.equal(resRoasted.items.length, 1)
  assert.equal(resRoasted.items[0].clarification, null)
  assert.equal(resRoasted.items[0].quantity, 100)
  assert.equal(resRoasted.items[0].unit, 'g')
  assert.equal(resRoasted.items[0].food_id, 'STAPLE:peanuts_roasted')

  // 3. Multi-item meal parsing: "150 g rice, 100 g chicken and 1 tablespoon oil"
  const meal = parseMeal('150 g rice, 100 g chicken and 1 tablespoon oil')
  assert.equal(meal.items.length, 3, 'Decomposes into 3 distinct food items')
  assert.equal(meal.items[0].food_id, 'STAPLE:cooked_rice')
  assert.equal(meal.items[0].quantity, 150)
  assert.equal(meal.items[0].unit, 'g')

  assert.equal(meal.items[1].food_id, 'STAPLE:chicken_cooked')
  assert.equal(meal.items[1].quantity, 100)
  assert.equal(meal.items[1].unit, 'g')

  assert.equal(meal.items[2].food_id, 'STAPLE:cooking_oil')
  assert.equal(meal.items[2].quantity, 1)
  assert.equal(meal.items[2].unit, 'tbsp')
})

test('Phase 10: Meal logging, updates, deletions, and user-data isolation', () => {
  const userA = 'test_user_alpha'
  const userB = 'test_user_beta'
  const date = '2026-10-11'

  // Configure target for userA
  const targets = setUserTargets(userA, {
    calories: 2200,
    protein: 160,
    carbs: 250,
    fat: 65,
    fibre: 30
  })
  assert.equal(targets.calorie_target, 2200)

  // Read targets back
  const readTargets = getUserTargets(userA)
  assert.equal(readTargets.calorie_target, 2200)

  // 1. Add breakfast entry for userA
  const entry1 = addMealLog({
    id: 'meal_test_1',
    user_id: userA,
    date,
    meal_type: 'breakfast',
    food_id: 'STAPLE:roti',
    food_name: 'Wheat Roti / Chapati',
    serving_quantity: 2,
    serving_unit: 'piece',
    serving_grams: 70,
    energy_kcal: 182,
    protein_g: 5.95,
    carb_g: 32.2,
    fat_g: 2.1,
    fibre_g: 4.2,
    assumptions: '{"notes":[]}',
    created_at: new Date().toISOString()
  })
  assert.ok(entry1.id)

  // 2. Add lunch entry for userA
  const entry2 = addMealLog({
    id: 'meal_test_2',
    user_id: userA,
    date,
    meal_type: 'lunch',
    food_id: 'STAPLE:cooked_rice',
    food_name: 'Cooked Rice',
    serving_quantity: 150,
    serving_unit: 'g',
    serving_grams: 150,
    energy_kcal: 195,
    protein_g: 4.05,
    carb_g: 42,
    fat_g: 0.45,
    fibre_g: 0.6,
    assumptions: '{"notes":[]}',
    created_at: new Date().toISOString()
  })
  assert.ok(entry2.id)

  // 3. User isolation: userB should see 0 meals
  const userBMeals = getMealLogs(userB, date)
  assert.equal(userBMeals.length, 0, 'User B cannot see User A meal logs')

  // 4. User A should have 2 meals
  const userAMeals = getMealLogs(userA, date)
  assert.equal(userAMeals.length, 2)

  // 5. Update entry: scale roti from 2 to 3 pieces
  const updated = updateMealLog(entry1.id, userA, {
    serving_quantity: 3,
    serving_unit: 'piece',
    serving_grams: 105,
    energy_kcal: 273,
    protein_g: 8.9,
    carb_g: 48.3,
    fat_g: 3.15,
    fibre_g: 6.3
  })
  assert.equal(updated.serving_quantity, 3)
  assert.equal(updated.energy_kcal, 273)

  // 6. Delete entry
  const delOk = deleteMealLog(entry1.id, userA)
  assert.equal(delOk, true)
  const remainingMeals = getMealLogs(userA, date)
  assert.equal(remainingMeals.length, 1)
  assert.equal(remainingMeals[0].id, entry2.id)

  // Clean up
  deleteMealLog(entry2.id, userA)
})

test('Phase 10: Screenshot regression — multi-food breakfast calculation bugfix', () => {
  const input = '100 gm overnight soaked oats with honey and 150gm bannana and 5 badam and 5 dry grapes . and 3 boiled eggs'
  const res = parseMeal(input)

  assert.equal(res.items.length, 6, 'Decomposes into exactly 6 distinct foods')
  assert.equal(res.all_matched, true, 'All 6 foods matched successfully to verified records')

  // Item 1: Rolled oats (100 gm -> 100 g, NOT 10,000 g)
  const oats = res.items[0]
  assert.ok(oats.food_name.toLowerCase().includes('oat'))
  assert.equal(oats.quantity, 100)
  assert.equal(oats.unit, 'g')
  assert.equal(oats.grams, 100)
  assert.equal(oats.nutrients.energy_kcal, 389)

  // Item 2: Honey (unspecified portion -> 1 tbsp = 21 g, NOT 100 g)
  const honey = res.items[1]
  assert.ok(honey.food_name.toLowerCase().includes('honey'))
  assert.equal(honey.grams, 21)
  assert.equal(honey.nutrients.energy_kcal, 63.8)

  // Item 3: Banana (150gm with typo bannana -> 150 g, NOT ghost card)
  const banana = res.items[2]
  assert.ok(banana.food_name.toLowerCase().includes('banana'))
  assert.equal(banana.grams, 150)
  assert.equal(banana.nutrients.energy_kcal, 133.5)

  // Item 4: Badam / almonds (5 pieces -> 6 g, NOT 500 g)
  const badam = res.items[3]
  assert.ok(badam.food_name.toLowerCase().includes('almond') || badam.food_name.toLowerCase().includes('badam'))
  assert.equal(badam.quantity, 5)
  assert.equal(badam.grams, 6)
  assert.equal(badam.nutrients.energy_kcal, 34.7)

  // Item 5: Dry grapes / raisins (5 pieces -> 2.5 g, NOT dry arbi 781 g)
  const raisins = res.items[4]
  assert.ok(raisins.food_name.toLowerCase().includes('raisin') || raisins.food_name.toLowerCase().includes('dry grape'))
  assert.equal(raisins.quantity, 5)
  assert.equal(raisins.grams, 2.5)
  assert.equal(raisins.nutrients.energy_kcal, 7.5)

  // Item 6: Boiled eggs (3 eggs -> 150 g)
  const eggs = res.items[5]
  assert.ok(eggs.food_name.toLowerCase().includes('egg'))
  assert.equal(eggs.quantity, 3)
  assert.equal(eggs.grams, 150)
  assert.equal(eggs.nutrients.energy_kcal, 214.5)

  // Total meal calories MUST be approximately 843 kcal, NOT 19,794.2 kcal
  assert.ok(res.totals.energy_kcal > 800 && res.totals.energy_kcal < 900, `Expected ~843 kcal, got ${res.totals.energy_kcal} kcal`)
  assert.ok(res.totals.protein_g > 35 && res.totals.protein_g < 45, `Expected ~39 g protein, got ${res.totals.protein_g} g`)
})

test('Phase 10: Unit conversions with metric gm and gms aliases', () => {
  const oats = getFoodById('STAPLE:oats')
  const portionGm = resolveGrams(oats, 100, 'gm')
  assert.equal(portionGm.grams, 100, '100 gm resolves to 100 grams')

  const portionGms = resolveGrams(oats, 50, 'gms')
  assert.equal(portionGms.grams, 50, '50 gms resolves to 50 grams')
})

test('Phase 10: Invalid quantity rejection and ghost card prevention', () => {
  // Reject negative or zero quantity
  const neg = parseMeal('-5 g oats')
  assert.equal(neg.items[0].matched, false)
  assert.ok(neg.items[0].error.includes('Invalid food quantity'))

  // Unmatched food should have food_name populated so frontend doesn't render empty ghost card
  const unknown = parseMeal('100 g xyznonexistentfoodabc')
  assert.equal(unknown.items[0].matched, false)
  assert.equal(unknown.items[0].food_name, 'xyznonexistentfoodabc')
  assert.ok(unknown.items[0].error.includes('Could not find verified food'))
})

