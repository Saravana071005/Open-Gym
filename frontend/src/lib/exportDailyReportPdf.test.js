import { describe, it, expect } from 'vitest';
import { buildDailyReportDoc, CHATGPT_ANALYSIS_PROMPT } from './exportDailyReportPdf.js';

describe('Daily Health Log: PDF Export Generator', () => {
  it('generates a valid PDF document with report title, date, and 1,900 kcal target', () => {
    const doc = buildDailyReportDoc({
      date: '2026-10-25',
      foods: [
        {
          meal_type: 'breakfast',
          food_name: 'Rolled Oats with Almonds',
          serving_quantity: 1,
          serving_unit: 'serving',
          energy_kcal: 350,
          protein_g: 14,
          carb_g: 52,
          fat_g: 7,
          notes: 'Prepared with warm water'
        }
      ],
      water: [
        { amount_ml: 500, notes: 'Morning glass' }
      ],
      cardio: [
        {
          activity_type: 'walking',
          duration_min: 30,
          distance_km: 2.4,
          steps: 3200,
          calories_burned: 140,
          notes: 'Outdoor walk'
        }
      ],
      strength: [
        {
          exercise_name: 'Barbell Bench Press',
          muscle_group: 'Chest',
          sets: 4,
          reps: 8,
          weight_kg: 70,
          duration_min: 25,
          calories_burned: 110,
          notes: 'Felt solid'
        }
      ],
      totals: {
        calories_consumed: 350,
        calorie_target: 1900,
        calorie_difference: -1550,
        calories_remaining: 1550,
        protein_g: 14,
        carb_g: 52,
        fat_g: 7,
        water_ml: 500,
        water_litres: 0.5,
        total_steps: 3200,
        cardio_duration_min: 30,
        strength_duration_min: 25,
        total_workout_duration_min: 55,
        exercise_calories_burned: 250
      },
      settings: {
        calorie_target: 1900,
        water_goal_litres: 2.5
      }
    });

    expect(doc).toBeDefined();
    expect(doc.internal.getNumberOfPages()).toBeGreaterThanOrEqual(2);
    const pdfOutput = doc.output();
    expect(pdfOutput.length).toBeGreaterThan(1000);
    expect(pdfOutput).toContain('openGym');
    expect(pdfOutput).toContain('1,900');
  });

  it('embeds the exact verbatim ChatGPT analysis prompt in the exported document', () => {
    expect(CHATGPT_ANALYSIS_PROMPT).toContain('Act as my fitness and nutrition data analyst.');
    expect(CHATGPT_ANALYSIS_PROMPT).toContain('MY DAILY CALORIE TARGET: 1,900 kcal.');
    expect(CHATGPT_ANALYSIS_PROMPT).toContain('1. FOOD INTAKE');
    expect(CHATGPT_ANALYSIS_PROMPT).toContain('2. WATER INTAKE');
    expect(CHATGPT_ANALYSIS_PROMPT).toContain('3. CARDIO, STEPS, AND STRENGTH TRAINING');
    expect(CHATGPT_ANALYSIS_PROMPT).toContain('4. STEPS NEEDED TO BURN THE EXCESS');
    expect(CHATGPT_ANALYSIS_PROMPT).toContain('5. FINAL DAILY REVIEW');
    expect(CHATGPT_ANALYSIS_PROMPT).toContain('Do not recommend excessive exercise or imply I must immediately burn off everything I ate.');

    const doc = buildDailyReportDoc({
      date: '2026-10-25',
      foods: [],
      water: [],
      cardio: [],
      strength: [],
      totals: { calories_consumed: 0, calorie_target: 1900 }
    });

    const pdfOutput = doc.output();
    expect(pdfOutput).toContain('ChatGPT');
  });

  it('handles empty logs without inserting fake data or crashing', () => {
    const doc = buildDailyReportDoc({
      date: '2026-10-24',
      foods: [],
      water: [],
      cardio: [],
      strength: [],
      totals: {
        calories_consumed: 0,
        calorie_target: 1900,
        protein_g: 0,
        carb_g: 0,
        fat_g: 0,
        water_ml: 0,
        water_litres: 0,
        total_steps: 0,
        total_workout_duration_min: 0,
        exercise_calories_burned: 0
      }
    });

    expect(doc).toBeDefined();
    const pdfOutput = doc.output();
    expect(pdfOutput).toContain('No entries');
  });

  it('correctly reports calories remaining when below 1,900 kcal', () => {
    const doc = buildDailyReportDoc({
      date: '2026-10-25',
      foods: [{ meal_type: 'lunch', food_name: 'Rice & Chicken', energy_kcal: 1400 }],
      totals: { calories_consumed: 1400, calorie_target: 1900 }
    });
    const pdfOutput = doc.output();
    expect(pdfOutput).toContain('500 kcal remaining');
  });

  it('correctly reports calories above target when exceeding 1,900 kcal without claiming body fat gain', () => {
    const doc = buildDailyReportDoc({
      date: '2026-10-25',
      foods: [{ meal_type: 'dinner', food_name: 'Feast', energy_kcal: 2250 }],
      totals: { calories_consumed: 2250, calorie_target: 1900 }
    });
    const pdfOutput = doc.output();
    expect(pdfOutput).toContain('350 kcal above');
    expect(pdfOutput).toContain('not maintenance/fat gain');
  });
});
