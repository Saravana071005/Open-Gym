import test from 'node:test'
import assert from 'node:assert/strict'

process.env.NODE_ENV = 'test'

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

/* =========================================================================
 * Daily Health Log & Activity Tracking Tests (1,900 kcal Target)
 * ========================================================================= */
import {
  getWaterLogs,
  addWaterLog,
  deleteWaterLog,
  getCardioLogs,
  addCardioLog,
  updateCardioLog,
  deleteCardioLog,
  getStrengthLogs,
  addStrengthLog,
  updateStrengthLog,
  deleteStrengthLog,
  getDailyHealthSettings,
  setDailyHealthSettings
} from '../nutrition/db.js'
import { nutritionRoutes } from '../nutrition/routes.js'

test('Daily Health Log: Manual food intake tracking with custom macros', () => {
  const userId = 'test_user_health_1'
  const date = '2026-10-25'

  // Add 100g oats with manually entered macros
  const oats = addMealLog({
    id: 'food_1',
    user_id: userId,
    date,
    meal_type: 'breakfast',
    food_name: 'Rolled Oats',
    serving_quantity: 100,
    serving_unit: 'g',
    serving_grams: 100,
    energy_kcal: 389,
    protein_g: 16.9,
    carb_g: 66.3,
    fat_g: 6.9,
    fibre_g: 10.6,
    notes: 'Breakfast oats'
  })

  // Add 2 boiled eggs manually
  const eggs = addMealLog({
    id: 'food_2',
    user_id: userId,
    date,
    meal_type: 'breakfast',
    food_name: 'Boiled Eggs',
    serving_quantity: 2,
    serving_unit: 'piece',
    serving_grams: 100,
    energy_kcal: 155.6,
    protein_g: 12.6,
    carb_g: 1.2,
    fat_g: 10.6,
    fibre_g: 0,
    notes: 'Hard-boiled'
  })

  const logs = getMealLogs(userId, date)
  assert.equal(logs.length, 2)

  // Verify manual values are preserved exactly
  assert.equal(logs[0].energy_kcal, 389)
  assert.equal(logs[0].notes, 'Breakfast oats')
  assert.equal(logs[1].energy_kcal, 155.6)

  // Update an entry's quantity & calories manually
  updateMealLog('food_1', userId, {
    serving_quantity: 150,
    serving_grams: 150,
    energy_kcal: 583.5,
    protein_g: 25.3
  })

  const updated = getMealLogs(userId, date).find(m => m.id === 'food_1')
  assert.equal(updated.serving_quantity, 150)
  assert.equal(updated.energy_kcal, 583.5)

  // Delete an entry
  const deleted = deleteMealLog('food_2', userId)
  assert.equal(deleted, true)
  assert.equal(getMealLogs(userId, date).length, 1)

  // Clean up
  deleteMealLog('food_1', userId)
})

test('Daily Health Log: Water intake tracker with daily goal', () => {
  const userId = 'test_user_water_1'
  const date = '2026-10-25'

  // Add multiple water entries for the day
  addWaterLog({
    id: 'water_1',
    user_id: userId,
    date,
    amount_ml: 500,
    unit: 'ml',
    notes: 'Morning glass'
  })

  addWaterLog({
    id: 'water_2',
    user_id: userId,
    date,
    amount_ml: 750,
    unit: 'ml',
    notes: 'Workout bottle'
  })

  addWaterLog({
    id: 'water_3',
    user_id: userId,
    date,
    amount_ml: 1000,
    unit: 'ml',
    notes: 'Afternoon hydration'
  })

  const waterList = getWaterLogs(userId, date)
  assert.equal(waterList.length, 3, 'Should record multiple water entries without duplicates')

  const totalWaterMl = waterList.reduce((acc, w) => acc + w.amount_ml, 0)
  assert.equal(totalWaterMl, 2250, 'Total water consumed should be 2250 ml')

  // Goal of 2.5 L = 2500 ml -> 250 ml remaining
  const waterGoalMl = 2500
  const remainingMl = Math.max(0, waterGoalMl - totalWaterMl)
  assert.equal(remainingMl, 250, 'Remaining amount to reach goal is 250 ml')

  // Delete an entry
  deleteWaterLog('water_1', userId)
  assert.equal(getWaterLogs(userId, date).length, 2)

  // Clean up
  deleteWaterLog('water_2', userId)
  deleteWaterLog('water_3', userId)
})

