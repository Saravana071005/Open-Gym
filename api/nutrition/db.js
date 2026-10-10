import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

let db = null;

export function getDb() {
  if (db) return db;
  // Locate nutrition.db
  const candidates = [
    path.join(process.env.DATA_DIR || './data', 'nutrition.db'),
    path.join(process.cwd(), 'data', 'nutrition.db'),
    path.join(process.cwd(), '..', 'data', 'nutrition.db')
  ];
  let dbPath = candidates.find(p => fs.existsSync(p)) || candidates[0];
  db = new DatabaseSync(dbPath);
  return db;
}

export function searchFoods(query, limit = 20, group = null) {
  const d = getDb();
  const qClean = String(query || '').trim().toLowerCase();
  if (!qClean) {
    if (group) {
      return d.prepare(`
        SELECT id, name, canonical_name, alternate_names, tamil_name, hindi_name,
               food_group, prep_state, source, energy_kcal, protein_g, carb_g, fat_g, fibre_g,
               is_recipe, serving_size_g, serving_unit, confidence
        FROM foods
        WHERE food_group = ?
        LIMIT ?
      `).all(group, limit);
    }
    return d.prepare(`
      SELECT id, name, canonical_name, alternate_names, tamil_name, hindi_name,
             food_group, prep_state, source, energy_kcal, protein_g, carb_g, fat_g, fibre_g,
             is_recipe, serving_size_g, serving_unit, confidence
      FROM foods
      LIMIT ?
    `).all(limit);
  }

  // Token-based matching: split query into tokens
  const tokens = qClean.split(/\s+/).filter(Boolean);
  const conditions = tokens.map(() => "(canonical_name LIKE ? OR alternate_names LIKE ? OR tamil_name LIKE ? OR hindi_name LIKE ?)");
  const params = [];
  tokens.forEach(tok => {
    const like = `%${tok}%`;
    params.push(like, like, like, like);
  });

  let sql = `
    SELECT id, name, canonical_name, alternate_names, tamil_name, hindi_name,
           food_group, prep_state, source, energy_kcal, protein_g, carb_g, fat_g, fibre_g,
           is_recipe, serving_size_g, serving_unit, confidence
    FROM foods
    WHERE ${conditions.join(" AND ")}
  `;

  if (group) {
    sql += " AND food_group = ?";
    params.push(group);
  }

  // Prioritize exact/prefix matches and recipes/verified foods
  sql += `
    ORDER BY 
      (canonical_name = ? OR alternate_names LIKE '%"' || ? || '"%') DESC,
      (canonical_name LIKE ? || ' %') DESC,
      (source = 'NIN_STAPLE') DESC,
      (source = 'INDB_ICMR') DESC,
      (source = 'INDB_RECIPE') DESC,
      (source = 'USDA') DESC,
      (source != 'OFF') DESC,
      LENGTH(canonical_name) ASC
    LIMIT ?
  `;
  params.push(qClean, qClean, qClean, limit);

  return d.prepare(sql).all(...params);
}

export function getFoodById(id) {
  const d = getDb();
  return d.prepare(`
    SELECT id, name, canonical_name, alternate_names, tamil_name, hindi_name,
           food_group, prep_state, source, source_id, serving_basis_g,
           energy_kcal, protein_g, carb_g, fat_g, fibre_g, sugar_g,
           sodium_mg, calcium_mg, iron_mg, is_recipe, serving_size_g, serving_unit,
           confidence, metadata
    FROM foods
    WHERE id = ?
  `).get(id);
}

export function getRecipeIngredients(recipeCode) {
  const d = getDb();
  return d.prepare(`
    SELECT recipe_code, ingredient_food_id, ingredient_name, amount, unit, gram_weight
    FROM recipe_ingredients
    WHERE recipe_code = ?
  `).all(recipeCode);
}

export function getPortionUnits(foodPattern = null) {
  const d = getDb();
  if (foodPattern) {
    const pat = `%${foodPattern.toLowerCase()}%`;
    const specific = d.prepare(`
      SELECT food_pattern, unit_name, gram_weight, source
      FROM portion_units
      WHERE food_pattern IS NOT NULL AND ? LIKE '%' || food_pattern || '%'
    `).all(foodPattern.toLowerCase());
    if (specific && specific.length) return specific;
  }
  return d.prepare(`
    SELECT food_pattern, unit_name, gram_weight, source
    FROM portion_units
    WHERE food_pattern IS NULL
  `).all();
}

