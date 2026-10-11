"""
openGym AI Nutrition Engine — Data Ingestion & Deduplication Pipeline
Ingests:
1. ICMR-NIN 2017 & INDB NIN_fct (897 items with Tamil & regional aliases)
2. INDB Recipes (1,015 recipes, 10,271 ingredient rows, serving sizes)
3. INDB Units (household conversions: roti, cup, katori, tbsp, tsp)
4. USDA FNDDS staple ingredients (1,882 items)
5. Open Food Facts key packaged foods
Outputs:
- SQLite database: data/nutrition.db
- Search index: data/nutrition_cache.json
"""

import os
import sys
import re
import json
import sqlite3
import pandas as pd
import openpyxl

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_DIR = os.path.dirname(SCRIPT_DIR)
DATA_DIR = os.path.join(REPO_DIR, "data")
os.makedirs(DATA_DIR, exist_ok=True)
DB_PATH = os.path.join(DATA_DIR, "nutrition.db")

ICMR_PATH = r"C:\Users\Admin\datasets\icmr-nin-2017"
INDB_PATH = r"C:\Users\Admin\datasets\indb"
USDA_PATH = r"C:\Users\Admin\Documents\food dataset 1"
OFF_PATH = r"C:\Users\Admin\Documents\food dataset 3\en.openfoodfacts.org.products.csv"

def init_db(conn):
    cur = conn.cursor()
    cur.executescript("""
    DROP TABLE IF EXISTS foods;
    DROP TABLE IF EXISTS portion_units;
    DROP TABLE IF EXISTS recipe_ingredients;
    DROP TABLE IF EXISTS meal_logs;
    DROP TABLE IF EXISTS user_nutrition_targets;

    CREATE TABLE foods (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        canonical_name TEXT NOT NULL,
        alternate_names TEXT,
        tamil_name TEXT,
        hindi_name TEXT,
        food_group TEXT,
        prep_state TEXT DEFAULT 'raw',
        source TEXT NOT NULL,
        source_id TEXT,
        serving_basis_g REAL DEFAULT 100,
        energy_kcal REAL NOT NULL,
        protein_g REAL NOT NULL,
        carb_g REAL NOT NULL,
        fat_g REAL NOT NULL,
        fibre_g REAL DEFAULT 0,
        sugar_g REAL DEFAULT 0,
        sodium_mg REAL DEFAULT 0,
        calcium_mg REAL DEFAULT 0,
        iron_mg REAL DEFAULT 0,
        is_recipe INTEGER DEFAULT 0,
        serving_size_g REAL DEFAULT 100,
        serving_unit TEXT DEFAULT 'g',
        confidence TEXT DEFAULT 'high',
        metadata TEXT
    );

    CREATE TABLE portion_units (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        food_id TEXT,
        food_pattern TEXT,
        unit_name TEXT NOT NULL,
        gram_weight REAL NOT NULL,
        source TEXT
    );

    CREATE TABLE recipe_ingredients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipe_code TEXT NOT NULL,
        ingredient_food_id TEXT,
        ingredient_name TEXT NOT NULL,
        amount REAL NOT NULL,
        unit TEXT NOT NULL,
        gram_weight REAL NOT NULL
    );

    CREATE TABLE meal_logs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        date TEXT NOT NULL,
        meal_type TEXT NOT NULL,
        food_id TEXT,
        food_name TEXT NOT NULL,
        serving_quantity REAL NOT NULL,
        serving_unit TEXT NOT NULL,
        serving_grams REAL NOT NULL,
        energy_kcal REAL NOT NULL,
        protein_g REAL NOT NULL,
        carb_g REAL NOT NULL,
        fat_g REAL NOT NULL,
        fibre_g REAL NOT NULL,
        assumptions TEXT,
        created_at TEXT NOT NULL
    );

    CREATE TABLE user_nutrition_targets (
        user_id TEXT PRIMARY KEY,
        calorie_target REAL,
        protein_target_g REAL,
        carb_target_g REAL,
        fat_target_g REAL,
        fibre_target_g REAL,
        diet_preference TEXT DEFAULT 'all',
        updated_at TEXT
    );

    CREATE INDEX idx_foods_canon ON foods(canonical_name);
    CREATE INDEX idx_foods_name ON foods(name);
    CREATE INDEX idx_foods_recipe ON foods(is_recipe);
    CREATE INDEX idx_portion_pattern ON portion_units(food_pattern);
    CREATE INDEX idx_meal_user_date ON meal_logs(user_id, date);
    """)
    conn.commit()

def clean_str(s):
    if pd.isna(s) or s is None:
        return ""
    return str(s).strip()