test('Daily Health Log: Cardio activity log with duration, distance, steps, and optional calories', () => {
  const userId = 'test_user_cardio_1'
  const date = '2026-10-25'

  // Morning walk
  addCardioLog({
    id: 'cardio_1',
    user_id: userId,
    date,
    activity_type: 'walking',
    duration_min: 30,
    distance_km: 2.5,
    steps: 3500,
    calories_burned: 140,
    notes: 'Brisk park walk'
  })

  // Evening treadmill
  addCardioLog({
    id: 'cardio_2',
    user_id: userId,
    date,
    activity_type: 'treadmill',
    duration_min: 20,
    distance_km: 3.0,
    steps: 3200,
    calories_burned: 210,
    notes: 'Interval incline'
  })

  const cardioList = getCardioLogs(userId, date)
  assert.equal(cardioList.length, 2)

  const totalCardioMin = cardioList.reduce((acc, c) => acc + c.duration_min, 0)
  assert.equal(totalCardioMin, 50)

  const totalSteps = cardioList.reduce((acc, c) => acc + (c.steps || 0), 0)
  assert.equal(totalSteps, 6700)

  // Update session
  updateCardioLog('cardio_1', userId, {
    activity_type: 'walking',
    duration_min: 40,
    distance_km: 3.2,
    steps: 4500,
    calories_burned: 180,
    notes: 'Extended walk'
  })

  const updated = getCardioLogs(userId, date).find(c => c.id === 'cardio_1')
  assert.equal(updated.duration_min, 40)
  assert.equal(updated.steps, 4500)

  // Clean up
  deleteCardioLog('cardio_1', userId)
  deleteCardioLog('cardio_2', userId)
})

test('Daily Health Log: Strength workout log with exercises, sets, reps, and weights', () => {
  const userId = 'test_user_strength_1'
  const date = '2026-10-25'

  // Barbell Bench Press
  addStrengthLog({
    id: 'strength_1',
    user_id: userId,
    date,
    exercise_name: 'Barbell Bench Press',
    muscle_group: 'Chest',
    sets: 4,
    reps: 8,
    weight_kg: 80,
    duration_min: 20,
    calories_burned: 90,
    notes: 'RPE 8'
  })

  // Incline Dumbbell Press
  addStrengthLog({
    id: 'strength_2',
    user_id: userId,
    date,
    exercise_name: 'Incline Dumbbell Press',
    muscle_group: 'Upper Chest',
    sets: 3,
    reps: 10,
    weight_kg: 26,
    duration_min: 15,
    calories_burned: 65,
    notes: 'Controlled eccentric'
  })

  const strengthList = getStrengthLogs(userId, date)
  assert.equal(strengthList.length, 2)

  const totalWorkoutMin = strengthList.reduce((acc, s) => acc + (s.duration_min || 0), 0)
  assert.equal(totalWorkoutMin, 35)

  // Update
  updateStrengthLog('strength_1', userId, {
    exercise_name: 'Barbell Bench Press',
    muscle_group: 'Chest',
    sets: 4,
    reps: 10,
    weight_kg: 82.5,
    duration_min: 22,
    calories_burned: 100,
    notes: 'PR set'
  })

  const updated = getStrengthLogs(userId, date).find(s => s.id === 'strength_1')
  assert.equal(updated.reps, 10)
  assert.equal(updated.weight_kg, 82.5)

  // Clean up
  deleteStrengthLog('strength_1', userId)
  deleteStrengthLog('strength_2', userId)
})

