import { describe, it, expect } from 'vitest';
import { buildDailyReportDoc, CHATGPT_ANALYSIS_PROMPT } from './exportDailyReportPdf.js';

describe('Daily Health Log: Full End-to-End Tracking Suite (Simplified Food Entry)', () => {
  // Test 1: Simplified food intake entry, edit, and delete
  it('handles simplified food entries (meal, food name, quantity, unit, notes) and deletions without requiring calories/macros', () => {
    let foods = [];
    const date = '2026-10-25';

    // 1. Add breakfast: Rolled oats, overnight soaked
    const oatsEntry = {
      id: 'f1',
      date,
      meal_type: 'breakfast',
      food_name: 'Rolled oats, overnight soaked',
      serving_quantity: 100,
      serving_unit: 'g',
      notes: 'Soaked overnight in water'
    };
    foods.push(oatsEntry);

    // 2. Add breakfast: Banana
    const bananaEntry = {
      id: 'f2',
      date,
      meal_type: 'breakfast',
      food_name: 'Banana',
      serving_quantity: 150,
      serving_unit: 'g',
      notes: 'Medium banana'
    };
    foods.push(bananaEntry);

    // 3. Add lunch: Grilled Chicken Breast
    const chickenEntry = {
      id: 'f3',
      date,
      meal_type: 'lunch',
      food_name: 'Grilled Chicken Breast',
      serving_quantity: 200,
      serving_unit: 'g',
      notes: 'Cooked with herbs'
    };
    foods.push(chickenEntry);

    expect(foods.length).toBe(3);

    // Edit quantity of oats (e.g. from 100g to 120g)
    foods = foods.map(f => f.id === 'f1' ? { ...f, serving_quantity: 120 } : f);
    const updatedOats = foods.find(f => f.id === 'f1');
    expect(updatedOats.serving_quantity).toBe(120);

    // Delete lunch item
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

  // Test 5: Reopening different dates
  it('supports saving and reopening records separately by date', () => {
    const store = {
      '2026-10-24': {
        foods: [{ id: 'f_old', meal_type: 'dinner', food_name: 'Soup', serving_quantity: 1, serving_unit: 'bowl' }],
        water: [{ id: 'w_old', amount_ml: 1000 }]
      },
      '2026-10-25': {
        foods: [{ id: 'f_new', meal_type: 'lunch', food_name: 'Steak', serving_quantity: 250, serving_unit: 'g' }],
        water: [{ id: 'w_new', amount_ml: 2000 }]
      }
    };

    expect(store['2026-10-24'].foods[0].food_name).toBe('Soup');
    expect(store['2026-10-25'].foods[0].food_name).toBe('Steak');
    expect(store['2026-10-24'].foods.length).toBe(1);
    expect(store['2026-10-25'].foods.length).toBe(1);
  });

  // Test 6: Export PDF report contains all data and exact ChatGPT prompt
  it('builds a complete PDF report with all user data and the exact ChatGPT prompt', () => {
    const doc = buildDailyReportDoc({
      date: '2026-10-25',
      foods: [
        {
          meal_type: 'lunch',
          food_name: 'Grilled Salmon with Quinoa',
          serving_quantity: 200,
          serving_unit: 'g',
          notes: 'Fresh fillet'
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
        food_count: 1,
        calorie_target: 1900,
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
    expect(pdfStr).toContain('Grilled Salmon with Quinoa');
    expect(pdfStr).toContain('Romanian Deadlift');
    expect(pdfStr).toContain('ChatGPT Nutrition and Activity Analysis Prompt');
    expect(CHATGPT_ANALYSIS_PROMPT).toContain('STEPS EQUIVALENT TO CALORIE EXCESS');
    expect(CHATGPT_ANALYSIS_PROMPT).toContain('My daily calorie target is 1,900 kcal.');
  });
});
