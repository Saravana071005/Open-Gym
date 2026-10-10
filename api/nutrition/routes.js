/**
 * Nutrition Engine HTTP API Routes
 * Integrates food search, natural-language parsing, deterministic calculation,
 * recipe analysis, user targets, and daily meal logging.
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
  deleteMealLog
} from './db.js';
import { parseMeal } from './parser.js';
import { calculateRecipeNutrition, resolveGrams, calculateNutrients } from './engine.js';

export function nutritionRoutes({ json, readBody, readSession }) {
  const requireUser = (req, res) => {
    const user = readSession(req);
    if (!user) {
      json(res, 401, { error: 'not signed in' });
      return null;
    }
    return user;
  };

  return {
    /* ---------- Food Search & Details ---------- */
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

      // If recipe, include ingredients
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

    /* ---------- Natural Language Meal Parser ---------- */
    'POST /api/nutrition/parse': async (req, res) => {
      const body = await readBody(req);
      const text = String(body.text || '').trim();
      if (!text) return json(res, 400, { error: 'text is required' });

      try {
        const result = parseMeal(text);
        json(res, 200, { ok: true, ...result });
      } catch (e) {
        json(res, 500, { error: e.message });
      }
    },

    /* ---------- Deterministic Nutrition Calculation ---------- */
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
    },

    /* ---------- User Targets ---------- */
    'GET /api/nutrition/targets': async (req, res) => {
      const user = readSession(req);
      // For guests or unauthenticated users, return defaults
      if (!user) {
        return json(res, 200, {
          ok: true,
          targets: {
            calorie_target: 2000,
            protein_target_g: 140,
            carb_target_g: 220,
            fat_target_g: 65,
            fibre_target_g: 30,
            diet_preference: 'all'
          }
        });
      }

      const targets = getUserTargets(user.id);
      json(res, 200, { ok: true, targets });
    },

    'POST /api/nutrition/targets': async (req, res) => {
      const user = requireUser(req, res);
      if (!user) return;

      const body = await readBody(req);
      const targets = setUserTargets(user.id, body);
      json(res, 200, { ok: true, targets });
    },

    /* ---------- Daily Meal Logs ---------- */
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

      const id = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(12).toString('hex');
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
        assumptions: body.assumptions || [],
        created_at: new Date().toISOString()
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
    }
  };
}
