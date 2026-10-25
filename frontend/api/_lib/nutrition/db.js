import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';

let db = null;

export function getDb() {
  if (db) return db;
  const isVercel = !!(process.env.VERCEL || process.env.NOW_REGION);
  const dataDir = process.env.DATA_DIR || (isVercel ? path.join(os.tmpdir(), 'opengym-data') : './data');
  try { fs.mkdirSync(dataDir, { recursive: true }); } catch {}

  // Locate nutrition.db
  const candidates = [
    path.join(dataDir, 'nutrition.db'),
    path.join(process.cwd(), 'data', 'nutrition.db'),
    path.join(process.cwd(), '..', 'data', 'nutrition.db')
  ];
  let dbPath = candidates.find(p => fs.existsSync(p)) || candidates[0];
  try { fs.mkdirSync(path.dirname(dbPath), { recursive: true }); } catch {}
  db = new DatabaseSync(dbPath);

  // Initialize health log tables if needed
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS water_logs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        date TEXT NOT NULL,
        amount_ml REAL NOT NULL,
        unit TEXT DEFAULT 'ml',
        notes TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_water_user_date ON water_logs(user_id, date);

      CREATE TABLE IF NOT EXISTS cardio_logs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        date TEXT NOT NULL,
        activity_type TEXT NOT NULL,
        duration_min REAL NOT NULL,
        distance_km REAL,
        steps REAL,
        calories_burned REAL,
        notes TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cardio_user_date ON cardio_logs(user_id, date);

      CREATE TABLE IF NOT EXISTS strength_logs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        date TEXT NOT NULL,
        exercise_name TEXT NOT NULL,
        muscle_group TEXT,
        sets REAL,
        reps REAL,
        weight_kg REAL,
        duration_min REAL,
        calories_burned REAL,
        notes TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_strength_user_date ON strength_logs(user_id, date);

      CREATE TABLE IF NOT EXISTS daily_health_settings (
        user_id TEXT PRIMARY KEY,
        calorie_target REAL DEFAULT 1900,
        water_goal_litres REAL DEFAULT 2.5,
        updated_at TEXT
      );
    `);
    try {
      db.exec("ALTER TABLE meal_logs ADD COLUMN notes TEXT");
    } catch {}
  } catch (e) {
    console.error('Error ensuring health log schema:', e);
  }

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
  let specific = [];
  if (foodPattern) {
    const pat = String(foodPattern).toLowerCase().trim();
    specific = d.prepare(`
      SELECT food_pattern, unit_name, gram_weight, source
      FROM portion_units
      WHERE food_pattern IS NOT NULL AND (? LIKE '%' || food_pattern || '%' OR food_pattern LIKE '%' || ? || '%')
    `).all(pat, pat);
  }
  const generic = d.prepare(`
    SELECT food_pattern, unit_name, gram_weight, source
    FROM portion_units
    WHERE food_pattern IS NULL
  `).all();
  return [...specific, ...generic];
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
           notes, assumptions, created_at
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
      notes, assumptions, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.id,
    entry.user_id,
    entry.date,
    entry.meal_type,
    entry.food_id || null,
    entry.food_name,
    entry.serving_quantity != null ? entry.serving_quantity : 1,
    entry.serving_unit || 'g',
    entry.serving_grams != null ? entry.serving_grams : 0,
    entry.energy_kcal != null ? entry.energy_kcal : 0,
    entry.protein_g != null ? entry.protein_g : 0,
    entry.carb_g != null ? entry.carb_g : 0,
    entry.fat_g != null ? entry.fat_g : 0,
    entry.fibre_g != null ? entry.fibre_g : 0,
    entry.notes || null,
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
        notes = ?, assumptions = ?
    WHERE id = ? AND user_id = ?
  `).run(
    merged.meal_type,
    merged.food_name,
    merged.serving_quantity != null ? merged.serving_quantity : 1,
    merged.serving_unit || 'g',
    merged.serving_grams != null ? merged.serving_grams : 0,
    merged.energy_kcal != null ? merged.energy_kcal : 0,
    merged.protein_g != null ? merged.protein_g : 0,
    merged.carb_g != null ? merged.carb_g : 0,
    merged.fat_g != null ? merged.fat_g : 0,
    merged.fibre_g != null ? merged.fibre_g : 0,
    merged.notes || null,
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

/* ==================== Water Logs ==================== */
export function getWaterLogs(userId, date) {
  const d = getDb();
  return d.prepare(`
    SELECT id, user_id, date, amount_ml, unit, notes, created_at
    FROM water_logs
    WHERE user_id = ? AND date = ?
    ORDER BY created_at ASC
  `).all(userId, date);
}

export function addWaterLog(entry) {
  const d = getDb();
  d.prepare(`
    INSERT OR REPLACE INTO water_logs (
      id, user_id, date, amount_ml, unit, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.id,
    entry.user_id,
    entry.date,
    entry.amount_ml,
    entry.unit || 'ml',
    entry.notes || null,
    entry.created_at || new Date().toISOString()
  );
  return entry;
}

export function deleteWaterLog(id, userId) {
  const d = getDb();
  const res = d.prepare("DELETE FROM water_logs WHERE id = ? AND user_id = ?").run(id, userId);
  return res.changes > 0;
}

/* ==================== Cardio Logs ==================== */
export function getCardioLogs(userId, date) {
  const d = getDb();
  return d.prepare(`
    SELECT id, user_id, date, activity_type, duration_min, distance_km, steps, calories_burned, notes, created_at
    FROM cardio_logs
    WHERE user_id = ? AND date = ?
    ORDER BY created_at ASC
  `).all(userId, date);
}

export function addCardioLog(entry) {
  const d = getDb();
  d.prepare(`
    INSERT OR REPLACE INTO cardio_logs (
      id, user_id, date, activity_type, duration_min, distance_km, steps, calories_burned, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.id,
    entry.user_id,
    entry.date,
    entry.activity_type,
    entry.duration_min,
    entry.distance_km != null ? entry.distance_km : null,
    entry.steps != null ? entry.steps : null,
    entry.calories_burned != null ? entry.calories_burned : null,
    entry.notes || null,
    entry.created_at || new Date().toISOString()
  );
  return entry;
}

export function updateCardioLog(id, userId, updates) {
  const d = getDb();
  const existing = d.prepare("SELECT * FROM cardio_logs WHERE id = ? AND user_id = ?").get(id, userId);
  if (!existing) return null;
  const merged = { ...existing, ...updates };
  d.prepare(`
    UPDATE cardio_logs
    SET activity_type = ?, duration_min = ?, distance_km = ?, steps = ?, calories_burned = ?, notes = ?
    WHERE id = ? AND user_id = ?
  `).run(
    merged.activity_type,
    merged.duration_min,
    merged.distance_km != null ? merged.distance_km : null,
    merged.steps != null ? merged.steps : null,
    merged.calories_burned != null ? merged.calories_burned : null,
    merged.notes || null,
    id,
    userId
  );
  return d.prepare("SELECT * FROM cardio_logs WHERE id = ?").get(id);
}

export function deleteCardioLog(id, userId) {
  const d = getDb();
  const res = d.prepare("DELETE FROM cardio_logs WHERE id = ? AND user_id = ?").run(id, userId);
  return res.changes > 0;
}

/* ==================== Strength Logs ==================== */
export function getStrengthLogs(userId, date) {
  const d = getDb();
  return d.prepare(`
    SELECT id, user_id, date, exercise_name, muscle_group, sets, reps, weight_kg, duration_min, calories_burned, notes, created_at
    FROM strength_logs
    WHERE user_id = ? AND date = ?
    ORDER BY created_at ASC
  `).all(userId, date);
}

export function addStrengthLog(entry) {
  const d = getDb();
  d.prepare(`
    INSERT OR REPLACE INTO strength_logs (
      id, user_id, date, exercise_name, muscle_group, sets, reps, weight_kg, duration_min, calories_burned, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.id,
    entry.user_id,
    entry.date,
    entry.exercise_name,
    entry.muscle_group || null,
    entry.sets != null ? entry.sets : null,
    entry.reps != null ? entry.reps : null,
    entry.weight_kg != null ? entry.weight_kg : null,
    entry.duration_min != null ? entry.duration_min : null,
    entry.calories_burned != null ? entry.calories_burned : null,
    entry.notes || null,
    entry.created_at || new Date().toISOString()
  );
  return entry;
}

export function updateStrengthLog(id, userId, updates) {
  const d = getDb();
  const existing = d.prepare("SELECT * FROM strength_logs WHERE id = ? AND user_id = ?").get(id, userId);
  if (!existing) return null;
  const merged = { ...existing, ...updates };
  d.prepare(`
    UPDATE strength_logs
    SET exercise_name = ?, muscle_group = ?, sets = ?, reps = ?, weight_kg = ?, duration_min = ?, calories_burned = ?, notes = ?
    WHERE id = ? AND user_id = ?
  `).run(
    merged.exercise_name,
    merged.muscle_group || null,
    merged.sets != null ? merged.sets : null,
    merged.reps != null ? merged.reps : null,
    merged.weight_kg != null ? merged.weight_kg : null,
    merged.duration_min != null ? merged.duration_min : null,
    merged.calories_burned != null ? merged.calories_burned : null,
    merged.notes || null,
    id,
    userId
  );
  return d.prepare("SELECT * FROM strength_logs WHERE id = ?").get(id);
}

export function deleteStrengthLog(id, userId) {
  const d = getDb();
  const res = d.prepare("DELETE FROM strength_logs WHERE id = ? AND user_id = ?").run(id, userId);
  return res.changes > 0;
}

/* ==================== Daily Health Settings ==================== */
export function getDailyHealthSettings(userId) {
  const d = getDb();
  const row = d.prepare("SELECT * FROM daily_health_settings WHERE user_id = ?").get(userId);
  if (row) return row;
  return {
    user_id: userId,
    calorie_target: 1900,
    water_goal_litres: 2.5
  };
}

export function setDailyHealthSettings(userId, settings) {
  const d = getDb();
  const now = new Date().toISOString();
  d.prepare(`
    INSERT OR REPLACE INTO daily_health_settings (
      user_id, calorie_target, water_goal_litres, updated_at
    ) VALUES (?, ?, ?, ?)
  `).run(
    userId,
    settings.calorie_target != null ? settings.calorie_target : 1900,
    settings.water_goal_litres != null ? settings.water_goal_litres : 2.5,
    now
  );
  return getDailyHealthSettings(userId);
}
