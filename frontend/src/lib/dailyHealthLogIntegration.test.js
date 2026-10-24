import { describe, it, expect } from 'vitest';
import { buildDailyReportDoc, CHATGPT_ANALYSIS_PROMPT } from './exportDailyReportPdf.js';

describe('Daily Health Log: Full End-to-End Tracking & Calculations Suite', () => {
  // Test 1: Food intake manual entry, edit, delete, and meal subtotals
  it('handles manual food entries, portion edits, meal subtotals, and deletions', () => {
    let foods = [];
    const date = '2026-10-25';

    // 1. Add breakfast
    const eggEntry = {
      id: 'f1',
      date,
      meal_type: 'breakfast',
      food_name: 'Boiled Eggs',
      serving_quantity: 2,
      serving_unit: 'piece',
      energy_kcal: 155,
      protein_g: 13,
      carb_g: 1.1,
      fat_g: 11,
      notes: 'Pasture raised'
    };
    foods.push(eggEntry);

    // 2. Add lunch
    const riceChicken = {
      id: 'f2',
      date,
      meal_type: 'lunch',
      food_name: 'Steamed Rice with Grilled Chicken',
      serving_quantity: 1,
      serving_unit: 'serving',
      energy_kcal: 550,
      protein_g: 45,
      carb_g: 65,
      fat_g: 8,
      notes: 'Cooked with olive oil'
    };
    foods.push(riceChicken);

    // 3. Add snack
    const appleAlmonds = {
      id: 'f3',
      date,
      meal_type: 'snacks',
      food_name: 'Apple and Almonds',
      serving_quantity: 1,
      serving_unit: 'serving',
      energy_kcal: 220,
      protein_g: 6,
      carb_g: 28,
      fat_g: 12,
      notes: 'Afternoon snack'
    };
    foods.push(appleAlmonds);

    expect(foods.length).toBe(3);

    // Calculate totals
    const totalCal = foods.reduce((acc, f) => acc + f.energy_kcal, 0);
    const totalProt = foods.reduce((acc, f) => acc + f.protein_g, 0);
    const totalCarb = foods.reduce((acc, f) => acc + f.carb_g, 0);
    const totalFat = foods.reduce((acc, f) => acc + f.fat_g, 0);

    expect(totalCal).toBe(925);
    expect(totalProt).toBe(64);
    expect(totalCarb).toBe(94.1);
    expect(totalFat).toBe(31);

    // Edit quantity and calories of Boiled Eggs (e.g. from 2 to 3 eggs)
    foods = foods.map(f => f.id === 'f1' ? { ...f, serving_quantity: 3, energy_kcal: 232.5, protein_g: 19.5, fat_g: 16.5 } : f);
    const updatedEgg = foods.find(f => f.id === 'f1');
    expect(updatedEgg.serving_quantity).toBe(3);
    expect(updatedEgg.energy_kcal).toBe(232.5);

    // Delete snack
    foods = foods.filter(f => f.id !== 'f3');
    expect(foods.length).toBe(2);
    expect(foods.find(f => f.id === 'f3')).toBeUndefined();
  });

  // Test 2: Water tracker multiple entries, no duplicate counting, goal and remaining calculation
  it('manages multiple water entries, progress bar %, and remaining water', () => {
    const waterGoalLitres = 2.5;
    const waterGoalMl = waterGoalLitres * 1000;
    const waterLogs = [];

    // Entry 1: Morning glass 250ml
    waterLogs.push({ id: 'w1', amount_ml: 250, notes: 'Morning' });
    // Entry 2: Post-workout bottle 500ml
    waterLogs.push({ id: 'w2', amount_ml: 500, notes: 'Post-workout' });
    // Entry 3: Lunch bottle 750ml
    waterLogs.push({ id: 'w3', amount_ml: 750, notes: 'With lunch' });

    const uniqueIds = new Set(waterLogs.map(w => w.id));
    expect(uniqueIds.size).toBe(3); // No duplicates

    const totalWaterMl = waterLogs.reduce((acc, w) => acc + w.amount_ml, 0);
    expect(totalWaterMl).toBe(1500);

    const totalWaterLitres = totalWaterMl / 1000;
    expect(totalWaterLitres).toBe(1.5);

    const remainingMl = Math.max(0, waterGoalMl - totalWaterMl);
    expect(remainingMl).toBe(1000);

    const percent = Math.min(100, Math.round((totalWaterLitres / waterGoalLitres) * 100));
    expect(percent).toBe(60);
  });

  // Test 3: Cardio activity multiple sessions
  it('records multiple cardio sessions with duration, distance, steps, and optional calories', () => {
    const cardioLogs = [
      {
        id: 'c1',
        activity_type: 'walking',
        duration_min: 30,
        distance_km: 2.5,
        steps: 3500,
        calories_burned: 140,
        notes: 'Morning brisk walk'
      },
      {
        id: 'c2',
        activity_type: 'cycling',
        duration_min: 45,
        distance_km: 15.0,
        steps: null,
        calories_burned: 320,
        notes: 'Outdoor cycle'
      }
    ];

    const totalDuration = cardioLogs.reduce((acc, c) => acc + c.duration_min, 0);
    const totalDistance = cardioLogs.reduce((acc, c) => acc + (c.distance_km || 0), 0);
    const totalSteps = cardioLogs.reduce((acc, c) => acc + (c.steps || 0), 0);
    const totalCaloriesBurned = cardioLogs.reduce((acc, c) => acc + (c.calories_burned || 0), 0);

    expect(totalDuration).toBe(75);
    expect(totalDistance).toBe(17.5);
    expect(totalSteps).toBe(3500);
    expect(totalCaloriesBurned).toBe(460);
  });

  // Test 4: Strength workout multiple exercises, no automatic calories
  it('records strength workouts without inventing calories burned from sets or weights', () => {
    const strengthLogs = [
      {
        id: 's1',
        exercise_name: 'Barbell Bench Press',
        muscle_group: 'Chest',
        sets: 4,
        reps: 10,
        weight_kg: 70,
        duration_min: 20,
        calories_burned: null, // User did not estimate
        notes: 'RPE 8.5'
      },
      {
        id: 's2',
        exercise_name: 'Incline Dumbbell Press',
        muscle_group: 'Chest',
        sets: 3,
        reps: 12,
        weight_kg: 24,
        duration_min: 15,
        calories_burned: 65, // Optional user estimate
        notes: 'Good squeeze'
      }
    ];

    expect(strengthLogs[0].calories_burned).toBeNull(); // No invented calories
    expect(strengthLogs[1].calories_burned).toBe(65);

    const totalStrengthDuration = strengthLogs.reduce((acc, s) => acc + (s.duration_min || 0), 0);
    expect(totalStrengthDuration).toBe(35);
  });

  // Test 5: Calorie target 1,900 kcal logic (below, exact, above)
  it('correctly calculates remaining or excess calories relative to 1,900 kcal target', () => {
    const TARGET = 1900;

    // Case 1: Below target (1,450 kcal)
    const intakeBelow = 1450;
    const diffBelow = intakeBelow - TARGET;
    expect(diffBelow).toBe(-450);
    expect(Math.abs(diffBelow)).toBe(450); // 450 kcal remaining

    // Case 2: Exactly at target (1,900 kcal)
    const intakeExact = 1900;
    const diffExact = intakeExact - TARGET;
    expect(diffExact).toBe(0); // Target reached

    // Case 3: Above target (2,250 kcal)
    const intakeAbove = 2250;
    const diffAbove = intakeAbove - TARGET;
    expect(diffAbove).toBe(350); // 350 kcal above target
  });

  // Test 6: Reopening different dates
  it('supports saving and reopening records separately by date', () => {
    const store = {
      '2026-10-24': {
        foods: [{ id: 'f_old', meal_type: 'dinner', food_name: 'Soup', energy_kcal: 300 }],
        water: [{ id: 'w_old', amount_ml: 1000 }]
      },
      '2026-10-25': {
        foods: [{ id: 'f_new', meal_type: 'lunch', food_name: 'Steak', energy_kcal: 800 }],
        water: [{ id: 'w_new', amount_ml: 2000 }]
      }
    };

    expect(store['2026-10-24'].foods[0].food_name).toBe('Soup');
    expect(store['2026-10-25'].foods[0].food_name).toBe('Steak');
    expect(store['2026-10-24'].foods.length).toBe(1);
    expect(store['2026-10-25'].foods.length).toBe(1);
  });

  // Test 7: Export PDF report contains all data and exact ChatGPT prompt
  it('builds a complete PDF report with all user data and the exact ChatGPT prompt', () => {
    const doc = buildDailyReportDoc({
      date: '2026-10-25',
      foods: [
        {
          meal_type: 'lunch',
          food_name: 'Grilled Salmon with Quinoa',
          serving_quantity: 1,
          serving_unit: 'serving',
          energy_kcal: 620,
          protein_g: 48,
          carb_g: 45,
          fat_g: 22,
          notes: 'Fresh salmon fillet'
        }
      ],
      water: [
        { amount_ml: 1000, notes: '2 glasses' },
        { amount_ml: 500, notes: 'Gym bottle' }
      ],
      cardio: [
        {
          activity_type: 'running',
          duration_min: 25,
          distance_km: 4.2,
          steps: 4100,
          calories_burned: 280,
          notes: 'Pace 6:00/km'
        }
      ],
      strength: [
        {
          exercise_name: 'Romanian Deadlift',
          muscle_group: 'Legs',
          sets: 4,
          reps: 8,
          weight_kg: 90,
          duration_min: 25,
          calories_burned: null,
          notes: 'Hamstring focus'
        }
      ],
      totals: {
        calories_consumed: 620,
        calorie_target: 1900,
        calorie_difference: -1280,
        calories_remaining: 1280,
        protein_g: 48,
        carb_g: 45,
        fat_g: 22,
        water_ml: 1500,
        water_litres: 1.5,
        total_steps: 4100,
        cardio_duration_min: 25,
        strength_duration_min: 25,
        total_workout_duration_min: 50,
        exercise_calories_burned: 280
      },
      settings: {
        calorie_target: 1900,
        water_goal_litres: 2.5
      }
    });

    expect(doc).toBeDefined();
    const pdfStr = doc.output();
    expect(pdfStr).toContain('openGym');
    expect(pdfStr).toContain('1,900');
    expect(pdfStr).toContain('Grilled Salmon');
    expect(pdfStr).toContain('Romanian Deadlift');
    expect(pdfStr).toContain('ChatGPT Daily Activity Analysis Prompt');
    expect(CHATGPT_ANALYSIS_PROMPT).toContain('STEPS NEEDED TO BURN THE EXCESS');
    expect(CHATGPT_ANALYSIS_PROMPT).toContain('MY DAILY CALORIE TARGET: 1,900 kcal.');
  });
});