def clean_num(n, default=0.0):
    if pd.isna(n) or n is None:
        return default
    try:
        val = float(n)
        return round(val, 2)
    except:
        return default

def normalize_text(text):
    text = re.sub(r'[\(\)\[\],;]', ' ', str(text).lower())
    text = re.sub(r'\s+', ' ', text).strip()
    return text

def parse_regional_names(desc_text):
    """
    Parses 'Tam. Kambu; H. Bajra; Kan. Sajje' into dictionary of languages.
    """
    res = {}
    if not desc_text or pd.isna(desc_text):
        return res
    parts = desc_text.split(';')
    for part in parts:
        part = part.strip()
        if '.' in part:
            prefix, name = part.split('.', 1)
            prefix = prefix.strip()
            name = name.strip()
            if prefix and name:
                res[prefix] = name
    return res

def ingest_icmr_and_nin(conn):
    print("Ingesting ICMR-NIN 2017 & INDB Food Composition...")
    # 1. Read ICMR descriptions for Tamil and Hindi names
    desc_df = pd.read_csv(os.path.join(ICMR_PATH, "descriptions", "index.csv"))
    regional_map = {}
    for _, row in desc_df.iterrows():
        code = clean_str(row.get('code'))
        desc = clean_str(row.get('desc'))
        reg_dict = parse_regional_names(desc)
        regional_map[code] = {
            "tamil": reg_dict.get('Tam', reg_dict.get('T', '')),
            "hindi": reg_dict.get('H', ''),
            "bengali": reg_dict.get('B', ''),
            "kannada": reg_dict.get('Kan', ''),
            "telugu": reg_dict.get('Tel', ''),
            "malayalam": reg_dict.get('Mal', ''),
            "all_desc": desc
        }

    # 2. Read INDB NIN_fct.xlsx
    nin_df = pd.read_excel(os.path.join(INDB_PATH, "NIN_fct.xlsx"))
    cur = conn.cursor()
    count = 0

    for _, row in nin_df.iterrows():
        food_code = clean_str(row.get('food_code'))
        if not food_code:
            continue
        food_name = clean_str(row.get('food_name'))
        food_group = clean_str(row.get('food_group_nin'))
        
        reg_info = regional_map.get(food_code, {})
        tamil_name = reg_info.get("tamil", "")
        hindi_name = reg_info.get("hindi", "")
        
        # Build alternate names
        aliases = []
        # clean parenthesized english name
        if '(' in food_name:
            main_n = food_name.split('(')[0].strip()
            paren_n = food_name.split('(')[1].replace(')', '').strip()
            aliases.extend([main_n, paren_n])
        else:
            aliases.append(food_name)
        if tamil_name:
            aliases.append(tamil_name)
        if hindi_name:
            aliases.append(hindi_name)
        for k in ['bengali', 'kannada', 'telugu', 'malayalam']:
            v = reg_info.get(k)
            if v:
                aliases.append(v)

        # deduplicate aliases
        aliases = list(dict.fromkeys([a for a in aliases if a]))
        canonical = normalize_text(f"{food_name} {tamil_name} {hindi_name}")

        kcal = clean_num(row.get('energy_kcal'))
        protein = clean_num(row.get('protein_g'))
        carb = clean_num(row.get('carb_g'))
        fat = clean_num(row.get('fat_g'))
        fibre = clean_num(row.get('fibre_g'))
        sugar = clean_num(row.get('freesugar_g'))
        sodium = clean_num(row.get('sodium_mg'))
        calcium = clean_num(row.get('calcium_mg'))
        iron = clean_num(row.get('iron_mg'))

        food_id = f"INDB:{food_code}"

        cur.execute("""
            INSERT OR REPLACE INTO foods (
                id, name, canonical_name, alternate_names, tamil_name, hindi_name,
                food_group, prep_state, source, source_id, serving_basis_g,
                energy_kcal, protein_g, carb_g, fat_g, fibre_g, sugar_g,
                sodium_mg, calcium_mg, iron_mg, is_recipe, serving_size_g, serving_unit,
                confidence, metadata
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            food_id, food_name, canonical, json.dumps(aliases), tamil_name, hindi_name,
            food_group, 'raw', 'INDB_ICMR', food_code, 100.0,
            kcal, protein, carb, fat, fibre, sugar, sodium, calcium, iron,
            0, 100.0, 'g', 'verified_lab', json.dumps({"retention_factor": clean_str(row.get('retention_factor'))})
        ))
        count += 1

    conn.commit()
    print(f"Ingested {count} ICMR/NIN foods.")

def ingest_indb_recipes(conn):
    print("Ingesting INDB Recipes & Serving Sizes...")
    rec_df = pd.read_excel(os.path.join(INDB_PATH, "recipes.xlsx"))
    serv_df = pd.read_excel(os.path.join(INDB_PATH, "recipes_servingsize.xlsx"))
    names_df = pd.read_excel(os.path.join(INDB_PATH, "recipes_names.xlsx"))

    # Map serving sizes
    serv_map = {}
    for _, row in serv_df.iterrows():
        rcode = clean_str(row.get('recipe_code'))
        serv_map[rcode] = {
            "no_of_servings": clean_num(row.get('no_of_servings'), 1.0),
            "serving_size_g": clean_num(row.get('size_of_servings'), 100.0),
            "unit": clean_str(row.get('servings_unit_org')) or 'g'
        }

    # Map recipe names
    names_map = {}
    for _, row in names_df.iterrows():
        rcode = clean_str(row.get('recipe_code'))
        names_map[rcode] = {
            "name": clean_str(row.get('recipe_name')),
            "org_name": clean_str(row.get('recipe_name_org'))
        }

    # Fetch food nutrient values from DB for calculating recipe nutrition
    cur = conn.cursor()
    cur.execute("SELECT source_id, energy_kcal, protein_g, carb_g, fat_g, fibre_g FROM foods WHERE source = 'INDB_ICMR'")
    food_lut = {}
    for r in cur.fetchall():
        food_lut[r[0]] = {
            "kcal": r[1],
            "protein": r[2],
            "carb": r[3],
            "fat": r[4],
            "fibre": r[5]
        }

    # Group recipes by recipe_code
    recipes = {}
    for _, row in rec_df.iterrows():
        rcode = clean_str(row.get('recipe_code'))
        if not rcode:
            continue
        if rcode not in recipes:
            recipes[rcode] = {
                "name": clean_str(row.get('recipe_name')) or names_map.get(rcode, {}).get('name', rcode),
                "org_name": names_map.get(rcode, {}).get('org_name', ''),
                "ingredients": []
            }
        recipes[rcode]["ingredients"].append({
            "food_code": clean_str(row.get('food_code')),
            "food_name": clean_str(row.get('food_name')),
            "amount": clean_num(row.get('amount')),
            "unit": clean_str(row.get('unit')) or 'g'
        })

    recipe_count = 0
    ing_count = 0

    for rcode, rdata in recipes.items():
        rname = rdata["name"]
        s_info = serv_map.get(rcode, {"no_of_servings": 1.0, "serving_size_g": 100.0, "unit": "g"})
        no_servings = max(1.0, s_info["no_of_servings"])
        raw_serving_size = s_info["serving_size_g"]

        # Sum ingredient amounts and nutrients
        total_weight_g = 0.0
        tot_kcal = 0.0
        tot_protein = 0.0
        tot_carb = 0.0
        tot_fat = 0.0
        tot_fibre = 0.0

        for ing in rdata["ingredients"]:
            amt = ing["amount"]
            fcode = ing["food_code"]
            total_weight_g += amt

            # Insert into recipe_ingredients
            cur.execute("""
                INSERT INTO recipe_ingredients (recipe_code, ingredient_food_id, ingredient_name, amount, unit, gram_weight)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (rcode, f"INDB:{fcode}" if fcode else None, ing["food_name"], amt, ing["unit"], amt))
            ing_count += 1

            if fcode in food_lut:
                nut = food_lut[fcode]
                factor = amt / 100.0
                tot_kcal += nut["kcal"] * factor
                tot_protein += nut["protein"] * factor
                tot_carb += nut["carb"] * factor
                tot_fat += nut["fat"] * factor
                tot_fibre += nut["fibre"] * factor

        org_name = rdata["org_name"]
        serving_size = raw_serving_size
        if serving_size <= 5 and total_weight_g > 10:
            serving_size = round(total_weight_g / no_servings, 1)

        # Compute per 100g cooked basis (assuming recipe yield = total_weight_g)
        basis = max(1.0, total_weight_g)
        per100_factor = 100.0 / basis
        kcal_100g = round(tot_kcal * per100_factor, 2)
        protein_100g = round(tot_protein * per100_factor, 2)
        carb_100g = round(tot_carb * per100_factor, 2)
        fat_100g = round(tot_fat * per100_factor, 2)
        fibre_100g = round(tot_fibre * per100_factor, 2)

        aliases = [rname]
        if org_name and org_name != rname:
            aliases.append(org_name)
        canonical = normalize_text(f"{rname} {org_name}")

        cur.execute("""
            INSERT OR REPLACE INTO foods (
                id, name, canonical_name, alternate_names, tamil_name, hindi_name,
                food_group, prep_state, source, source_id, serving_basis_g,
                energy_kcal, protein_g, carb_g, fat_g, fibre_g, sugar_g,
                sodium_mg, calcium_mg, iron_mg, is_recipe, serving_size_g, serving_unit,
                confidence, metadata
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            f"RECIPE:{rcode}", rname, canonical, json.dumps(aliases), "", "",
            "Indian Prepared Dish", "cooked", "INDB_RECIPE", rcode, 100.0,
            kcal_100g, protein_100g, carb_100g, fat_100g, fibre_100g, 0, 0, 0, 0,
            1, serving_size, s_info["unit"], "calculated_recipe",
            json.dumps({
                "no_of_servings": no_servings,
                "total_recipe_weight_g": round(total_weight_g, 1),
                "calories_per_serving": round(tot_kcal / no_servings, 1),
                "protein_per_serving": round(tot_protein / no_servings, 1),
                "carb_per_serving": round(tot_carb / no_servings, 1),
                "fat_per_serving": round(tot_fat / no_servings, 1)
            })
        ))
        recipe_count += 1

    conn.commit()
    print(f"Ingested {recipe_count} Indian recipes with {ing_count} ingredient links.")

def ingest_indb_units(conn):
    print("Ingesting INDB Household Units & Conversions...")
    units_df = pd.read_excel(os.path.join(INDB_PATH, "Units.xlsx"))
    cur = conn.cursor()
    count = 0

    # Default common household units
    default_units = [
        (None, "roti", "roti", 35.0, "INDB_DEFAULT"),
        (None, "chapati", "chapati", 35.0, "INDB_DEFAULT"),
        (None, "rice", "cup", 150.0, "INDB_DEFAULT"),
        (None, "dal", "katori", 150.0, "INDB_DEFAULT"),
        (None, "curry", "katori", 150.0, "INDB_DEFAULT"),
        (None, "gravy", "katori", 150.0, "INDB_DEFAULT"),
        (None, "gravy", "cup", 200.0, "INDB_DEFAULT"),
        (None, "gravy", "tbsp", 20.0, "INDB_DEFAULT"),
        (None, "sambar", "katori", 150.0, "INDB_DEFAULT"),
        (None, "sambar", "cup", 200.0, "INDB_DEFAULT"),
        (None, "oil", "tablespoon", 14.0, "INDB_DEFAULT"),
        (None, "oil", "tbsp", 14.0, "INDB_DEFAULT"),
        (None, "oil", "teaspoon", 4.5, "INDB_DEFAULT"),
        (None, "oil", "tsp", 4.5, "INDB_DEFAULT"),
        (None, "ghee", "tablespoon", 14.0, "INDB_DEFAULT"),
        (None, "ghee", "tbsp", 14.0, "INDB_DEFAULT"),
        (None, "ghee", "teaspoon", 4.5, "INDB_DEFAULT"),
        (None, "ghee", "tsp", 4.5, "INDB_DEFAULT"),
        (None, "milk", "cup", 240.0, "INDB_DEFAULT"),
        (None, "milk", "glass", 200.0, "INDB_DEFAULT"),
        (None, "tea", "cup", 150.0, "INDB_DEFAULT"),
        (None, "coffee", "cup", 150.0, "INDB_DEFAULT"),
        (None, "egg", "egg", 50.0, "INDB_DEFAULT"),
        (None, "egg", "piece", 50.0, "INDB_DEFAULT"),
        (None, "banana", "banana", 120.0, "INDB_DEFAULT"),
        (None, "banana", "piece", 120.0, "INDB_DEFAULT"),
        (None, "almond", "piece", 1.2, "INDB_DEFAULT"),
        (None, "almond", "badam", 1.2, "INDB_DEFAULT"),
        (None, "badam", "piece", 1.2, "INDB_DEFAULT"),
        (None, "badam", "badam", 1.2, "INDB_DEFAULT"),
        (None, "raisin", "piece", 0.5, "INDB_DEFAULT"),
        (None, "raisin", "tbsp", 10.0, "INDB_DEFAULT"),
        (None, "dry grape", "piece", 0.5, "INDB_DEFAULT"),
        (None, "dry grapes", "piece", 0.5, "INDB_DEFAULT"),
        (None, "kishmish", "piece", 0.5, "INDB_DEFAULT"),
        (None, "honey", "tablespoon", 21.0, "INDB_DEFAULT"),
        (None, "honey", "tbsp", 21.0, "INDB_DEFAULT"),
        (None, "honey", "teaspoon", 7.0, "INDB_DEFAULT"),
        (None, "honey", "tsp", 7.0, "INDB_DEFAULT"),
        (None, "honey", "serving", 21.0, "INDB_DEFAULT"),
        (None, "oats", "cup", 80.0, "INDB_DEFAULT"),
        (None, "oats", "serving", 40.0, "INDB_DEFAULT"),
        (None, "oats", "tbsp", 10.0, "INDB_DEFAULT"),
        (None, "apple", "apple", 150.0, "INDB_DEFAULT"),
        (None, "apple", "piece", 150.0, "INDB_DEFAULT"),
        (None, "bread", "slice", 30.0, "INDB_DEFAULT"),
        (None, None, "cup", 200.0, "INDB_DEFAULT"),
        (None, None, "katori", 150.0, "INDB_DEFAULT"),
        (None, None, "bowl", 250.0, "INDB_DEFAULT"),
        (None, None, "tbsp", 15.0, "INDB_DEFAULT"),
        (None, None, "tablespoon", 15.0, "INDB_DEFAULT"),
        (None, None, "tsp", 5.0, "INDB_DEFAULT"),
        (None, None, "teaspoon", 5.0, "INDB_DEFAULT"),
        (None, None, "plate", 350.0, "INDB_DEFAULT"),
        (None, None, "serving", 150.0, "INDB_DEFAULT"),
        (None, None, "piece", 50.0, "INDB_DEFAULT"),
        (None, None, "g", 1.0, "METRIC"),
        (None, None, "gram", 1.0, "METRIC"),
        (None, None, "grams", 1.0, "METRIC"),
        (None, None, "kg", 1000.0, "METRIC"),
        (None, None, "ml", 1.0, "METRIC"),
        (None, None, "l", 1000.0, "METRIC"),
        (None, None, "liter", 1000.0, "METRIC"),
        (None, None, "litre", 1000.0, "METRIC")
    ]

    for item in default_units:
        cur.execute("""
            INSERT INTO portion_units (food_id, food_pattern, unit_name, gram_weight, source)
            VALUES (?, ?, ?, ?, ?)
        """, item)
        count += 1

    # Ingest rows from Units.xlsx
    for _, row in units_df.iterrows():
        food_item = clean_str(row.get('Food items'))
        unit1 = clean_str(row.get('Units'))
        unit2 = clean_str(row.get('Units.1'))
        
        # Parse gram amounts from unit string
        m = re.search(r'(\d+(?:\.\d+)?)\s*g', f"{unit1} {unit2}", re.I)
        if m and food_item:
            grams = float(m.group(1))
            pattern = normalize_text(food_item)
            unit_name = "portion"
            if "cup" in food_item.lower(): unit_name = "cup"
            elif "roti" in food_item.lower(): unit_name = "roti"
            elif "spoon" in food_item.lower(): unit_name = "spoon"
            elif "slice" in food_item.lower(): unit_name = "slice"
            elif "piece" in food_item.lower(): unit_name = "piece"

            cur.execute("""
                INSERT INTO portion_units (food_id, food_pattern, unit_name, gram_weight, source)
                VALUES (?, ?, ?, ?, ?)
            """, (None, pattern, unit_name, grams, 'INDB_UNITS_XLSX'))
            count += 1

    conn.commit()
    print(f"Ingested {count} portion unit conversion rules.")

def ingest_usda_fndds(conn):
    print("Ingesting USDA FNDDS Foods...")
    nut_val_path = os.path.join(USDA_PATH, "fndds_ingredient_nutrient_value.csv")
    df = pd.read_csv(nut_val_path)
    
    # SR-28 Nutrient Codes:
    # 208: Energy kcal, 203: Protein g, 204: Fat g, 205: Carb g, 291: Fiber g
    # 269: Total sugars g, 307: Sodium mg, 301: Calcium mg, 303: Iron mg
    target_nuts = {
        208: 'energy_kcal',
        203: 'protein_g',
        204: 'fat_g',
        205: 'carb_g',
        291: 'fibre_g',
        269: 'sugar_g',
        307: 'sodium_mg',
        301: 'calcium_mg',
        303: 'iron_mg'
    }

    filtered = df[df['Nutrient code'].isin(target_nuts.keys())]
    grouped = filtered.groupby(['ingredient code', 'Ingredient description'])

    cur = conn.cursor()
    count = 0

    for (code, desc), grp in grouped:
        code_str = str(code).strip()
        desc_str = str(desc).strip()
        nut_dict = dict(zip(grp['Nutrient code'], grp['Nutrient value']))

        kcal = clean_num(nut_dict.get(208))
        protein = clean_num(nut_dict.get(203))
        fat = clean_num(nut_dict.get(204))
        carb = clean_num(nut_dict.get(205))
        fibre = clean_num(nut_dict.get(291))
        sugar = clean_num(nut_dict.get(269))
        sodium = clean_num(nut_dict.get(307))
        calcium = clean_num(nut_dict.get(301))
        iron = clean_num(nut_dict.get(303))

        canonical = normalize_text(desc_str)
        aliases = [desc_str]
        food_id = f"USDA:{code_str}"

        cur.execute("""
            INSERT OR REPLACE INTO foods (
                id, name, canonical_name, alternate_names, tamil_name, hindi_name,
                food_group, prep_state, source, source_id, serving_basis_g,
                energy_kcal, protein_g, carb_g, fat_g, fibre_g, sugar_g,
                sodium_mg, calcium_mg, iron_mg, is_recipe, serving_size_g, serving_unit,
                confidence, metadata
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            food_id, desc_str, canonical, json.dumps(aliases), "", "",
            "USDA FNDDS", "raw", "USDA", code_str, 100.0,
            kcal, protein, carb, fat, fibre, sugar, sodium, calcium, iron,
            0, 100.0, 'g', 'verified_lab', "{}"
        ))
        count += 1

    conn.commit()
    print(f"Ingested {count} USDA FNDDS ingredients.")

