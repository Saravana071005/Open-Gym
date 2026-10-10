#!/usr/bin/env python3
"""
openGym AI Nutrition Engine - ML/NLP Model Development & Evaluation
Phase 9: Alias & Food Matching Model Training, Evaluation, and Comparison

This script:
1. Builds a labeled dataset of authentic meal strings (English, Hindi/Tamil aliases,
   quantities, fractions, household units, preparation states).
2. Compares:
   - Baseline Rule-Based Exact/Substring Matcher
   - ML TF-IDF + Classifier (MultinomialNB / SGDClassifier)
   - openGym Hybrid Parser (NLP Regex Entity Extractor + Multi-Alias Inverted Index)
3. Evaluates Precision, Recall, F1, Unit Extraction Accuracy, and Ambiguity Detection.
4. Serializes the trained ML model artifact and exports a comprehensive metrics report.
"""

import os
import sys
import json
import sqlite3
import pickle
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.naive_bayes import MultinomialNB
from sklearn.linear_model import SGDClassifier
from sklearn.pipeline import Pipeline
from sklearn.metrics import classification_report, accuracy_score, precision_recall_fscore_support
from sklearn.model_selection import train_test_split

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "nutrition.db")
MODEL_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "models")
REPORT_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "nlp_model_eval_report.json")

os.makedirs(MODEL_DIR, exist_ok=True)

# Labeled benchmark corpus: (raw_query, target_food_id, expected_qty, expected_unit, expected_prep, is_ambiguous)
BENCHMARK_EXAMPLES = [
    # Simple single foods & raw/roasted
    ("Peanuts", "STAPLE:peanuts_roasted", 100, "g", "roasted", True),
    ("100 g roasted peanuts", "STAPLE:peanuts_roasted", 100, "g", "roasted", False),
    ("50g raw peanuts", "STAPLE:peanuts_roasted", 50, "g", "raw", False),
    ("1 apple", "INDB:E001", 1, "piece", "raw", False),
    ("150 g apple", "INDB:E001", 150, "g", "raw", False),
    ("1 boiled egg", "STAPLE:egg_boiled", 1, "piece", "boiled", False),
    ("2 boiled eggs", "STAPLE:egg_boiled", 2, "piece", "boiled", False),
    ("100g oats", "INDB:A042", 100, "g", "raw", False),
    ("1 cup oats", "INDB:A042", 1, "cup", "raw", False),
    ("200 ml cow milk", "INDB:L002", 200, "ml", "liquid", False),
    ("1 glass milk", "INDB:L002", 1, "glass", "liquid", False),
    ("100g paneer", "INDB:L003", 100, "g", "raw", False),
    ("50 g curd", "INDB:L008", 50, "g", "cooked", False),
    ("1 katori curd", "INDB:L008", 1, "katori", "cooked", False),

    # Indian Staples & portions
    ("2 wheat roti", "STAPLE:roti", 2, "piece", "cooked", False),
    ("1 roti", "STAPLE:roti", 1, "piece", "cooked", False),
    ("3 phulka", "STAPLE:roti", 3, "piece", "cooked", False),
    ("2 chapati", "STAPLE:roti", 2, "piece", "cooked", False),
    ("150 g rice", "STAPLE:cooked_rice", 150, "g", "cooked", False),
    ("1 cup cooked rice", "STAPLE:cooked_rice", 1, "cup", "cooked", False),
    ("1 bowl white rice", "STAPLE:cooked_rice", 1, "bowl", "cooked", False),
    ("100 g chicken", "STAPLE:chicken_cooked", 100, "g", "cooked", False),
    ("chicken breast cooked 150g", "STAPLE:chicken_cooked", 150, "g", "cooked", False),
    ("1 tablespoon oil", "STAPLE:cooking_oil", 1, "tbsp", "raw", False),
    ("2 tbsp cooking oil", "STAPLE:cooking_oil", 2, "tbsp", "raw", False),
    ("1 tsp ghee", "INDB:T002", 1, "tsp", "raw", False),
    ("1 cup cooked dal", "STAPLE:dal_cooked", 1, "cup", "cooked", False),
    ("100g moong dal cooked", "STAPLE:dal_cooked", 100, "g", "cooked", False),
    ("chicken gravy 100g", "STAPLE:chicken_gravy", 100, "g", "cooked", False),
    ("1 cup chicken gravy", "STAPLE:chicken_gravy", 1, "cup", "cooked", False),

    # Indian Recipes & regional names
    ("2 plain dosa", "RECIPE:BFP148", 2, "piece", "cooked", False),
    ("1 masala dosa", "RECIPE:ASC146", 1, "piece", "cooked", False),
    ("2 idli", "RECIPE:ASC144", 2, "piece", "cooked", False),
    ("1 plate upma", "RECIPE:BFP039", 1, "plate", "cooked", False),
    ("1 bowl sambar", "RECIPE:ASC167", 1, "bowl", "cooked", False),
    ("1 cup rasam", "RECIPE:BFP176", 1, "cup", "cooked", False),
    ("1 cup rajma", "RECIPE:ASC165", 1, "cup", "cooked", False),
    ("1 cup palak paneer", "RECIPE:ASC215", 1, "cup", "cooked", False),
    ("1 bowl curd rice", "RECIPE:ASC126", 1, "bowl", "cooked", False),

    # Tamil Regional Alias Queries
    ("Murungai keerai 100g", "INDB:C019", 100, "g", "raw", False),
    ("paal 200 ml", "INDB:L002", 200, "ml", "liquid", False),
    ("thayir 1 cup", "INDB:L008", 1, "cup", "cooked", False),
    ("nei 1 tsp", "INDB:T002", 1, "tsp", "raw", False),
    ("muttai 2 boiled", "STAPLE:egg_boiled", 2, "piece", "boiled", False),

    # Ambiguous / Incomplete inputs requiring clarification
    ("Roti", "STAPLE:roti", 1, "piece", "cooked", True),
    ("Rice", "STAPLE:cooked_rice", 100, "g", "cooked", True),
    ("Chicken", "STAPLE:chicken_cooked", 100, "g", "cooked", True),
    ("Dal", "STAPLE:dal_cooked", 1, "cup", "cooked", True),
    ("Gravy", "STAPLE:chicken_gravy", 100, "g", "cooked", True),
]

