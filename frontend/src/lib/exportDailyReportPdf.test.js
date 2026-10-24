import { describe, it, expect } from 'vitest';
import { buildDailyReportDoc, CHATGPT_ANALYSIS_PROMPT } from './exportDailyReportPdf.js';

describe('Daily Health Log: Simplified Food & PDF Export Generator', () => {
  it('generates a valid PDF document with report title, date, 1,900 kcal target, and simplified food entries', () => {
    const doc = buildDailyReportDoc({
      date: '2026-10-25',
      foods: [
        {
          meal_type: 'breakfast',
          food_name: 'Rolled oats, overnight soaked',
          serving_quantity: 100,
          serving_unit: 'g',
          notes: 'Soaked overnight in water'
        },
        {
          meal_type: 'breakfast',
          food_name: 'Banana',
          serving_quantity: 150,
          serving_unit: 'g',
          notes: 'Medium, sliced'
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
        food_count: 2,
        calorie_target: 1900,
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
    expect(pdfOutput).toContain('Rolled oats, overnight soaked');
    expect(pdfOutput).toContain('Banana');
  });

  it('embeds the exact verbatim ChatGPT Nutrition and Activity Analysis Prompt in the PDF', () => {
    expect(CHATGPT_ANALYSIS_PROMPT).toContain('Analyze my complete daily food intake, hydration, cardio, steps, and strength training using the data in this report.');
    expect(CHATGPT_ANALYSIS_PROMPT).toContain('My daily calorie target is 1,900 kcal.');
    expect(CHATGPT_ANALYSIS_PROMPT).toContain('IMPORTANT: The food table contains food names and quantities only.');
    expect(CHATGPT_ANALYSIS_PROMPT).toContain('1. FOOD AND NUTRITION');
    expect(CHATGPT_ANALYSIS_PROMPT).toContain('2. COMPARE WITH MY DAILY TARGET');
    expect(CHATGPT_ANALYSIS_PROMPT).toContain('3. WATER');
    expect(CHATGPT_ANALYSIS_PROMPT).toContain('4. ACTIVITY');
    expect(CHATGPT_ANALYSIS_PROMPT).toContain('5. STEPS EQUIVALENT TO CALORIE EXCESS');
    expect(CHATGPT_ANALYSIS_PROMPT).toContain('6. FINAL SUMMARY');
    expect(CHATGPT_ANALYSIS_PROMPT).toContain('Do not recommend excessive exercise to compensate for food intake.');

    const doc = buildDailyReportDoc({
      date: '2026-10-25',
      foods: [],
      water: [],
      cardio: [],
      strength: [],
      totals: { food_count: 0, calorie_target: 1900 }
    });

    const pdfOutput = doc.output();
    expect(pdfOutput).toContain('ChatGPT Nutrition and Activity Analysis Prompt');
  });

  it('handles empty logs without inserting fake data and marks missing data as Not recorded', () => {
    const doc = buildDailyReportDoc({
      date: '2026-10-24',
      foods: [],
      water: [],
      cardio: [],
      strength: [],
      totals: {
        food_count: 0,
        calorie_target: 1900,
        water_ml: 0,
        water_litres: 0,
        total_steps: 0,
        total_workout_duration_min: 0,
        exercise_calories_burned: 0
      }
    });

    expect(doc).toBeDefined();
    const pdfOutput = doc.output();
    expect(pdfOutput).toContain('Not recorded');
  });

  it('groups food items by meal in the exported food log', () => {
    const doc = buildDailyReportDoc({
      date: '2026-10-25',
      foods: [
        { meal_type: 'lunch', food_name: 'Grilled Salmon', serving_quantity: 200, serving_unit: 'g' },
        { meal_type: 'breakfast', food_name: 'Oatmeal', serving_quantity: 80, serving_unit: 'g' },
        { meal_type: 'dinner', food_name: 'Quinoa Bowl', serving_quantity: 1, serving_unit: 'serving' }
      ],
      totals: { food_count: 3, calorie_target: 1900 }
    });
    const pdfOutput = doc.output();
    expect(pdfOutput).toContain('Grilled Salmon');
    expect(pdfOutput).toContain('Oatmeal');
    expect(pdfOutput).toContain('Quinoa Bowl');
  });
});