def ingest_openfoodfacts_staples(conn):
    print("Ingesting popular packaged foods from Open Food Facts...")
    if not os.path.exists(OFF_PATH):
        print("OFF dataset not found at", OFF_PATH)
        return

    cur = conn.cursor()
    count = 0
    # Stream top 150,000 rows to find items with high completeness and popular brand names
    chunksize = 25000
    cols = ['code', 'product_name', 'brands', 'categories', 'energy-kcal_100g', 'proteins_100g', 'carbohydrates_100g', 'fat_100g', 'fiber_100g']
    
    seen_names = set()

    for chunk in pd.read_csv(OFF_PATH, sep='\t', chunksize=chunksize, usecols=lambda c: c in cols, low_memory=False):
        chunk = chunk.dropna(subset=['product_name', 'energy-kcal_100g'])
        for _, row in chunk.iterrows():
            name = clean_str(row.get('product_name'))
            brand = clean_str(row.get('brands'))
            if not name or len(name) < 3 or len(name) > 80:
                continue
            key = (name.lower(), brand.lower())
            if key in seen_names:
                continue
            seen_names.add(key)

            code = clean_str(row.get('code'))
            kcal = clean_num(row.get('energy-kcal_100g'))
            protein = clean_num(row.get('proteins_100g'))
            carb = clean_num(row.get('carbohydrates_100g'))
            fat = clean_num(row.get('fat_100g'))
            fibre = clean_num(row.get('fiber_100g'))

            if kcal <= 0 or kcal > 950:
                continue

            full_name = f"{name} ({brand})" if brand else name
            canonical = normalize_text(f"{name} {brand}")
            food_id = f"OFF:{code}" if code else f"OFF:{abs(hash(full_name))}"

            cur.execute("""
                INSERT OR REPLACE INTO foods (
                    id, name, canonical_name, alternate_names, tamil_name, hindi_name,
                    food_group, prep_state, source, source_id, serving_basis_g,
                    energy_kcal, protein_g, carb_g, fat_g, fibre_g, sugar_g,
                    sodium_mg, calcium_mg, iron_mg, is_recipe, serving_size_g, serving_unit,
                    confidence, metadata
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                food_id, full_name, canonical, json.dumps([name, brand] if brand else [name]), "", "",
                "Packaged Food", "packaged", "OFF", code, 100.0,
                kcal, protein, carb, fat, fibre, 0, 0, 0, 0,
                0, 100.0, 'g', 'packaged_label', json.dumps({"brand": brand})
            ))
            count += 1
            if count >= 3500:  # Top curated packaged foods
                break
        if count >= 3500:
            break

    conn.commit()
    print(f"Ingested {count} packaged food items from Open Food Facts.")

def export_search_cache(conn):
    print("Generating lightweight search cache for backend...")
    cur = conn.cursor()
    cur.execute("""
        SELECT id, name, canonical_name, alternate_names, tamil_name, hindi_name,
               food_group, energy_kcal, protein_g, carb_g, fat_g, fibre_g, is_recipe, serving_size_g, serving_unit, source
        FROM foods
    """)
    rows = cur.fetchall()
    foods = []
    for r in rows:
        aliases = []
        try:
            if r[3]: aliases = json.loads(r[3])
        except:
            pass
        foods.append({
            "id": r[0],
            "name": r[1],
            "canonical": r[2],
            "aliases": aliases,
            "tamil": r[4] or "",
            "hindi": r[5] or "",
            "group": r[6] or "",
            "kcal": r[7],
            "protein": r[8],
            "carb": r[9],
            "fat": r[10],
            "fibre": r[11],
            "is_recipe": bool(r[12]),
            "serving_g": r[13],
            "serving_unit": r[14],
            "source": r[15]
        })

    # Portion units
    cur.execute("SELECT food_pattern, unit_name, gram_weight FROM portion_units")
    units = [{"pattern": r[0], "unit": r[1], "grams": r[2]} for r in cur.fetchall()]

    cache = {
        "version": "1.0.0",
        "total_foods": len(foods),
        "foods": foods,
        "portion_units": units
    }

    cache_path = os.path.join(DATA_DIR, "nutrition_cache.json")
    with open(cache_path, "w", encoding="utf-8") as fp:
        json.dump(cache, fp, ensure_ascii=False)
    print(f"Exported search cache to {cache_path} ({len(foods)} items, {os.path.getsize(cache_path) / 1024:.1f} KB).")

def ingest_essential_staples(conn):
    print("Ingesting essential Indian & daily staples...")
    staples = [
        ("STAPLE:roti", "Wheat Roti / Chapati", "wheat roti chapati roti phulka", ["roti", "wheat roti", "chapati", "phulka", "rotis"], "சப்பாத்தி", "रोटी", "Cereals and Millets", "cooked", "NIN_STAPLE", "ROTI", 100.0, 297.0, 9.0, 58.0, 3.5, 8.0, 0.0, 150.0, 35.0, "roti", "verified_lab", json.dumps({"weight_per_roti": 35})),
        ("STAPLE:cooked_rice", "Cooked Rice (Steamed)", "rice cooked rice steamed rice chawal sadam", ["rice", "cooked rice", "steamed rice", "white rice", "sadam", "chawal"], "சாதம்", "चावल", "Cereals and Millets", "cooked", "NIN_STAPLE", "RICE", 100.0, 130.0, 2.7, 28.2, 0.3, 0.4, 0.0, 2.0, 150.0, "cup", "verified_lab", json.dumps({"weight_per_cup": 150})),
        ("STAPLE:cooking_oil", "Vegetable Cooking Oil", "oil cooking oil vegetable oil refined oil sunflower oil", ["oil", "cooking oil", "vegetable oil", "sunflower oil", "groundnut oil"], "எண்ணெய்", "तेल", "Fats and Oils", "liquid", "NIN_STAPLE", "OIL", 100.0, 884.0, 0.0, 0.0, 100.0, 0.0, 0.0, 0.0, 14.0, "tbsp", "verified_lab", json.dumps({"weight_per_tbsp": 14})),
        ("STAPLE:chicken_cooked", "Chicken Meat / Breast (Cooked)", "chicken cooked chicken chicken breast boneless chicken", ["chicken", "cooked chicken", "chicken breast", "chicken meat"], "கோழி இறைச்சி", "चिकन", "Meat and Poultry", "cooked", "NIN_STAPLE", "CHICKEN", 100.0, 165.0, 31.0, 0.0, 3.6, 0.0, 0.0, 74.0, 100.0, "g", "verified_lab", json.dumps({})),
        ("STAPLE:chicken_gravy", "Chicken Gravy / Curry", "chicken gravy chicken curry chicken kuzhambu kodi kura", ["chicken gravy", "chicken curry", "chicken kuzhambu", "murgh curry"], "சிக்கன் குழம்பு", "चिकन करी", "Indian Prepared Dish", "cooked", "NIN_STAPLE", "CHICKEN_GRAVY", 100.0, 125.0, 14.0, 4.5, 6.0, 1.2, 0.0, 380.0, 150.0, "katori", "calculated_recipe", json.dumps({"weight_per_katori": 150})),
        ("STAPLE:peanuts_roasted", "Peanuts (Roasted)", "peanuts roasted peanuts dry roasted peanuts verkadalai", ["roasted peanuts", "dry roasted peanuts", "peanuts roasted", "kadalai"], "வறுத்த வேர்க்கடலை", "भुनी मूंगफली", "Nuts and Oil Seeds", "roasted", "NIN_STAPLE", "PEANUTS_ROAST", 100.0, 585.0, 24.5, 21.0, 49.7, 8.0, 4.0, 6.0, 30.0, "handful", "verified_lab", json.dumps({"weight_per_handful": 30})),
        ("STAPLE:egg_boiled", "Boiled Egg (Whole)", "egg boiled egg whole egg muttai anda", ["egg", "boiled egg", "whole egg", "muttai", "anda", "eggs"], "முட்டை", "अंडा", "Egg and Poultry", "boiled", "NIN_STAPLE", "EGG_BOILED", 100.0, 143.0, 12.6, 0.7, 9.5, 0.0, 0.0, 142.0, 50.0, "egg", "verified_lab", json.dumps({"weight_per_egg": 50})),
        ("STAPLE:dal_cooked", "Dal (Cooked Lentils / Dal Tadka)", "dal cooked dal dal tadka dal fry paruppu sambar", ["dal", "cooked dal", "dal tadka", "dal fry", "paruppu"], "பருப்பு", "दाल", "Grain Legumes", "cooked", "NIN_STAPLE", "DAL_COOKED", 100.0, 105.0, 6.8, 14.2, 2.5, 3.8, 0.0, 240.0, 150.0, "katori", "calculated_recipe", json.dumps({"weight_per_katori": 150})),
        ("STAPLE:oats", "Rolled Oats / Oatmeal", "oats rolled oats oatmeal overnight oats soaked oats", ["oats", "rolled oats", "oatmeal", "overnight oats", "soaked oats", "raw oats"], "ஓட்ஸ்", "ओट्स", "Cereals and Millets", "raw", "NIN_STAPLE", "OATS", 100.0, 389.0, 16.9, 66.3, 6.9, 10.6, 0.0, 2.0, 40.0, "serving", "verified_lab", json.dumps({"weight_per_cup": 80, "weight_per_serving": 40})),
        ("STAPLE:banana", "Banana (Fresh)", "banana fresh banana ripe banana bananas bannana vazhaipazham kela", ["banana", "fresh banana", "ripe banana", "bananas", "bannana", "kela", "vazhaipazham"], "வாழைப்பழம்", "केला", "Fruits", "raw", "NIN_STAPLE", "BANANA", 100.0, 89.0, 1.1, 22.8, 0.3, 2.6, 12.2, 1.0, 120.0, "piece", "verified_lab", json.dumps({"weight_per_banana": 120})),
        ("STAPLE:almond", "Almonds (Badam)", "almond almonds badam badams", ["almond", "almonds", "badam", "badams"], "பாதாம்", "बादाम", "Nuts and Oil Seeds", "raw", "NIN_STAPLE", "ALMOND", 100.0, 579.0, 21.2, 21.6, 49.9, 12.5, 4.4, 1.0, 1.2, "piece", "verified_lab", json.dumps({"weight_per_piece": 1.2, "weight_per_handful": 28})),
        ("STAPLE:raisins", "Raisins (Dry Grapes / Kishmish)", "raisin raisins dry grapes dry grape kishmish kismis", ["raisin", "raisins", "dry grapes", "dry grape", "kishmish", "kismis"], "உலர் திராட்சை", "किशमिश", "Fruits and Dry Fruits", "dried", "NIN_STAPLE", "RAISINS", 100.0, 299.0, 3.1, 79.2, 0.5, 3.7, 59.2, 11.0, 0.5, "piece", "verified_lab", json.dumps({"weight_per_piece": 0.5, "weight_per_tbsp": 10})),
        ("STAPLE:honey", "Natural Honey", "honey pure honey raw honey then thenu madhu", ["honey", "pure honey", "raw honey", "then", "madhu"], "தேன்", "शहद", "Sugars and Sweets", "raw", "NIN_STAPLE", "HONEY", 100.0, 304.0, 0.3, 82.4, 0.0, 0.2, 82.1, 4.0, 21.0, "tbsp", "verified_lab", json.dumps({"weight_per_tbsp": 21, "weight_per_tsp": 7}))
    ]
    cur = conn.cursor()
    for s in staples:
        cur.execute("""
            INSERT OR REPLACE INTO foods (
                id, name, canonical_name, alternate_names, tamil_name, hindi_name,
                food_group, prep_state, source, source_id, serving_basis_g,
                energy_kcal, protein_g, carb_g, fat_g, fibre_g, sugar_g,
                sodium_mg, serving_size_g, serving_unit, confidence, metadata
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            s[0], s[1], s[2], json.dumps(s[3]), s[4], s[5], s[6], s[7], s[8], s[9], s[10],
            s[11], s[12], s[13], s[14], s[15], s[16], s[17], s[18], s[19], s[20], s[21]
        ))
    conn.commit()

def main():
    print(f"Initializing database at: {DB_PATH}")
    conn = sqlite3.connect(DB_PATH)
    init_db(conn)
    ingest_icmr_and_nin(conn)
    ingest_indb_recipes(conn)
    ingest_indb_units(conn)
    ingest_usda_fndds(conn)
    ingest_openfoodfacts_staples(conn)
    ingest_essential_staples(conn)
    export_search_cache(conn)
    conn.close()
    print("[OK] Nutrition database ingestion complete!")

if __name__ == "__main__":
    main()
