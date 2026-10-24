import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export const CHATGPT_ANALYSIS_PROMPT = `Act as my fitness and nutrition data analyst. Analyze the complete daily food intake, hydration, cardio, steps, and strength training recorded in the attached daily report.

MY DAILY CALORIE TARGET: 1,900 kcal.

Use the data in the report. Do not invent missing information. Clearly identify estimates and missing entries.

Please provide the following analysis:

1. FOOD INTAKE
- Calculate my total calories consumed today.
- Compare my intake with my 1,900 kcal daily target.
- Tell me whether I am below, exactly at, or above my target.
- If above, calculate the excess calories: total intake minus 1,900 kcal.
- If below, calculate the remaining calories to reach 1,900 kcal.
- Review my protein, carbohydrates, fat, and fibre if recorded.
- Identify foods that contributed most to my calorie intake.
- Identify any missing food quantities or nutrition information that could change the result.

2. WATER INTAKE
- Calculate my total water intake.
- Compare it with my recorded water goal, if provided.
- Explain whether my log appears complete. Do not make medical claims from water intake alone.

3. CARDIO, STEPS, AND STRENGTH TRAINING
- Summarize my recorded cardio and strength workouts.
- Calculate total recorded workout duration.
- Summarize my steps if they are available.
- Review my activity in relation to my fitness goal.
- Do not claim that exercise calories are exact.

4. STEPS NEEDED TO BURN THE EXCESS
- If my food intake is above 1,900 kcal, calculate the difference.
- Explain that exceeding my calorie target does not necessarily mean I have exceeded my maintenance calories.
- Estimate how many additional walking steps might expend energy equivalent to the excess, but only if sufficient personal information is available.
- Use my current body weight, walking pace, terrain, and a reasonable calorie-per-step estimate when available.
- State your assumptions and give a range rather than false precision.
- If my body weight or other necessary information is missing, ask me for it or clearly label the result as a rough illustration.
- Do not recommend excessive exercise or imply I must immediately burn off everything I ate.
- If my intake is at or below 1,900 kcal, explain that no steps are required simply to compensate for a calorie excess, though walking may still support general fitness.

5. FINAL DAILY REVIEW
- Give me a concise summary of today's nutrition, hydration, and exercise.
- Identify what went well.
- Suggest practical improvements for tomorrow.
- Explain any important limitations in the recorded data.
- Never fabricate nutrition values, exercise calories, steps, or personal details.

Present the results in a clear table where useful. Distinguish measured or user-entered values from estimates.`;

