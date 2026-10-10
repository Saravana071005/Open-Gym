# openGym AI Nutrition Engine — Integration & Architecture Guide

## Overview

The **openGym AI Nutrition Engine** is a high-performance, deterministic nutrition computation and natural-language meal tracking system seamlessly integrated into openGym. It combines verified Indian and international food-composition databases with an NLP entity extraction and matching pipeline, household portion conversions, user nutrition targets, and persistent daily meal logging.

---

## 1. Architecture & Core Philosophy

### Deterministic Nutrition Calculations
- **Never Predicts Fake Numbers**: ML and NLP models are strictly used to understand user intent, extract food entities, units, and preparation states. All nutrient values (calories, protein, carbohydrates, fats, dietary fibre) are calculated deterministically from verified laboratory composition data:
  $$\text{Nutrient Amount} = \frac{\text{Edible Grams}}{100} \times \text{Nutrient per } 100\text{g}$$
- **Missing vs Trace vs Zero**:
  - `0.0`: Analytically verified zero.
  - `Tr` / `Trace`: Sub-threshold trace amounts (preserved without corrupting totals).
  - `null` / `NA`: Not measured; excluded from totals with explicit assumptions rather than assumed zero.

### Component Architecture
```
┌─────────────────────────────────────────────────────────────┐
│                   React 19 + Vite Frontend                  │
│  - /nutrition route with Macro Rings & Daily Timeline       │
│  - Natural Language Meal Box ("2 wheat roti + chicken...")  │
│  - 4 Meal Categories (Breakfast, Lunch, Dinner, Snacks)     │
│  - Food & Recipe Explorer (7,301 verified foods)            │
│  - Calorie & Macro Target Sheet                             │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP / JSON
┌──────────────────────────────▼──────────────────────────────┐
│                    Node.js Backend Server                   │
│  - /api/nutrition/parse      (NL entity & quantity parsing) │
│  - /api/nutrition/calculate  (Deterministic scaling)        │
│  - /api/nutrition/search     (Indexed food search)          │
│  - /api/nutrition/targets    (Target preferences)           │
│  - /api/nutrition/log        (Daily meal persistence)       │
└──────────────────────────────┬──────────────────────────────┘
                               │ Native SQLite (DatabaseSync)
┌──────────────────────────────▼──────────────────────────────┐
│                      SQLite Engine                          │
│  - foods (7,301 verified Indian & global foods)             │
│  - recipe_ingredients (10,271 verified Indian recipe rows)  │
│  - portion_units (263 Indian household unit conversions)    │
│  - user_nutrition_targets & meal_logs (Persistent logs)     │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Ingested Datasets & Provenance

The unified canonical catalogue contains **7,301 verified foods and recipes** ingested from 5 distinct repositories:

| Dataset | Source / Reference | Records Ingested | Key Characteristics |
| :--- | :--- | :--- | :--- |
| **ICMR-NIN 2017 & INDB** | Indian Food Composition Tables (NIN), Hyderabad | **897 foods** | Verified Indian staples, English + Tamil (`Tam.`) + Hindi (`H.`) regional names, full macro & micronutrient profiles |
| **Authentic Indian Recipes** | Indian Nutrient Databank (INDB) | **1,014 recipes** (10,271 ingredient rows) | Authentic regional dishes (dosa, idli, sambar, rasam, biryani, curries) with ingredient weights, cooking methods & serving sizes |
| **Indian Portion Conversions** | INDB Portion Unit Dictionary | **263 rules** | Standardized conversions for roti, phulka, chapati, katori, cup, plate, bowl, tbsp, tsp, slice |
| **USDA FoodData Central** | FNDDS Ingredient Nutrient Values | **1,882 foods** | Standard US and international staple ingredients with validated macro breakdowns |
| **Open Food Facts** | Packaged Food Products | **3,500 products** | Commercial protein powders, dairy, bread, and packaged snack items |
| **Verified Staples** | NIN Laboratory Lab Standards | **8 staples** | High-confidence anchors for roti, steamed rice, cooked chicken, chicken gravy, cooking oil, roasted peanuts, boiled egg, cooked dal |

---

## 3. Natural Language Parser & Entity Extraction

The parser pipeline handles complex, conversational user queries in the following sequence:

1. **Clause Splitting**: Breaks compound meals (e.g., *"150 g rice, 100 g chicken and 1 tablespoon oil"*) on commas, plus signs, and coordinating conjunctions (*and*, *with*).
2. **Entity & Quantity Extraction**:
   - Numeric quantities (integers, decimals, and vulgar fractions like `1/2`, `3/4`).
   - Word numbers (`one`, `two`, `half`, `a`, `an`).
   - Standard units (`g`, `ml`, `cup`, `tbsp`, `tsp`, `katori`, `plate`, `bowl`, `slice`, `piece`, `scoop`, `bar`).
   - Preparation states (`raw`, `cooked`, `roasted`, `boiled`, `fried`).
3. **Food Matching**:
   - Exact canonical name and alias match.
   - Regional alias match (including Tamil names like *Murungai keerai*, *thayir*, *paal*, *nei*, *muttai*).
   - Inverted token-based scoring with staple priority weighting.
4. **Ambiguity Resolution**:
   - Detects incomplete inputs (e.g., bare *"Peanuts"* or *"Roti"* without quantities or preparation states).
   - Generates explicit, polite clarification prompts (e.g., *"Did you mean raw or roasted peanuts? Please select preparation and portion."*).
   - Defaults to editable standard portions with transparent assumptions.

---

## 4. API Endpoints

All endpoints are hosted on the Node.js API server (`http://localhost:3000`):