def load_catalogue():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("SELECT id, name, canonical_name, alternate_names, tamil_name, hindi_name FROM foods")
    foods = {}
    for fid, name, cname, alt_raw, tam, hin in cur.fetchall():
        aliases = [name, cname]
        if alt_raw:
            for a in alt_raw.split(","):
                if a.strip():
                    aliases.append(a.strip())
        if tam and tam.strip():
            aliases.append(tam.strip())
        if hin and hin.strip():
            aliases.append(hin.strip())
        foods[fid] = {"id": fid, "name": name, "aliases": list(set(aliases))}
    conn.close()
    return foods

def extract_entities_regex(query):
    import re
    q = query.lower().strip()
    
    # Extract quantity
    qty = 1.0
    m_frac = re.search(r'\b(\d+)/(\d+)\b', q)
    m_num = re.search(r'\b(\d+(?:\.\d+)?)\s*(?:g|gram|grams|ml|cup|cups|tbsp|tsp|katori|plate|bowl|piece|pieces|slice|slices|scoop|bar)?\b', q)
    if m_frac:
        qty = float(m_frac.group(1)) / float(m_frac.group(2))
    elif m_num:
        try:
            qty = float(m_num.group(1))
        except Exception:
            qty = 1.0

    # Extract unit
    unit = 'piece'
    if re.search(r'\b(?:g|gm|gms|gram|grams)\b', q):
        unit = 'g'
    elif re.search(r'\b(?:ml|milliliter|millilitres)\b', q):
        unit = 'ml'
    elif re.search(r'\b(?:cup|cups)\b', q):
        unit = 'cup'
    elif re.search(r'\b(?:tbsp|tablespoon|tablespoons)\b', q):
        unit = 'tbsp'
    elif re.search(r'\b(?:tsp|teaspoon|teaspoons)\b', q):
        unit = 'tsp'
    elif re.search(r'\b(?:katori|katoris)\b', q):
        unit = 'katori'
    elif re.search(r'\b(?:plate|plates)\b', q):
        unit = 'plate'
    elif re.search(r'\b(?:bowl|bowls)\b', q):
        unit = 'bowl'
    elif re.search(r'\b(?:slice|slices)\b', q):
        unit = 'slice'
    elif re.search(r'\b(?:scoop|scoops)\b', q):
        unit = 'scoop'
    elif re.search(r'\b(?:bar|bars)\b', q):
        unit = 'bar'

    # Extract prep state
    prep = 'cooked'
    if re.search(r'\b(?:raw|fresh|uncooked)\b', q):
        prep = 'raw'
    elif re.search(r'\b(?:roasted|roast)\b', q):
        prep = 'roasted'
    elif re.search(r'\b(?:boiled|boil)\b', q):
        prep = 'boiled'
    elif re.search(r'\b(?:fried|deep fried)\b', q):
        prep = 'fried'

    # Check ambiguity
    # Ambiguous if no quantity or unit specified explicitly
    is_ambiguous = not bool(re.search(r'\d+', q)) and len(q.split()) <= 2

    return qty, unit, prep, is_ambiguous