/**
 * Generates and returns a jsPDF instance with complete daily health data and ChatGPT prompt.
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
  const calorieTarget = 1900;
  const consumed = Number(totals.calories_consumed || 0);
  const diff = Math.round((consumed - calorieTarget) * 10) / 10;
  let statusText = '';
  let statusColor = primaryColor;

  if (diff < 0) {
    statusText = `${Math.abs(diff)} kcal remaining to reach 1,900 kcal target`;
    statusColor = [16, 185, 129]; // green
  } else if (diff === 0) {
    statusText = 'Daily calorie target of 1,900 kcal reached exactly';
    statusColor = [59, 130, 246]; // blue
  } else {
    statusText = `${diff} kcal above 1,900 kcal target (Tracking goal comparison; not maintenance/fat gain)`;
    statusColor = [217, 119, 6]; // amber
  }

  doc.setFillColor(241, 245, 249);
  doc.roundedRect(margin, currentY, contentWidth, 68, 4, 4, 'F');
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(margin, currentY, contentWidth, 68, 4, 4, 'S');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...darkTextColor);
  doc.text('Daily Nutrition & Activity Summary', margin + 12, currentY + 18);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...statusColor);
  doc.text(`Target Status: ${statusText}`, margin + 12, currentY + 34);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...darkTextColor);
  const macroSummary = `Calories: ${consumed} / 1,900 kcal  |  Protein: ${totals.protein_g || 0}g  |  Carbs: ${totals.carb_g || 0}g  |  Fat: ${totals.fat_g || 0}g`;
  doc.text(macroSummary, margin + 12, currentY + 48);

  const waterTotalL = totals.water_litres != null ? totals.water_litres : (Number(totals.water_ml || 0) / 1000).toFixed(2);
  const waterGoalL = settings.water_goal_litres || totals.water_goal_litres || 2.5;
  const workoutMin = totals.total_workout_duration_min || ((totals.cardio_duration_min || 0) + (totals.strength_duration_min || 0));
  const activitySummary = `Hydration: ${totals.water_ml || 0} ml (${waterTotalL} L / ${waterGoalL} L goal)  |  Workout Duration: ${workoutMin} min  |  Steps: ${totals.total_steps || 0}  |  Exercise Cal Burned: ${totals.exercise_calories_burned || 0} kcal`;
  doc.text(activitySummary, margin + 12, currentY + 60);

  currentY += 80;

  // --- Section 1: Food Intake Table ---
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...darkTextColor);
  doc.text('1. Food Intake Log', margin, currentY);
  currentY += 8;

  const foodRows = foods.map(f => [
    (f.meal_type || 'snacks').charAt(0).toUpperCase() + (f.meal_type || 'snacks').slice(1),
    f.food_name || '-',
    f.serving_quantity != null ? String(f.serving_quantity) : '1',
    f.serving_unit || 'g',
    f.energy_kcal != null ? `${Number(f.energy_kcal).toFixed(0)} kcal` : '0 kcal',
    f.protein_g != null ? `${Number(f.protein_g).toFixed(1)}g` : '0g',
    f.carb_g != null ? `${Number(f.carb_g).toFixed(1)}g` : '0g',
    f.fat_g != null ? `${Number(f.fat_g).toFixed(1)}g` : '0g',
    f.notes || f.assumptions || '-'
  ]);

  if (foodRows.length === 0) {
    foodRows.push(['No entries', 'No food entries recorded for this date.', '-', '-', '-', '-', '-', '-', '-']);
  }

  // Meal subtotals calculation for table summary row
  const subtotals = totals.subtotals || {
    breakfast: { calories: 0 },
    lunch: { calories: 0 },
    dinner: { calories: 0 },
    snacks: { calories: 0 }
  };

  const autoTableFn = autoTable.default || autoTable;

  autoTableFn(doc, {
    startY: currentY,
    margin: { left: margin, right: margin },
    head: [['Meal', 'Food Name', 'Qty', 'Unit', 'Calories', 'Protein', 'Carbs', 'Fat', 'Notes']],
    body: foodRows,
    theme: 'grid',
    headStyles: { fillColor: primaryColor, textColor: 255, fontSize: 8, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8, textColor: darkTextColor },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 55 },
      1: { cellWidth: 120 },
      2: { cellWidth: 30, halign: 'right' },
      3: { cellWidth: 35 },
      4: { cellWidth: 50, halign: 'right' },
      5: { cellWidth: 40, halign: 'right' },
      6: { cellWidth: 40, halign: 'right' },
      7: { cellWidth: 35, halign: 'right' },
      8: { cellWidth: 'auto' }
    },
    foot: [
      [
        'Total',
        `Breakfast: ${Math.round(subtotals.breakfast?.calories || 0)} | Lunch: ${Math.round(subtotals.lunch?.calories || 0)} | Dinner: ${Math.round(subtotals.dinner?.calories || 0)} | Snacks: ${Math.round(subtotals.snacks?.calories || 0)}`,
        '',
        '',
        `${consumed} kcal`,
        `${totals.protein_g || 0}g`,
        `${totals.carb_g || 0}g`,
        `${totals.fat_g || 0}g`,
        `Target: 1,900 kcal (${diff > 0 ? `+${diff}` : diff} kcal)`
      ]
    ],
    footStyles: { fillColor: [241, 245, 249], textColor: darkTextColor, fontStyle: 'bold', fontSize: 8 }
  });

  currentY = doc.lastAutoTable.finalY + 16;

  // --- Section 2: Water Intake Table ---
  if (currentY > pageHeight - 120) {
    doc.addPage();
    currentY = margin;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...darkTextColor);
  doc.text(`2. Water Intake (Goal: ${waterGoalL} L | Recorded: ${waterTotalL} L)`, margin, currentY);
  currentY += 8;

  const waterRows = water.map((w, idx) => [
    `Entry #${idx + 1}`,
    w.amount_ml != null ? `${w.amount_ml} ml` : '-',
    w.amount_ml != null ? `${(Number(w.amount_ml) / 1000).toFixed(2)} L` : '-',
    w.notes || '-'
  ]);

  if (waterRows.length === 0) {
    waterRows.push(['No entries', 'No water entries recorded for this date.', '-', '-']);
  }

  autoTableFn(doc, {
    startY: currentY,
    margin: { left: margin, right: margin },
    head: [['Entry', 'Amount (ml)', 'Amount (Litres)', 'Notes']],
    body: waterRows,
    theme: 'grid',
    headStyles: { fillColor: [14, 116, 144], textColor: 255, fontSize: 8, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8, textColor: darkTextColor },
    foot: [['Total', `${totals.water_ml || 0} ml`, `${waterTotalL} L`, `Goal: ${waterGoalL} L (${Math.round((waterTotalL / waterGoalL) * 100)}% met)`]],
    footStyles: { fillColor: [241, 245, 249], textColor: darkTextColor, fontStyle: 'bold', fontSize: 8 }
  });

  currentY = doc.lastAutoTable.finalY + 16;

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
    c.duration_min != null ? `${c.duration_min} min` : '-',
    c.distance_km != null ? `${c.distance_km} km` : '-',
    c.steps != null ? String(c.steps) : '-',
    c.calories_burned != null ? `${c.calories_burned} kcal` : '-',
    c.notes || '-'
  ]);

  if (cardioRows.length === 0) {
    cardioRows.push(['No entries', 'No cardio activity recorded for this date.', '-', '-', '-', '-']);
  }

  autoTableFn(doc, {
    startY: currentY,
    margin: { left: margin, right: margin },
    head: [['Activity Type', 'Duration', 'Distance', 'Steps', 'Est. Calories Burned', 'Notes']],
    body: cardioRows,
    theme: 'grid',
    headStyles: { fillColor: [180, 83, 9], textColor: 255, fontSize: 8, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8, textColor: darkTextColor },
    foot: [
      [
        'Total',
        `${totals.cardio_duration_min || 0} min`,
        totals.cardio_distance_km ? `${totals.cardio_distance_km} km` : '-',
        `${totals.total_steps || 0} steps`,
        cardio.reduce((acc, c) => acc + (Number(c.calories_burned) || 0), 0) ? `${cardio.reduce((acc, c) => acc + (Number(c.calories_burned) || 0), 0)} kcal` : '-',
        ''
      ]
    ],
    footStyles: { fillColor: [241, 245, 249], textColor: darkTextColor, fontStyle: 'bold', fontSize: 8 }
  });

  currentY = doc.lastAutoTable.finalY + 16;

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
    s.exercise_name || '-',
    s.muscle_group || '-',
    s.sets != null ? String(s.sets) : '-',
    s.reps != null ? String(s.reps) : '-',
    s.weight_kg != null ? `${s.weight_kg} kg` : '-',
    s.duration_min != null ? `${s.duration_min} min` : '-',
    s.calories_burned != null ? `${s.calories_burned} kcal` : '-',
    s.notes || '-'
  ]);

  if (strengthRows.length === 0) {
    strengthRows.push(['No entries', 'No strength workout recorded for this date.', '-', '-', '-', '-', '-', '-']);
  }

  autoTableFn(doc, {
    startY: currentY,
    margin: { left: margin, right: margin },
    head: [['Exercise Name', 'Muscle Group', 'Sets', 'Reps', 'Weight', 'Duration', 'Calories', 'Notes']],
    body: strengthRows,
    theme: 'grid',
    headStyles: { fillColor: [109, 40, 217], textColor: 255, fontSize: 8, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8, textColor: darkTextColor },
    foot: [
      [
        'Total',
        `${strength.length} exercise(s)`,
        strength.reduce((acc, s) => acc + (Number(s.sets) || 0), 0) ? `${strength.reduce((acc, s) => acc + (Number(s.sets) || 0), 0)} sets` : '-',
        '-',
        '-',
        totals.strength_duration_min ? `${totals.strength_duration_min} min` : '-',
        strength.reduce((acc, s) => acc + (Number(s.calories_burned) || 0), 0) ? `${strength.reduce((acc, s) => acc + (Number(s.calories_burned) || 0), 0)} kcal` : '-',
        ''
      ]
    ],
    footStyles: { fillColor: [241, 245, 249], textColor: darkTextColor, fontStyle: 'bold', fontSize: 8 }
  });

  currentY = doc.lastAutoTable.finalY + 20;

  // --- Dedicated Final Section: ChatGPT Daily Activity Analysis Prompt ---
  // Start on new page for clean presentation when uploaded or printed
  doc.addPage();
  currentY = margin;

  doc.setFillColor(30, 41, 59); // Slate dark
  doc.roundedRect(margin, currentY, contentWidth, 38, 4, 4, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(255, 255, 255);
  doc.text('ChatGPT Daily Activity Analysis Prompt', margin + 14, currentY + 24);

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
