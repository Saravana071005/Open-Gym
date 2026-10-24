import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export const CHATGPT_ANALYSIS_PROMPT = `Analyze my complete daily food intake, hydration, cardio, steps, and strength training using the data in this report.

My daily calorie target is 1,900 kcal.

IMPORTANT: The food table contains food names and quantities only. You must estimate nutrition using reliable nutrition references and reasonable serving assumptions. Clearly distinguish estimates from verified values. Do not claim that the website calculated or verified these values.

1. FOOD AND NUTRITION
- Analyze each food separately using its recorded quantity and unit.
- Estimate calories, protein, carbohydrates, fat, and fibre for every food where sufficient information is available.
- Calculate totals for breakfast, lunch, dinner, snacks, and the entire day.
- Consider the preparation method and distinguish dry, cooked, and soaked weights.
- Identify ambiguous foods or missing preparation details and explain how they affect accuracy.
- Do not invent unrecorded ingredients such as cooking oil, sugar, milk, or sauces.
- Present the food-by-food estimates and daily totals in tables.

2. COMPARE WITH MY DAILY TARGET
- Compare estimated total calories with 1,900 kcal.
- If intake exceeds the target, calculate the difference.
- If intake is below the target, calculate how many calories remain to reach it.
- Explain that exceeding 1,900 kcal does not necessarily mean exceeding my maintenance calories or gaining body fat.

3. WATER
- Calculate my recorded water intake and compare it with my stated water goal.
- Identify missing information without inventing water consumption.

4. ACTIVITY
- Summarize recorded cardio, strength workouts, and steps.
- Estimate exercise energy expenditure only where sufficient information is available.
- Avoid double-counting activities or steps that overlap with recorded cardio.
- Clearly state assumptions and uncertainty.

5. STEPS EQUIVALENT TO CALORIE EXCESS
- If estimated food intake exceeds 1,900 kcal, calculate the estimated excess.
- Explain that this is excess relative to my target, not necessarily a calorie surplus relative to maintenance.
- If appropriate, estimate a range of walking steps corresponding to that energy amount using my recorded body weight, if available, and reasonable walking assumptions.
- If necessary information is missing, ask for it or provide a clearly labelled rough estimate.
- Do not recommend excessive exercise to compensate for food intake.

6. FINAL SUMMARY
- Provide a clear daily nutrition and activity summary.
- Explain what went well and what could be improved tomorrow.
- Identify missing or ambiguous data.
- Never present AI-generated estimates as exact measurements.
- Do not invent personal information, food ingredients, water intake, steps, or workouts.`;

/**
 * Generates and returns a jsPDF instance with complete daily health data and ChatGPT prompt.
 * Food table contains food names, quantities, and units grouped by meal (no calories/macros).
 * @param {Object} data - Contains date, foods, water, cardio, strength, totals, settings
 * @returns {jsPDF}
 */