test('Daily Health Log: 1,900 kcal target calculations (below, exact, and above target)', async () => {
  const userId = 'test_user_target_1900'
  const date = '2026-10-25'

  // Configure daily health settings with 1,900 kcal target
  setDailyHealthSettings(userId, { calorie_target: 1900, water_goal_litres: 2.5 })

  // Mock routes helper
  let responseData = null
  let responseStatus = null
  const mockJson = (res, status, data) => {
    responseStatus = status
    responseData = data
  }
  const mockSession = () => ({ id: userId, name: 'Tester' })
  const routes = nutritionRoutes({ json: mockJson, readBody: async () => ({}), readSession: mockSession })

  // 1. Below target (1,500 kcal consumed -> 400 kcal remaining)
  addMealLog({
    id: 'f_target_1',
    user_id: userId,
    date,
    meal_type: 'lunch',
    food_name: 'Chicken Rice Bowl',
    serving_quantity: 1,
    serving_unit: 'serving',
    serving_grams: 400,
    energy_kcal: 1500,
    protein_g: 80,
    carb_g: 150,
    fat_g: 40,
    fibre_g: 12
  })

  await routes['GET /api/nutrition/health-log']({ url: `http://localhost/api/nutrition/health-log?date=${date}` }, {})
  assert.equal(responseData.totals.calorie_target, 1900)
  assert.equal(responseData.totals.calories_consumed, 1500)
  assert.equal(responseData.totals.is_below_target, true)
  assert.equal(responseData.totals.calories_remaining, 400)
  assert.equal(responseData.totals.is_above_target, false)

  // 2. Exactly at target (add 400 kcal snack -> 1,900 kcal exactly)
  addMealLog({
    id: 'f_target_2',
    user_id: userId,
    date,
    meal_type: 'snacks',
    food_name: 'Greek Yogurt & Walnuts',
    serving_quantity: 1,
    serving_unit: 'serving',
    serving_grams: 200,
    energy_kcal: 400,
    protein_g: 20,
    carb_g: 15,
    fat_g: 18,
    fibre_g: 2
  })

  await routes['GET /api/nutrition/health-log']({ url: `http://localhost/api/nutrition/health-log?date=${date}` }, {})
  assert.equal(responseData.totals.calories_consumed, 1900)
  assert.equal(responseData.totals.is_exact_target, true)
  assert.equal(responseData.totals.calories_remaining, 0)
  assert.equal(responseData.totals.calories_above, 0)

  // 3. Above target (add 300 kcal dinner -> 2,200 kcal -> 300 kcal above target)
  addMealLog({
    id: 'f_target_3',
    user_id: userId,
    date,
    meal_type: 'dinner',
    food_name: 'Paneer Salad',
    serving_quantity: 1,
    serving_unit: 'serving',
    serving_grams: 250,
    energy_kcal: 300,
    protein_g: 15,
    carb_g: 10,
    fat_g: 20,
    fibre_g: 5
  })

  await routes['GET /api/nutrition/health-log']({ url: `http://localhost/api/nutrition/health-log?date=${date}` }, {})
  assert.equal(responseData.totals.calories_consumed, 2200)
  assert.equal(responseData.totals.is_above_target, true)
  assert.equal(responseData.totals.calories_above, 300)
  assert.equal(responseData.totals.calories_remaining, 0)

  // Clean up
  deleteMealLog('f_target_1', userId)
  deleteMealLog('f_target_2', userId)
  deleteMealLog('f_target_3', userId)
})

test('Daily Health Log: Empty log handling returns zeroed totals without fake data', async () => {
  const userId = 'test_empty_user'
  const date = '2099-01-01'

  let responseData = null
  const mockJson = (res, status, data) => { responseData = data }
  const mockSession = () => ({ id: userId, name: 'EmptyTester' })
  const routes = nutritionRoutes({ json: mockJson, readBody: async () => ({}), readSession: mockSession })

  await routes['GET /api/nutrition/health-log']({ url: `http://localhost/api/nutrition/health-log?date=${date}` }, {})

  assert.equal(responseData.foods.length, 0)
  assert.equal(responseData.water.length, 0)
  assert.equal(responseData.cardio.length, 0)
  assert.equal(responseData.strength.length, 0)
  assert.equal(responseData.totals.calories_consumed, 0)
  assert.equal(responseData.totals.calories_remaining, 1900)
  assert.equal(responseData.totals.protein_g, 0)
  assert.equal(responseData.totals.total_steps, 0)
  assert.equal(responseData.totals.water_ml, 0)
})