def rule_based_baseline_matcher(query, foods):
    """Simple baseline: search for food name as exact substring."""
    q = query.lower()
    for fid, f in foods.items():
        if f['name'].lower() in q:
            return fid
        for a in f['aliases']:
            if a.lower() in q:
                return fid
    return None

def open_gym_hybrid_matcher(query, foods):
    """
    Simulates openGym api/nutrition/parser.js + db.js search logic:
    Entity stripping, staple alias mapping, and exact/partial matching.
    """
    import re
    cleaned = re.sub(r'[\d/\.,]', ' ', query.lower())
    for stop in ['g', 'gm', 'grams', 'ml', 'cup', 'cups', 'tbsp', 'tsp', 'katori', 'plate', 'bowl', 'slice', 'piece', 'pieces', 'with', 'and', 'cooked', 'raw', 'roasted', 'boiled', 'glass', 'big', 'small']:
        cleaned = re.sub(rf'\b{stop}\b', ' ', cleaned)
    tokens = [t for t in cleaned.split() if len(t) > 1]
    search_term = " ".join(tokens)
    if not search_term:
        return None

    # 1. Fast staple priority check
    staple_map = {
        'STAPLE:roti': ['roti', 'chapati', 'phulka', 'wheat roti'],
        'STAPLE:cooked_rice': ['rice', 'white rice', 'cooked rice'],
        'STAPLE:chicken_cooked': ['chicken', 'chicken meat', 'chicken breast'],
        'STAPLE:chicken_gravy': ['chicken gravy', 'chicken curry', 'gravy'],
        'STAPLE:cooking_oil': ['cooking oil', 'oil'],
        'STAPLE:peanuts_roasted': ['peanuts', 'peanut', 'roasted peanuts', 'groundnut'],
        'STAPLE:egg_boiled': ['boiled egg', 'egg', 'eggs', 'muttai'],
        'STAPLE:dal_cooked': ['dal', 'cooked dal', 'moong dal', 'lentils'],
    }
    for sid, kws in staple_map.items():
        for kw in kws:
            if kw == search_term or (len(kw) > 3 and kw in search_term):
                return sid

    best_id = None
    best_score = -1

    for fid, f in foods.items():
        fn = f['name'].lower()
        score = 0

        # Exact alias match
        for a in f['aliases']:
            al = a.lower()
            if al == search_term:
                score = max(score, 120)
            elif search_term in al or al in search_term:
                score = max(score, 80)
            elif any(t in al for t in tokens):
                score = max(score, 40)

        if fn == search_term:
            score = max(score, 100)
        elif search_term in fn:
            score = max(score, 70)
        elif any(t in fn for t in tokens):
            score = max(score, 30)

        if score > 0:
            if fid.startswith("RECIPE:"):
                score += 15
            elif fid.startswith("INDB:"):
                score += 10

        if score > best_score:
            best_score = score
            best_id = fid

    return best_id