### 1. `POST /api/nutrition/parse`
Parses a natural-language query and returns calculated nutrients and assumptions.
- **Request**:
  ```json
  { "text": "2 wheat roti with chicken gravy" }
  ```
- **Response**:
  ```json
  {
    "ok": true,
    "raw_input": "2 wheat roti with chicken gravy",
    "items": [
      {
        "food_id": "STAPLE:roti",
        "food_name": "Wheat Roti / Chapati",
        "quantity": 2,
        "unit": "roti",
        "grams": 70,
        "nutrients": {
          "energy_kcal": 207.9,
          "protein_g": 6.3,
          "carb_g": 45,
          "fat_g": 2.1,
          "fibre_g": 4.2
        },
        "confidence": "verified_lab"
      },
      {
        "food_id": "STAPLE:chicken_gravy",
        "food_name": "Chicken Gravy / Curry",
        "quantity": 1,
        "unit": "katori",
        "grams": 150,
        "nutrients": {
          "energy_kcal": 180,
          "protein_g": 13.5,
          "carb_g": 6,
          "fat_g": 11.25,
          "fibre_g": 1.5
        },
        "confidence": "verified_lab"
      }
    ],
    "totals": {
      "energy_kcal": 387.9,
      "protein_g": 19.8,
      "carb_g": 51,
      "fat_g": 13.35,
      "fibre_g": 5.7
    }
  }
  ```

### 2. `GET /api/nutrition/search?q={query}&limit={limit}`
Search the food catalogue by name, alias, or regional term.

### 3. `GET /api/nutrition/food?id={foodId}`
Returns detailed nutrient profile and (for recipes) ingredient composition breakdown.

### 4. `POST /api/nutrition/calculate`
Calculates nutrients deterministically for a specific food ID, quantity, and unit.

### 5. `GET /api/nutrition/targets` & `PUT /api/nutrition/targets`
Gets or sets user-specific daily calorie and macro goals.

### 6. `GET /api/nutrition/log?date=YYYY-MM-DD`
Retrieves authenticated user's logged meals for a specific date.

### 7. `POST /api/nutrition/log`
Logs a meal entry to Breakfast, Lunch, Dinner, or Snacks.

### 8. `PUT /api/nutrition/log/update` & `DELETE /api/nutrition/log/delete`
Updates portion quantities or deletes logged meal entries.

---

## 5. Setup, Import & Backup Procedures

### Ingestion Script Execution
The ingestion pipeline is completely reproducible and can be run at any time:
```powershell
python scripts/ingest_nutrition.py
```
This processes all 5 source datasets and generates:
- `data/nutrition.db` (SQLite relational store)
- `data/nutrition_cache.json` (In-memory fast lookup cache)

### NLP Model Training & Evaluation
To retrain and evaluate the NLP food classifier:
```powershell
python scripts/evaluate_nlp_parser.py
```
This generates:
- `data/models/food_matcher_nb_v1.pkl` (Trained model pipeline)
- `data/nlp_model_eval_report.json` (Evaluation metrics report)

### Database Backup & Restore
- **Backup**:
  ```powershell
  Copy-Item data/nutrition.db data/nutrition_backup_$(Get-Date -Format 'yyyyMMdd').db
  ```
- **Restore**:
  ```powershell
  Copy-Item data/nutrition_backup_YYYYMMDD.db data/nutrition.db
  ```

---

## 6. Automated Test Suites

### Backend Unit & Integration Tests (64 tests)
```powershell
cd api
npm test
```
Verifies:
- Formula scaling (`grams / 100 * value_per_100g`).
- Household portion conversions (roti, cup, katori, tbsp, tsp).
- Missing value null-safety.
- Raw vs cooked ingredient separation.
- Recipe ingredient aggregation and yield calculation.
- Ambiguity detection and natural-language decomposition.
- User data isolation and meal log CRUD.

### Frontend Unit Tests (215 tests)
```powershell
cd frontend
npm test
```
Verifies:
- Zustand store state initialization.
- Meal logging, editing, and deletion.
- Daily macro aggregation and target progress computation.

### Production Bundle Build
```powershell
cd frontend
npm run build
```
Builds the production-ready distribution bundle in under 1 second.
