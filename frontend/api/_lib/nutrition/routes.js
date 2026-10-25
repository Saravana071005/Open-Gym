/**
 * Daily Health Log & Nutrition HTTP API Routes
 * Manual food intake, water consumption, cardio activity, strength training,
 * and daily summaries with a 1,900 kcal calorie target.
 * Completely free of external AI dependencies.
 */

import crypto from 'node:crypto';
import {
  searchFoods,
  getFoodById,
  getRecipeIngredients,
  getPortionUnits,
  getUserTargets,
  setUserTargets,
  getMealLogs,
  addMealLog,
  updateMealLog,
  deleteMealLog,
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
} from './db.js';
import { calculateRecipeNutrition } from './engine.js';

export function nutritionRoutes({ json, readBody, readSession }) {
  const requireUser = (req, res) => {
    const user = readSession(req);
    if (!user) {
      json(res, 401, { error: 'not signed in' });
      return null;
    }
    return user;
  };

  const genId = () => crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(12).toString('hex');

  return {
    /* ---------- Food Search & Details (For manual entry assistance) ---------- */
    'GET /api/nutrition/search': async (req, res) => {
      const url = new URL(req.url, 'http://x');
      const q = url.searchParams.get('q') || '';
      const group = url.searchParams.get('group') || null;
      const limit = Math.min(50, Math.max(1, +(url.searchParams.get('limit') || 20)));

      try {
        const results = searchFoods(q, limit, group);
        json(res, 200, { ok: true, count: results.length, foods: results });
      } catch (e) {
        json(res, 500, { error: e.message });
      }
    },

    'GET /api/nutrition/food': async (req, res) => {
      const url = new URL(req.url, 'http://x');
      const id = url.searchParams.get('id');
      if (!id) return json(res, 400, { error: 'food id required' });

      const food = getFoodById(id);
      if (!food) return json(res, 404, { error: 'food not found' });

      let ingredients = [];
      if (food.is_recipe && food.source_id) {
        ingredients = getRecipeIngredients(food.source_id);
      }

      const portionUnits = getPortionUnits(food.name);

      json(res, 200, {
        ok: true,
        food,
        ingredients,
        portion_units: portionUnits
      });
    },

    /* ---------- Complete Daily Health Log ---------- */
    'GET /api/nutrition/health-log': async (req, res) => {
      const user = requireUser(req, res);
      if (!user) return;

      const url = new URL(req.url, 'http://x');
      const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);

      const foods = getMealLogs(user.id, date);
      const water = getWaterLogs(user.id, date);
      const cardio = getCardioLogs(user.id, date);
      const strength = getStrengthLogs(user.id, date);
      const settings = getDailyHealthSettings(user.id);

      // Calculate food totals & meal subtotals
      const foodTotals = {
        calories: 0,
        protein: 0,
        carbohydrates: 0,
        fat: 0,
        fibre: 0
      };

      const subtotals = {
        breakfast: { calories: 0, protein: 0, carbs: 0, fat: 0 },
        lunch: { calories: 0, protein: 0, carbs: 0, fat: 0 },
        dinner: { calories: 0, protein: 0, carbs: 0, fat: 0 },
        snacks: { calories: 0, protein: 0, carbs: 0, fat: 0 }
      };

      for (const f of foods) {
        const cal = Number(f.energy_kcal) || 0;
        const p = Number(f.protein_g) || 0;
        const c = Number(f.carb_g) || 0;
        const fat = Number(f.fat_g) || 0;
        const fib = Number(f.fibre_g) || 0;

        foodTotals.calories += cal;
        foodTotals.protein += p;
        foodTotals.carbohydrates += c;
        foodTotals.fat += fat;
        foodTotals.fibre += fib;

        const mType = String(f.meal_type || 'snacks').toLowerCase();
        if (subtotals[mType]) {
          subtotals[mType].calories += cal;
          subtotals[mType].protein += p;
          subtotals[mType].carbs += c;
          subtotals[mType].fat += fat;
        }
      }

      // Water total
      const waterTotalMl = water.reduce((acc, w) => acc + (Number(w.amount_ml) || 0), 0);

      // Cardio totals
      let cardioDurationMin = 0;
      let cardioSteps = 0;
      let cardioDistanceKm = 0;
      let cardioCaloriesBurned = 0;

      for (const c of cardio) {
        cardioDurationMin += Number(c.duration_min) || 0;
        cardioSteps += Number(c.steps) || 0;
        cardioDistanceKm += Number(c.distance_km) || 0;
        cardioCaloriesBurned += Number(c.calories_burned) || 0;
      }

      // Strength totals
      let strengthDurationMin = 0;
      let strengthCaloriesBurned = 0;

      for (const s of strength) {
        strengthDurationMin += Number(s.duration_min) || 0;
        strengthCaloriesBurned += Number(s.calories_burned) || 0;
      }

      const totalWorkoutDurationMin = cardioDurationMin + strengthDurationMin;
      const totalExerciseCaloriesBurned = cardioCaloriesBurned + strengthCaloriesBurned;

      const calorieTarget = settings.calorie_target != null ? settings.calorie_target : 1900;
      const caloriesConsumed = Math.round(foodTotals.calories * 10) / 10;
      const calorieDifference = Math.round((caloriesConsumed - calorieTarget) * 10) / 10;

      json(res, 200, {
        ok: true,
        date,
        settings: {
          calorie_target: calorieTarget,
          water_goal_litres: settings.water_goal_litres || 2.5
        },
        foods,
        water,
        cardio,
        strength,
        totals: {
          food_count: foods.length,
          calories_consumed: caloriesConsumed,
          calorie_target: calorieTarget,
          calorie_difference: calorieDifference,
          is_below_target: calorieDifference < 0,
          is_exact_target: calorieDifference === 0,
          is_above_target: calorieDifference > 0,
          calories_remaining: calorieDifference < 0 ? Math.abs(calorieDifference) : 0,
          calories_above: calorieDifference > 0 ? calorieDifference : 0,
          protein_g: Math.round(foodTotals.protein * 10) / 10,
          carb_g: Math.round(foodTotals.carbohydrates * 10) / 10,
          fat_g: Math.round(foodTotals.fat * 10) / 10,
          fibre_g: Math.round(foodTotals.fibre * 10) / 10,
          subtotals,
          water_ml: waterTotalMl,
          water_litres: Math.round((waterTotalMl / 1000) * 100) / 100,
          water_goal_litres: settings.water_goal_litres || 2.5,
          cardio_duration_min: cardioDurationMin,
          cardio_distance_km: Math.round(cardioDistanceKm * 10) / 10,
          strength_duration_min: strengthDurationMin,
          total_workout_duration_min: totalWorkoutDurationMin,
          total_steps: cardioSteps,
          exercise_calories_burned: totalExerciseCaloriesBurned
        }
      });
    },

    /* ---------- Food Intake CRUD ---------- */
    'POST /api/nutrition/food/save': async (req, res) => {
      const user = requireUser(req, res);
      if (!user) return;

      const body = await readBody(req);
      if (!body.food_name || !body.meal_type || !body.date) {
        return json(res, 400, { error: 'food_name, meal_type, and date are required' });
      }

      const id = body.id || genId();
      const entry = {
        id,
        user_id: user.id,
        date: String(body.date).slice(0, 10),
        meal_type: String(body.meal_type).toLowerCase(),
        food_id: body.food_id || null,
        food_name: String(body.food_name).trim(),
        serving_quantity: Number(body.serving_quantity) || 1,
        serving_grams: body.serving_grams != null ? Number(body.serving_grams) : 0,
        energy_kcal: body.energy_kcal != null && body.energy_kcal !== '' ? Number(body.energy_kcal) : 0,
        protein_g: body.protein_g != null && body.protein_g !== '' ? Number(body.protein_g) : 0,
        carb_g: body.carb_g != null && body.carb_g !== '' ? Number(body.carb_g) : 0,
        fat_g: body.fat_g != null && body.fat_g !== '' ? Number(body.fat_g) : 0,
        fibre_g: body.fibre_g != null && body.fibre_g !== '' ? Number(body.fibre_g) : 0,
        notes: body.notes ? String(body.notes).trim() : null,
        assumptions: body.notes || body.assumptions || null,
        created_at: body.created_at || new Date().toISOString()
      };

      if (body.id) {
        const updated = updateMealLog(id, user.id, entry);
        return json(res, 200, { ok: true, entry: updated || entry });
      } else {
        addMealLog(entry);
        return json(res, 201, { ok: true, entry });
      }
    },

    'POST /api/nutrition/food/delete': async (req, res) => {
      const user = requireUser(req, res);
      if (!user) return;

      const body = await readBody(req);
      const id = body.id;
      if (!id) return json(res, 400, { error: 'food entry id is required' });

      const ok = deleteMealLog(id, user.id);
      json(res, 200, { ok });
    },

    /* ---------- Water Intake CRUD ---------- */
    'POST /api/nutrition/water/save': async (req, res) => {
      const user = requireUser(req, res);
      if (!user) return;

      const body = await readBody(req);
      if (!body.date || body.amount_ml == null) {
        return json(res, 400, { error: 'date and amount_ml are required' });
      }

      const id = body.id || genId();
      let amountMl = Number(body.amount_ml) || 0;
      if (body.unit === 'L' || body.unit === 'l') {
        amountMl = amountMl * 1000;
      }

      const entry = {
        id,
        user_id: user.id,
        date: String(body.date).slice(0, 10),
        amount_ml: Math.max(0, amountMl),
        unit: body.unit || 'ml',
        notes: body.notes ? String(body.notes).trim() : null,
        created_at: body.created_at || new Date().toISOString()
      };

      addWaterLog(entry);
      json(res, 201, { ok: true, entry });
    },

    'POST /api/nutrition/water/delete': async (req, res) => {
      const user = requireUser(req, res);
      if (!user) return;

      const body = await readBody(req);
      const id = body.id;
      if (!id) return json(res, 400, { error: 'water entry id is required' });

      const ok = deleteWaterLog(id, user.id);
      json(res, 200, { ok });
    },

    /* ---------- Cardio Activity CRUD ---------- */
    'POST /api/nutrition/cardio/save': async (req, res) => {
      const user = requireUser(req, res);
      if (!user) return;

      const body = await readBody(req);
      if (!body.date || !body.activity_type || body.duration_min == null) {
        return json(res, 400, { error: 'date, activity_type, and duration_min are required' });
      }

      const id = body.id || genId();
      const entry = {
        id,
        user_id: user.id,
        date: String(body.date).slice(0, 10),
        activity_type: String(body.activity_type).trim(),
        duration_min: Math.max(0, Number(body.duration_min) || 0),
        distance_km: body.distance_km != null && body.distance_km !== '' ? Number(body.distance_km) : null,
        steps: body.steps != null && body.steps !== '' ? Number(body.steps) : null,
        calories_burned: body.calories_burned != null && body.calories_burned !== '' ? Number(body.calories_burned) : null,
        notes: body.notes ? String(body.notes).trim() : null,
        created_at: body.created_at || new Date().toISOString()
      };

      if (body.id) {
        const updated = updateCardioLog(id, user.id, entry);
        return json(res, 200, { ok: true, entry: updated || entry });
      } else {
        addCardioLog(entry);
        return json(res, 201, { ok: true, entry });
      }
    },

    'POST /api/nutrition/cardio/delete': async (req, res) => {
      const user = requireUser(req, res);
      if (!user) return;

      const body = await readBody(req);
      const id = body.id;
      if (!id) return json(res, 400, { error: 'cardio entry id is required' });

      const ok = deleteCardioLog(id, user.id);
      json(res, 200, { ok });
    },

    /* ---------- Strength Workout CRUD ---------- */
    'POST /api/nutrition/strength/save': async (req, res) => {
      const user = requireUser(req, res);
      if (!user) return;

      const body = await readBody(req);
      if (!body.date || !body.exercise_name) {
        return json(res, 400, { error: 'date and exercise_name are required' });
      }

      const id = body.id || genId();
      const entry = {
        id,
        user_id: user.id,
        date: String(body.date).slice(0, 10),
        exercise_name: String(body.exercise_name).trim(),
        muscle_group: body.muscle_group ? String(body.muscle_group).trim() : null,
        sets: body.sets != null && body.sets !== '' ? Number(body.sets) : null,
        reps: body.reps != null && body.reps !== '' ? Number(body.reps) : null,
        weight_kg: body.weight_kg != null && body.weight_kg !== '' ? Number(body.weight_kg) : null,
        duration_min: body.duration_min != null && body.duration_min !== '' ? Number(body.duration_min) : null,
        calories_burned: body.calories_burned != null && body.calories_burned !== '' ? Number(body.calories_burned) : null,
        notes: body.notes ? String(body.notes).trim() : null,
        created_at: body.created_at || new Date().toISOString()
      };

      if (body.id) {
        const updated = updateStrengthLog(id, user.id, entry);
        return json(res, 200, { ok: true, entry: updated || entry });
      } else {
        addStrengthLog(entry);
        return json(res, 201, { ok: true, entry });
      }
    },

    'POST /api/nutrition/strength/delete': async (req, res) => {
      const user = requireUser(req, res);
      if (!user) return;

      const body = await readBody(req);
      const id = body.id;
      if (!id) return json(res, 400, { error: 'strength entry id is required' });

      const ok = deleteStrengthLog(id, user.id);
      json(res, 200, { ok });
    },

    /* ---------- Daily Health Settings ---------- */
    'GET /api/nutrition/health-settings': async (req, res) => {
      const user = readSession(req);
      if (!user) {
        return json(res, 200, {
          ok: true,
          settings: {
            calorie_target: 1900,
            water_goal_litres: 2.5
          }
        });
      }

      const settings = getDailyHealthSettings(user.id);
      json(res, 200, { ok: true, settings });
    },

    'POST /api/nutrition/health-settings': async (req, res) => {
      const user = requireUser(req, res);
      if (!user) return;

      const body = await readBody(req);
      const settings = setDailyHealthSettings(user.id, body);
      json(res, 200, { ok: true, settings });
    },

    /* ---------- Backwards Compatibility Endpoints ---------- */
    'GET /api/nutrition/targets': async (req, res) => {
      const user = readSession(req);
      if (!user) {
        return json(res, 200, {
          ok: true,
          targets: {
            calorie_target: 1900,
            protein_target_g: 140,
            carb_target_g: 220,
            fat_target_g: 65,
            fibre_target_g: 30,
            diet_preference: 'all'
          }
        });
      }

      const targets = getUserTargets(user.id);
      json(res, 200, { ok: true, targets: targets || { calorie_target: 1900 } });
    },

    'POST /api/nutrition/targets': async (req, res) => {
      const user = requireUser(req, res);
      if (!user) return;

      const body = await readBody(req);
      const targets = setUserTargets(user.id, body);
      json(res, 200, { ok: true, targets });
    },

    'GET /api/nutrition/log': async (req, res) => {
      const user = requireUser(req, res);
      if (!user) return;

      const url = new URL(req.url, 'http://x');
      const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);

      const logs = getMealLogs(user.id, date);
      const totals = {
        energy_kcal: 0,
        protein_g: 0,
        carb_g: 0,
        fat_g: 0,
        fibre_g: 0
      };

      for (const log of logs) {
        totals.energy_kcal += log.energy_kcal || 0;
        totals.protein_g += log.protein_g || 0;
        totals.carb_g += log.carb_g || 0;
        totals.fat_g += log.fat_g || 0;
        totals.fibre_g += log.fibre_g || 0;
      }

      totals.energy_kcal = Math.round(totals.energy_kcal * 10) / 10;
      totals.protein_g = Math.round(totals.protein_g * 10) / 10;
      totals.carb_g = Math.round(totals.carb_g * 10) / 10;
      totals.fat_g = Math.round(totals.fat_g * 10) / 10;
      totals.fibre_g = Math.round(totals.fibre_g * 10) / 10;

      json(res, 200, { ok: true, date, totals, logs });
    },

    'POST /api/nutrition/log': async (req, res) => {
      const user = requireUser(req, res);
      if (!user) return;

      const body = await readBody(req);
      if (!body.food_name || !body.meal_type || !body.date) {
        return json(res, 400, { error: 'food_name, meal_type, and date are required' });
      }

      const id = body.id || genId();
      const entry = {
        id,
        user_id: user.id,
        date: String(body.date).slice(0, 10),
        meal_type: String(body.meal_type).toLowerCase(),
        food_id: body.food_id || null,
        food_name: String(body.food_name).trim(),
        serving_quantity: Number(body.serving_quantity) || 1,
        serving_unit: String(body.serving_unit || 'g').trim(),
        serving_grams: Number(body.serving_grams) || 100,
        energy_kcal: Number(body.energy_kcal) || 0,
        protein_g: Number(body.protein_g) || 0,
        carb_g: Number(body.carb_g) || 0,
        fat_g: Number(body.fat_g) || 0,
        fibre_g: Number(body.fibre_g) || 0,
        notes: body.notes || null,
        assumptions: body.notes || body.assumptions || null,
        created_at: body.created_at || new Date().toISOString()
      };

      addMealLog(entry);
      json(res, 201, { ok: true, entry });
    },

    'POST /api/nutrition/log/update': async (req, res) => {
      const user = requireUser(req, res);
      if (!user) return;

      const body = await readBody(req);
      const id = body.id;
      if (!id) return json(res, 400, { error: 'log id required' });

      const updated = updateMealLog(id, user.id, body);
      json(res, 200, { ok: true, entry: updated });
    },

    'POST /api/nutrition/log/delete': async (req, res) => {
      const user = requireUser(req, res);
      if (!user) return;

      const body = await readBody(req);
      const id = body.id;
      if (!id) return json(res, 400, { error: 'log id required' });

      const ok = deleteMealLog(id, user.id);
      json(res, 200, { ok });
    },

    'POST /api/nutrition/calculate': async (req, res) => {
      const body = await readBody(req);
      const ingredients = Array.isArray(body.ingredients) ? body.ingredients : [];
      const servings = Math.max(1, +(body.servings || 1));

      if (!ingredients.length) {
        return json(res, 400, { error: 'ingredients list is required' });
      }

      try {
        const result = calculateRecipeNutrition(ingredients, servings);
        json(res, 200, { ok: true, ...result });
      } catch (e) {
        json(res, 500, { error: e.message });
      }
    }
  };
}