export function buildDailyReportDoc(data) {
  const {
    date = new Date().toISOString().slice(0, 10),
    foods = [],
    water = [],
    cardio = [],
    strength = [],
    totals = {},
    settings = {}
  } = data;

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4'
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  const contentWidth = pageWidth - margin * 2;

  const primaryColor = [22, 101, 52]; // Dark green / emerald
  const darkTextColor = [30, 41, 59];
  const mutedTextColor = [100, 116, 139];

  let currentY = margin;

  // Header banner
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(margin, currentY, contentWidth, 54, 4, 4, 'F');
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(margin, currentY, contentWidth, 54, 4, 4, 'S');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(...primaryColor);
  doc.text('openGym — Daily Health & Activity Report', margin + 14, currentY + 24);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...mutedTextColor);
  doc.text(`Date: ${date}  |  Daily Calorie Target: 1,900 kcal  |  Exported: ${new Date().toLocaleTimeString()}`, margin + 14, currentY + 42);

  currentY += 66;

  // Daily Summary Card
  doc.setFillColor(241, 245, 249);
  doc.roundedRect(margin, currentY, contentWidth, 68, 4, 4, 'F');
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(margin, currentY, contentWidth, 68, 4, 4, 'S');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...darkTextColor);
  doc.text('Daily Activity & Tracking Summary', margin + 12, currentY + 18);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...darkTextColor);

  const realFoods = foods.filter(f => !f.is_example);
  const foodCountText = `Food Entries Recorded: ${realFoods.length}  |  Daily Calorie Target: 1,900 kcal (Nutrition analysis via ChatGPT prompt below)`;
  doc.text(foodCountText, margin + 12, currentY + 34);

  const waterTotalL = totals.water_litres != null ? totals.water_litres : (Number(totals.water_ml || 0) / 1000).toFixed(2);
  const waterGoalL = settings.water_goal_litres || totals.water_goal_litres || 2.5;
  const hydrationText = water.length > 0
    ? `Hydration: ${totals.water_ml || 0} ml (${waterTotalL} L / ${waterGoalL} L goal)`
    : `Hydration: Not recorded (Goal: ${waterGoalL} L)`;

  const workoutMin = totals.total_workout_duration_min || ((totals.cardio_duration_min || 0) + (totals.strength_duration_min || 0));
  const stepsText = totals.total_steps ? `${totals.total_steps.toLocaleString()} steps` : 'Steps: Not recorded';
  const exCalText = totals.exercise_calories_burned > 0 ? `${totals.exercise_calories_burned} kcal (user estimate)` : 'Calories: Not recorded';

  const activitySummary = `${hydrationText}  |  Workout Duration: ${workoutMin > 0 ? `${workoutMin} min` : 'Not recorded'}  |  ${stepsText}  |  ${exCalText}`;
  doc.text(activitySummary, margin + 12, currentY + 52);

  currentY += 80;

  // --- Section 1: Food Log Table (Grouped by Meal) ---
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...darkTextColor);
  doc.text('1. Food Log (Grouped by Meal)', margin, currentY);
  currentY += 6;

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8.5);
  doc.setTextColor(...mutedTextColor);
  doc.text('Exact food descriptions and quantities entered by user. Nutrition values are estimated in the ChatGPT section below.', margin, currentY + 8);
  currentY += 16;

  // Group foods by meal: Breakfast, Lunch, Dinner, Snacks
  const mealOrder = ['breakfast', 'lunch', 'dinner', 'snacks'];
  const groupedFoods = [];

  for (const mId of mealOrder) {
    const mealItems = realFoods.filter(f => String(f.meal_type || 'snacks').toLowerCase() === mId);
    for (const item of mealItems) {
      groupedFoods.push(item);
    }
  }

  // Any other meals that might not be in standard order
  for (const item of realFoods) {
    const mId = String(item.meal_type || 'snacks').toLowerCase();
    if (!mealOrder.includes(mId)) {
      groupedFoods.push(item);
    }
  }

  const foodRows = groupedFoods.map(f => [
    (f.meal_type || 'snacks').charAt(0).toUpperCase() + (f.meal_type || 'snacks').slice(1),
    f.food_name || 'Not recorded',
    f.serving_quantity != null ? String(f.serving_quantity) : '1',
    f.serving_unit || 'g',
    f.notes || f.assumptions || 'Not recorded'
  ]);

  if (foodRows.length === 0) {
    foodRows.push(['Not recorded', 'No food entries recorded for this date.', '-', '-', '-']);
  }

  const autoTableFn = autoTable.default || autoTable;

  autoTableFn(doc, {
    startY: currentY,
    margin: { left: margin, right: margin },
    head: [['Meal', 'Food Name', 'Quantity', 'Unit', 'Notes']],
    body: foodRows,
    theme: 'grid',
    headStyles: { fillColor: primaryColor, textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8.5, textColor: darkTextColor },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 70 },
      1: { cellWidth: 200 },
      2: { cellWidth: 50, halign: 'right' },
      3: { cellWidth: 50 },
      4: { cellWidth: 'auto' }
    },
    foot: [
      [
        'Total',
        `${realFoods.length} food item(s) recorded across ${new Set(realFoods.map(f => f.meal_type)).size} meal(s)`,
        '',
        '',
        'Daily Calorie Target: 1,900 kcal'
      ]
    ],
    footStyles: { fillColor: [241, 245, 249], textColor: darkTextColor, fontStyle: 'bold', fontSize: 8.5 }
  });

  currentY = doc.lastAutoTable.finalY + 18;

  // --- Section 2: Water Intake Table ---
  if (currentY > pageHeight - 120) {
    doc.addPage();
    currentY = margin;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...darkTextColor);
  doc.text(`2. Water Intake (Goal: ${waterGoalL} L | Recorded: ${water.length > 0 ? `${waterTotalL} L` : 'Not recorded'})`, margin, currentY);
  currentY += 8;

  const waterRows = water.map((w, idx) => [
    `Entry #${idx + 1}`,
    w.amount_ml != null ? `${w.amount_ml} ml` : 'Not recorded',
    w.amount_ml != null ? `${(Number(w.amount_ml) / 1000).toFixed(2)} L` : 'Not recorded',
    w.notes || 'Not recorded'
  ]);

  if (waterRows.length === 0) {
    waterRows.push(['Not recorded', 'No water entries recorded for this date.', 'Not recorded', 'Not recorded']);
  }

  autoTableFn(doc, {
    startY: currentY,
    margin: { left: margin, right: margin },
    head: [['Entry', 'Amount (ml)', 'Amount (Litres)', 'Notes']],
    body: waterRows,
    theme: 'grid',
    headStyles: { fillColor: [14, 116, 144], textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8.5, textColor: darkTextColor },
    foot: [
      [
        'Total',
        water.length > 0 ? `${totals.water_ml || 0} ml` : 'Not recorded',
        water.length > 0 ? `${waterTotalL} L` : 'Not recorded',
        `Goal: ${waterGoalL} L (${water.length > 0 ? Math.round((waterTotalL / waterGoalL) * 100) : 0}% met)`
      ]
    ],
    footStyles: { fillColor: [241, 245, 249], textColor: darkTextColor, fontStyle: 'bold', fontSize: 8.5 }
  });

  currentY = doc.lastAutoTable.finalY + 18;

  // --- Section 3: Cardio Activity Log ---
  if (currentY > pageHeight - 120) {
    doc.addPage();
    currentY = margin;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...darkTextColor);
  doc.text('3. Cardio Activity Log', margin, currentY);
  currentY += 8;

  const cardioRows = cardio.map(c => [
    (c.activity_type || 'Cardio').charAt(0).toUpperCase() + (c.activity_type || 'Cardio').slice(1),
    c.duration_min != null ? `${c.duration_min} min` : 'Not recorded',
    c.distance_km != null ? `${c.distance_km} km` : 'Not recorded',
    c.steps != null ? c.steps.toLocaleString() : 'Not recorded',
    c.calories_burned != null ? `${c.calories_burned} kcal (user estimate)` : 'Not recorded',
    c.notes || 'Not recorded'
  ]);

  if (cardioRows.length === 0) {
    cardioRows.push(['Not recorded', 'No cardio activity recorded for this date.', 'Not recorded', 'Not recorded', 'Not recorded', 'Not recorded']);
  }

  autoTableFn(doc, {
    startY: currentY,
    margin: { left: margin, right: margin },
    head: [['Activity Type', 'Duration', 'Distance', 'Steps', 'Est. Calories Burned', 'Notes']],
    body: cardioRows,
    theme: 'grid',
    headStyles: { fillColor: [180, 83, 9], textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8.5, textColor: darkTextColor },
    foot: [
      [
        'Total',
        totals.cardio_duration_min > 0 ? `${totals.cardio_duration_min} min` : 'Not recorded',
        totals.cardio_distance_km ? `${totals.cardio_distance_km} km` : 'Not recorded',
        totals.total_steps ? `${totals.total_steps.toLocaleString()} steps` : 'Not recorded',
        cardio.reduce((acc, c) => acc + (Number(c.calories_burned) || 0), 0) ? `${cardio.reduce((acc, c) => acc + (Number(c.calories_burned) || 0), 0)} kcal` : 'Not recorded',
        ''
      ]
    ],
    footStyles: { fillColor: [241, 245, 249], textColor: darkTextColor, fontStyle: 'bold', fontSize: 8.5 }
  });

  currentY = doc.lastAutoTable.finalY + 18;

  // --- Section 4: Strength Workout Log ---
  if (currentY > pageHeight - 120) {
    doc.addPage();
    currentY = margin;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...darkTextColor);
  doc.text('4. Strength Workout Log', margin, currentY);
  currentY += 8;

  const strengthRows = strength.map(s => [
    s.exercise_name || 'Not recorded',
    s.muscle_group || 'Not recorded',
    s.sets != null ? String(s.sets) : 'Not recorded',
    s.reps != null ? String(s.reps) : 'Not recorded',
    s.weight_kg != null ? `${s.weight_kg} kg` : 'Not recorded',
    s.duration_min != null ? `${s.duration_min} min` : 'Not recorded',
    s.calories_burned != null ? `${s.calories_burned} kcal (user estimate)` : 'Not recorded',
    s.notes || 'Not recorded'
  ]);

  if (strengthRows.length === 0) {
    strengthRows.push(['Not recorded', 'No strength workout recorded for this date.', 'Not recorded', 'Not recorded', 'Not recorded', 'Not recorded', 'Not recorded', 'Not recorded']);
  }

  autoTableFn(doc, {
    startY: currentY,
    margin: { left: margin, right: margin },
    head: [['Exercise Name', 'Muscle Group', 'Sets', 'Reps', 'Weight', 'Duration', 'Calories', 'Notes']],
    body: strengthRows,
    theme: 'grid',
    headStyles: { fillColor: [109, 40, 217], textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8.5, textColor: darkTextColor },
    foot: [
      [
        'Total',
        `${strength.length} exercise(s)`,
        strength.reduce((acc, s) => acc + (Number(s.sets) || 0), 0) ? `${strength.reduce((acc, s) => acc + (Number(s.sets) || 0), 0)} sets` : 'Not recorded',
        'Not recorded',
        'Not recorded',
        totals.strength_duration_min ? `${totals.strength_duration_min} min` : 'Not recorded',
        strength.reduce((acc, s) => acc + (Number(s.calories_burned) || 0), 0) ? `${strength.reduce((acc, s) => acc + (Number(s.calories_burned) || 0), 0)} kcal` : 'Not recorded',
        ''
      ]
    ],
    footStyles: { fillColor: [241, 245, 249], textColor: darkTextColor, fontStyle: 'bold', fontSize: 8.5 }
  });

  currentY = doc.lastAutoTable.finalY + 20;

  // --- Dedicated Final Section: ChatGPT Nutrition and Activity Analysis Prompt ---
  doc.addPage();
  currentY = margin;

  doc.setFillColor(30, 41, 59); // Slate dark
  doc.roundedRect(margin, currentY, contentWidth, 38, 4, 4, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(255, 255, 255);
  doc.text('ChatGPT Nutrition and Activity Analysis Prompt', margin + 14, currentY + 24);

  currentY += 48;

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(9);
  doc.setTextColor(...mutedTextColor);
  doc.text('Upload this PDF to ChatGPT or copy the complete prompt below to receive an automated expert analysis of today\'s recorded data:', margin, currentY);
  currentY += 16;

  // Bordered prompt box
  const promptLines = doc.splitTextToSize(CHATGPT_ANALYSIS_PROMPT, contentWidth - 20);
  const promptHeight = promptLines.length * 11 + 20;

  doc.setFillColor(248, 250, 252);
  doc.roundedRect(margin, currentY, contentWidth, Math.min(promptHeight, pageHeight - currentY - margin), 4, 4, 'F');
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(margin, currentY, contentWidth, Math.min(promptHeight, pageHeight - currentY - margin), 4, 4, 'S');

  doc.setFont('courier', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...darkTextColor);

  let textY = currentY + 14;
  for (let i = 0; i < promptLines.length; i++) {
    if (textY > pageHeight - margin - 20) {
      doc.addPage();
      textY = margin + 14;
    }
    doc.text(promptLines[i], margin + 10, textY);
    textY += 11;
  }

  // Add Page Numbers to all pages
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...mutedTextColor);
    doc.text(
      `openGym Daily Health Log | Date: ${date} | Page ${i} of ${totalPages}`,
      pageWidth / 2,
      pageHeight - 16,
      { align: 'center' }
    );
  }

  return doc;
}

/**
 * Convenience helper to generate and trigger browser download of the PDF.
 */
export function exportDailyReportPdf(data) {
  const doc = buildDailyReportDoc(data);
  const date = data?.date || new Date().toISOString().slice(0, 10);
  doc.save(`openGym_daily_report_${date}.pdf`);
  return doc;
}