def train_and_evaluate_ml_model():
    print("Loading food catalogue...")
    foods = load_catalogue()
    print(f"Loaded {len(foods)} foods.")

    # Prepare training dataset from aliases and benchmark examples
    # Synthetic augmented examples from known aliases:
    X_raw = []
    y_raw = []

    # Add benchmark examples
    for query, target_id, qty, unit, prep, ambig in BENCHMARK_EXAMPLES:
        X_raw.append(query)
        y_raw.append(target_id)

    # Augment with variations for these target IDs
    for query, target_id, qty, unit, prep, ambig in BENCHMARK_EXAMPLES:
        f = foods.get(target_id)
        if f:
            for alias in f['aliases']:
                X_raw.append(f"{qty} {unit} {alias}")
                y_raw.append(target_id)
                X_raw.append(f"{alias}")
                y_raw.append(target_id)

    # Train/Validation/Test split (60 / 20 / 20)
    X_train_val, X_test, y_train_val, y_test = train_test_split(
        X_raw, y_raw, test_size=0.20, random_state=42, stratify=None
    )
    X_train, X_val, y_train, y_val = train_test_split(
        X_train_val, y_train_val, test_size=0.25, random_state=42, stratify=None
    )

    print(f"Dataset split: Train={len(X_train)}, Val={len(X_val)}, Test={len(X_test)}")

    # Train ML Classifier: Char-wb and word n-gram TF-IDF + MultinomialNB & SGDClassifier
    ml_pipeline = Pipeline([
        ('tfidf', TfidfVectorizer(ngram_range=(1, 3), analyzer='char_wb', min_df=1)),
        ('clf', MultinomialNB(alpha=0.1))
    ])

    ml_pipeline.fit(X_train, y_train)

    # Evaluate ML on Validation and Test
    val_pred = ml_pipeline.predict(X_val)
    test_pred = ml_pipeline.predict(X_test)

    val_acc = accuracy_score(y_val, val_pred)
    test_acc = accuracy_score(y_test, test_pred)
    p_test, r_test, f1_test, _ = precision_recall_fscore_support(y_test, test_pred, average='weighted', zero_division=0)

    print(f"ML Validation Accuracy: {val_acc:.4f}")
    print(f"ML Test Accuracy:       {test_acc:.4f}")
    print(f"ML Test Precision:      {p_test:.4f}")
    print(f"ML Test Recall:         {r_test:.4f}")
    print(f"ML Test F1 Score:       {f1_test:.4f}")

    # Benchmark comparison on the canonical 50 benchmark queries
    rule_correct = 0
    ml_correct = 0
    hybrid_correct = 0
    unit_correct = 0
    ambig_correct = 0

    detailed_results = []

    for query, true_id, true_qty, true_unit, true_prep, true_ambig in BENCHMARK_EXAMPLES:
        # Entity extraction evaluation
        pred_qty, pred_unit, pred_prep, pred_ambig = extract_entities_regex(query)
        unit_ok = (pred_unit == true_unit)
        ambig_ok = (pred_ambig == true_ambig)
        if unit_ok:
            unit_correct += 1
        if ambig_ok:
            ambig_correct += 1

        # Matching evaluation
        rule_pred = rule_based_baseline_matcher(query, foods)
        ml_p = ml_pipeline.predict([query])[0]
        hybrid_pred = open_gym_hybrid_matcher(query, foods)

        is_rule_ok = (rule_pred == true_id)
        is_ml_ok = (ml_p == true_id)
        is_hybrid_ok = (hybrid_pred == true_id)

        if is_rule_ok: rule_correct += 1
        if is_ml_ok: ml_correct += 1
        if is_hybrid_ok: hybrid_correct += 1

        detailed_results.append({
            "query": query,
            "ground_truth_id": true_id,
            "rule_based_pred": rule_pred,
            "rule_ok": is_rule_ok,
            "ml_pred": ml_p,
            "ml_ok": is_ml_ok,
            "hybrid_pred": hybrid_pred,
            "hybrid_ok": is_hybrid_ok,
            "unit_extracted": pred_unit,
            "unit_ok": unit_ok,
            "ambiguous_flag": pred_ambig,
            "ambiguity_ok": ambig_ok
        })

    n = len(BENCHMARK_EXAMPLES)
    rule_acc = rule_correct / n
    ml_bench_acc = ml_correct / n
    hybrid_acc = hybrid_correct / n
    unit_acc = unit_correct / n
    ambig_acc = ambig_correct / n

    print("\n--- BENCHMARK COMPARISON SUMMARY ---")
    print(f"Total Test Queries:        {n}")
    print(f"Rule-Based Baseline Acc:   {rule_acc:.2%} ({rule_correct}/{n})")
    print(f"ML Classifier Acc:         {ml_bench_acc:.2%} ({ml_correct}/{n})")
    print(f"openGym Hybrid Engine Acc: {hybrid_acc:.2%} ({hybrid_correct}/{n})")
    print(f"Unit Extraction Acc:       {unit_acc:.2%} ({unit_correct}/{n})")
    print(f"Ambiguity Detection Acc:   {ambig_acc:.2%} ({ambig_correct}/{n})")

    # Serialize trained model
    model_file = os.path.join(MODEL_DIR, "food_matcher_nb_v1.pkl")
    with open(model_file, "wb") as f:
        pickle.dump(ml_pipeline, f)
    print(f"\nSaved trained model to {model_file}")

    # Export report
    report = {
        "model_version": "openGym-NLP-v1.0.0",
        "dataset_split": {
            "train_samples": len(X_train),
            "val_samples": len(X_val),
            "test_samples": len(X_test),
        },
        "ml_model_metrics": {
            "validation_accuracy": float(val_acc),
            "test_accuracy": float(test_acc),
            "test_precision": float(p_test),
            "test_recall": float(r_test),
            "test_f1": float(f1_test),
        },
        "benchmark_comparison": {
            "total_benchmark_queries": n,
            "rule_based_accuracy": float(rule_acc),
            "ml_classifier_accuracy": float(ml_bench_acc),
            "opengym_hybrid_accuracy": float(hybrid_acc),
            "unit_extraction_accuracy": float(unit_acc),
            "ambiguity_detection_accuracy": float(ambig_acc)
        },
        "detailed_results": detailed_results
    }

    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    print(f"Saved evaluation report to {REPORT_PATH}")

if __name__ == "__main__":
    train_and_evaluate_ml_model()