export function getUserTargets(userId) {
  const d = getDb();
  const row = d.prepare(`
    SELECT user_id, calorie_target, protein_target_g, carb_target_g, fat_target_g, fibre_target_g, diet_preference, updated_at
    FROM user_nutrition_targets
    WHERE user_id = ?
  `).get(userId);
  return row || null;
}

export function setUserTargets(userId, targets) {
  const d = getDb();
  const now = new Date().toISOString();
  d.prepare(`
    INSERT OR REPLACE INTO user_nutrition_targets (
      user_id, calorie_target, protein_target_g, carb_target_g, fat_target_g, fibre_target_g, diet_preference, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    targets.calorie_target != null ? targets.calorie_target : (targets.calories != null ? targets.calories : null),
    targets.protein_target_g != null ? targets.protein_target_g : (targets.protein != null ? targets.protein : null),
    targets.carb_target_g != null ? targets.carb_target_g : (targets.carbs != null ? targets.carbs : null),
    targets.fat_target_g != null ? targets.fat_target_g : (targets.fat != null ? targets.fat : null),
    targets.fibre_target_g != null ? targets.fibre_target_g : (targets.fibre != null ? targets.fibre : null),
    targets.diet_preference || 'all',
    now
  );
  return getUserTargets(userId);
}

export function getMealLogs(userId, date) {
  const d = getDb();
  return d.prepare(`
    SELECT id, user_id, date, meal_type, food_id, food_name, serving_quantity,
           serving_unit, serving_grams, energy_kcal, protein_g, carb_g, fat_g, fibre_g,
           assumptions, created_at
    FROM meal_logs
    WHERE user_id = ? AND date = ?
    ORDER BY created_at ASC
  `).all(userId, date);
}

export function addMealLog(entry) {
  const d = getDb();
  d.prepare(`
    INSERT OR REPLACE INTO meal_logs (
      id, user_id, date, meal_type, food_id, food_name, serving_quantity,
      serving_unit, serving_grams, energy_kcal, protein_g, carb_g, fat_g, fibre_g,
      assumptions, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.id,
    entry.user_id,
    entry.date,
    entry.meal_type,
    entry.food_id || null,
    entry.food_name,
    entry.serving_quantity,
    entry.serving_unit,
    entry.serving_grams,
    entry.energy_kcal,
    entry.protein_g,
    entry.carb_g,
    entry.fat_g,
    entry.fibre_g,
    typeof entry.assumptions === 'string' ? entry.assumptions : JSON.stringify(entry.assumptions || []),
    entry.created_at || new Date().toISOString()
  );
  return entry;
}

export function updateMealLog(id, userId, updates) {
  const d = getDb();
  const existing = d.prepare("SELECT * FROM meal_logs WHERE id = ? AND user_id = ?").get(id, userId);
  if (!existing) return null;
  const merged = { ...existing, ...updates };
  d.prepare(`
    UPDATE meal_logs
    SET meal_type = ?, food_name = ?, serving_quantity = ?, serving_unit = ?,
        serving_grams = ?, energy_kcal = ?, protein_g = ?, carb_g = ?, fat_g = ?, fibre_g = ?,
        assumptions = ?
    WHERE id = ? AND user_id = ?
  `).run(
    merged.meal_type,
    merged.food_name,
    merged.serving_quantity,
    merged.serving_unit,
    merged.serving_grams,
    merged.energy_kcal,
    merged.protein_g,
    merged.carb_g,
    merged.fat_g,
    merged.fibre_g,
    typeof merged.assumptions === 'string' ? merged.assumptions : JSON.stringify(merged.assumptions || []),
    id,
    userId
  );
  return d.prepare("SELECT * FROM meal_logs WHERE id = ?").get(id);
}

export function deleteMealLog(id, userId) {
  const d = getDb();
  const res = d.prepare("DELETE FROM meal_logs WHERE id = ? AND user_id = ?").run(id, userId);
  return res.changes > 0;
}
