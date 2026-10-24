import { useState, useEffect, useMemo } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { todayISO, fmtDate } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { exportDailyReportPdf } from '../lib/exportDailyReportPdf.js'

const MEAL_TYPES = [
  { id: 'breakfast', label: 'Breakfast', icon: 'sun', color: 'var(--orange)' },
  { id: 'lunch', label: 'Lunch', icon: 'sun', color: 'var(--yellow)' },
  { id: 'dinner', label: 'Dinner', icon: 'moon', color: 'var(--indigo)' },
  { id: 'snacks', label: 'Snacks', icon: 'apple', color: 'var(--green)' }
]

const UNITS = ['g', 'kg', 'ml', 'L', 'piece', 'cup', 'serving']

const CARDIO_TYPES = ['walking', 'running', 'cycling', 'treadmill', 'HIIT', 'other']

const MUSCLE_GROUPS = ['Chest', 'Back', 'Legs', 'Shoulders', 'Arms', 'Core', 'Full Body', 'Other']

// Example entries clearly marked, NOT included in user totals
const EXAMPLE_ENTRIES = [
  {
    id: 'example-1',
    is_example: true,
    meal_type: 'breakfast',
    food_name: 'Rolled Oats with Almonds & Banana',
    serving_quantity: 1,
    serving_unit: 'serving',
    energy_kcal: 380,
    protein_g: 14,
    carb_g: 58,
    fat_g: 9,
    notes: 'Reference example: not counted in your daily totals'
  },
  {
    id: 'example-2',
    is_example: true,
    meal_type: 'lunch',
    food_name: 'Grilled Chicken Salad with Olive Oil',
    serving_quantity: 1,
    serving_unit: 'serving',
    energy_kcal: 460,
    protein_g: 42,
    carb_g: 12,
    fat_g: 18,
    notes: 'Reference example: not counted in your daily totals'
  }
]

export default function Nutrition() {
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const { openSheet, toast, confirmSheet } = useUI()

  const [date, setDate] = useState(todayISO())
  const [loading, setLoading] = useState(false)
  const [showExamples, setShowExamples] = useState(false)

  // Daily records
  const [foods, setFoods] = useState([])
  const [water, setWater] = useState([])
  const [cardio, setCardio] = useState([])
  const [strength, setStrength] = useState([])

  // Settings
  const [calorieTarget, setCalorieTarget] = useState(1900)
  const [waterGoalL, setWaterGoalL] = useState(2.5)
  const [editingWaterGoal, setEditingWaterGoal] = useState(false)
  const [waterGoalDraft, setWaterGoalDraft] = useState('2.5')

  // Quick water custom input
  const [customWaterAmount, setCustomWaterAmount] = useState('')
  const [customWaterUnit, setCustomWaterUnit] = useState('ml')
  const [customWaterNote, setCustomWaterNote] = useState('')

  // Load daily health data whenever date or user changes
  useEffect(() => {
    loadDayData(date)
  }, [date, user])

  const loadDayData = async (d) => {
    setLoading(true)
    if (user) {
      try {
        const res = await api(`/api/nutrition/health-log?date=${d}`)
        if (res.ok) {
          setFoods(res.foods || [])
          setWater(res.water || [])
          setCardio(res.cardio || [])
          setStrength(res.strength || [])
          if (res.settings) {
            setCalorieTarget(res.settings.calorie_target != null ? res.settings.calorie_target : 1900)
            if (res.settings.water_goal_litres != null) {
              setWaterGoalL(res.settings.water_goal_litres)
              setWaterGoalDraft(String(res.settings.water_goal_litres))
            }
          }
        }
      } catch (e) {
        loadFromLocalStorage(d)
      }
    } else {
      loadFromLocalStorage(d)
    }
    setLoading(false)
  }

  const loadFromLocalStorage = (d) => {
    try {
      const stored = localStorage.getItem(`opengym_health_${d}`)
      if (stored) {
        const parsed = JSON.parse(stored)
        setFoods(parsed.foods || [])
        setWater(parsed.water || [])
        setCardio(parsed.cardio || [])
        setStrength(parsed.strength || [])
      } else {
        // Fallback to legacy meals if any match date
        const dayMeals = (S.meals || []).filter(m => m.date === d || m.d === d).map(m => ({
          id: m.id,
          meal_type: m.type || m.meal_type || 'lunch',
          food_name: m.name || m.food_name || 'Food entry',
          serving_quantity: m.qty || m.serving_quantity || 1,
          serving_unit: m.unit || m.serving_unit || 'g',
          energy_kcal: m.nutrients?.calories ?? m.energy_kcal ?? 0,
          protein_g: m.nutrients?.protein ?? m.protein_g ?? 0,
          carb_g: m.nutrients?.carbs ?? m.carb_g ?? 0,
          fat_g: m.nutrients?.fat ?? m.fat_g ?? 0,
          notes: m.notes || null
        }))
        setFoods(dayMeals)
        setWater([])
        setCardio([])
        setStrength([])
      }

      const savedSettings = localStorage.getItem('opengym_health_settings')
      if (savedSettings) {
        const s = JSON.parse(savedSettings)
        if (s.water_goal_litres != null) {
          setWaterGoalL(s.water_goal_litres)
          setWaterGoalDraft(String(s.water_goal_litres))
        }
      }
    } catch (e) {
      setFoods([])
      setWater([])
      setCardio([])
      setStrength([])
    }
  }

  const saveToLocalStorage = (d, newFoods, newWater, newCardio, newStrength) => {
    try {
      localStorage.setItem(`opengym_health_${d}`, JSON.stringify({
        foods: newFoods,
        water: newWater,
        cardio: newCardio,
        strength: newStrength
      }))
    } catch (e) {}
  }

  // Save water goal setting
  const handleSaveWaterGoal = async (val) => {
    const num = Math.max(0.5, Math.min(10, parseFloat(val) || 2.5))
    setWaterGoalL(num)
    setWaterGoalDraft(String(num))
    setEditingWaterGoal(false)

    try {
      localStorage.setItem('opengym_health_settings', JSON.stringify({ water_goal_litres: num, calorie_target: 1900 }))
    } catch (e) {}

    if (user) {
      try {
        await api('/api/nutrition/health-settings', {
          method: 'POST',
          body: JSON.stringify({ water_goal_litres: num, calorie_target: 1900 })
        })
      } catch (e) {}
    }
    toast(t('Water goal updated to {0} L', num))
  }

  // --- Calculations for Daily Summary ---
  const totals = useMemo(() => {
    const foodTotals = {
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0
    }

    const subtotals = {
      breakfast: { calories: 0, protein: 0, carbs: 0, fat: 0 },
      lunch: { calories: 0, protein: 0, carbs: 0, fat: 0 },
      dinner: { calories: 0, protein: 0, carbs: 0, fat: 0 },
      snacks: { calories: 0, protein: 0, carbs: 0, fat: 0 }
    }

    // Only count real user entries (never example entries!)
    for (const f of foods) {
      if (f.is_example) continue
      const cal = Number(f.energy_kcal) || 0
      const p = Number(f.protein_g) || 0
      const c = Number(f.carb_g) || 0
      const fat = Number(f.fat_g) || 0

      foodTotals.calories += cal
      foodTotals.protein += p
      foodTotals.carbs += c
      foodTotals.fat += fat

      const mType = String(f.meal_type || 'snacks').toLowerCase()
      if (subtotals[mType]) {
        subtotals[mType].calories += cal
        subtotals[mType].protein += p
        subtotals[mType].carbs += c
        subtotals[mType].fat += fat
      }
    }

    const waterTotalMl = water.reduce((acc, w) => acc + (Number(w.amount_ml) || 0), 0)
    const waterLitres = Math.round((waterTotalMl / 1000) * 100) / 100

    let cardioDurationMin = 0
    let cardioSteps = 0
    let cardioDistanceKm = 0
    let cardioCaloriesBurned = 0

    for (const c of cardio) {
      cardioDurationMin += Number(c.duration_min) || 0
      cardioSteps += Number(c.steps) || 0
      cardioDistanceKm += Number(c.distance_km) || 0
      cardioCaloriesBurned += Number(c.calories_burned) || 0
    }

    let strengthDurationMin = 0
    let strengthCaloriesBurned = 0

    for (const s of strength) {
      strengthDurationMin += Number(s.duration_min) || 0
      strengthCaloriesBurned += Number(s.calories_burned) || 0
    }

    const totalWorkoutDurationMin = cardioDurationMin + strengthDurationMin
    const totalExerciseCaloriesBurned = cardioCaloriesBurned + strengthCaloriesBurned

    const target = 1900
    const consumed = Math.round(foodTotals.calories * 10) / 10
    const diff = Math.round((consumed - target) * 10) / 10

    return {
      calories_consumed: consumed,
      calorie_target: target,
      calorie_difference: diff,
      is_below_target: diff < 0,
      is_exact_target: diff === 0,
      is_above_target: diff > 0,
      calories_remaining: diff < 0 ? Math.abs(diff) : 0,
      calories_above: diff > 0 ? diff : 0,
      protein_g: Math.round(foodTotals.protein * 10) / 10,
      carb_g: Math.round(foodTotals.carbs * 10) / 10,
      fat_g: Math.round(foodTotals.fat * 10) / 10,
      subtotals,
      water_ml: waterTotalMl,
      water_litres: waterLitres,
      water_goal_litres: waterGoalL,
      cardio_duration_min: cardioDurationMin,
      cardio_distance_km: Math.round(cardioDistanceKm * 10) / 10,
      strength_duration_min: strengthDurationMin,
      total_workout_duration_min: totalWorkoutDurationMin,
      total_steps: cardioSteps,
      exercise_calories_burned: totalExerciseCaloriesBurned
    }
  }, [foods, water, cardio, strength, waterGoalL])

  // --- Date navigation ---
  const changeDate = (days) => {
    const cur = new Date(date + 'T00:00:00')
    cur.setDate(cur.getDate() + days)
    setDate(cur.toISOString().slice(0, 10))
  }

  // --- Food Operations ---
  const handleOpenFoodModal = (existing = null) => {
    openSheet(close => (
      <FoodFormModal
        date={date}
        existing={existing}
        onSave={async (savedEntry) => {
          close()
          let updatedFoods
          if (existing) {
            updatedFoods = foods.map(f => f.id === savedEntry.id ? savedEntry : f)
          } else {
            updatedFoods = [...foods, savedEntry]
          }
          setFoods(updatedFoods)
          saveToLocalStorage(date, updatedFoods, water, cardio, strength)

          if (user) {
            try {
              await api('/api/nutrition/food/save', {
                method: 'POST',
                body: JSON.stringify({ ...savedEntry, date })
              })
            } catch (e) {
              toast(t('Saved locally'))
            }
          }
          toast(existing ? t('Food entry updated') : t('Food entry added'))
        }}
      />
    ))
  }

  const handleDeleteFood = (food) => {
    if (food.is_example) {
      toast(t('Example entries cannot be deleted; toggle "Show Examples" to hide them.'))
      return
    }
    confirmSheet(t('Delete {0}?', food.food_name), async () => {
      const updatedFoods = foods.filter(f => f.id !== food.id)
      setFoods(updatedFoods)
      saveToLocalStorage(date, updatedFoods, water, cardio, strength)

      if (user) {
        try {
          await api('/api/nutrition/food/delete', {
            method: 'POST',
            body: JSON.stringify({ id: food.id })
          })
        } catch (e) {}
      }
      toast(t('Food entry deleted'))
    })
  }

  // --- Water Operations ---
  const handleAddWater = async (amountMl, note = '') => {
    if (!amountMl || amountMl <= 0) return
    const id = 'w_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)
    const newEntry = {
      id,
      date,
      amount_ml: Math.round(amountMl),
      unit: 'ml',
      notes: note || null,
      created_at: new Date().toISOString()
    }

    const updatedWater = [...water, newEntry]
    setWater(updatedWater)
    saveToLocalStorage(date, foods, updatedWater, cardio, strength)

    if (user) {
      try {
        await api('/api/nutrition/water/save', {
          method: 'POST',
          body: JSON.stringify(newEntry)
        })
      } catch (e) {}
    }
    setCustomWaterAmount('')
    setCustomWaterNote('')
    toast(t('Added {0} ml water', Math.round(amountMl)))
  }

  const handleDeleteWater = (id) => {
    confirmSheet(t('Delete this water entry?'), async () => {
      const updatedWater = water.filter(w => w.id !== id)
      setWater(updatedWater)
      saveToLocalStorage(date, foods, updatedWater, cardio, strength)

      if (user) {
        try {
          await api('/api/nutrition/water/delete', {
            method: 'POST',
            body: JSON.stringify({ id })
          })
        } catch (e) {}
      }
      toast(t('Water entry removed'))
    })
  }

  // --- Cardio Operations ---
  const handleOpenCardioModal = (existing = null) => {
    openSheet(close => (
      <CardioFormModal
        date={date}
        existing={existing}
        onSave={async (savedEntry) => {
          close()
          let updatedCardio
          if (existing) {
            updatedCardio = cardio.map(c => c.id === savedEntry.id ? savedEntry : c)
          } else {
            updatedCardio = [...cardio, savedEntry]
          }
          setCardio(updatedCardio)
          saveToLocalStorage(date, foods, water, updatedCardio, strength)

          if (user) {
            try {
              await api('/api/nutrition/cardio/save', {
                method: 'POST',
                body: JSON.stringify({ ...savedEntry, date })
              })
            } catch (e) {}
          }
          toast(existing ? t('Cardio session updated') : t('Cardio session recorded'))
        }}
      />
    ))
  }

  const handleDeleteCardio = (session) => {
    confirmSheet(t('Delete {0} cardio session?', session.activity_type), async () => {
      const updatedCardio = cardio.filter(c => c.id !== session.id)
      setCardio(updatedCardio)
      saveToLocalStorage(date, foods, water, updatedCardio, strength)

      if (user) {
        try {
          await api('/api/nutrition/cardio/delete', {
            method: 'POST',
            body: JSON.stringify({ id: session.id })
          })
        } catch (e) {}
      }
      toast(t('Cardio session deleted'))
    })
  }

  // --- Strength Operations ---
  const handleOpenStrengthModal = (existing = null) => {
    openSheet(close => (
      <StrengthFormModal
        date={date}
        existing={existing}
        onSave={async (savedEntry) => {
          close()
          let updatedStrength
          if (existing) {
            updatedStrength = strength.map(s => s.id === savedEntry.id ? savedEntry : s)
          } else {
            updatedStrength = [...strength, savedEntry]
          }
          setStrength(updatedStrength)
          saveToLocalStorage(date, foods, water, cardio, updatedStrength)

          if (user) {
            try {
              await api('/api/nutrition/strength/save', {
                method: 'POST',
                body: JSON.stringify({ ...savedEntry, date })
              })
            } catch (e) {}
          }
          toast(existing ? t('Exercise updated') : t('Exercise recorded'))
        }}
      />
    ))
  }

  const handleDeleteStrength = (exercise) => {
    confirmSheet(t('Delete {0} exercise entry?', exercise.exercise_name), async () => {
      const updatedStrength = strength.filter(s => s.id !== exercise.id)
      setStrength(updatedStrength)
      saveToLocalStorage(date, foods, water, cardio, updatedStrength)

      if (user) {
        try {
          await api('/api/nutrition/strength/delete', {
            method: 'POST',
            body: JSON.stringify({ id: exercise.id })
          })
        } catch (e) {}
      }
      toast(t('Strength exercise deleted'))
    })
  }

  // --- Export PDF ---
  const handleExportPdf = () => {
    try {
      const realFoods = foods.filter(f => !f.is_example)
      exportDailyReportPdf({
        date,
        foods: realFoods,
        water,
        cardio,
        strength,
        totals,
        settings: {
          calorie_target: 1900,
          water_goal_litres: waterGoalL
        }
      })
      toast(t('Daily Report PDF exported successfully'))
    } catch (e) {
      toast(t('Failed to export PDF: {0}', e.message))
    }
  }

  const displayFoods = showExamples ? [...EXAMPLE_ENTRIES, ...foods] : foods

  return (
    <div className="narrow" style={{ maxWidth: 960, margin: '0 auto', padding: '16px 12px 64px' }}>
      {/* Page Title & Top Actions */}
      <div className="hdr" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '1.75rem', fontWeight: 700, margin: 0 }}>
            <span style={{ color: 'var(--acc)' }}><Icon name="clipboard" /></span>
            {t('Daily Health Log')}
          </h1>
          <div className="sub" style={{ fontSize: '0.88rem', color: 'var(--muted)', marginTop: 4 }}>
            {t('Daily food and activity tracking with 1,900 kcal target and ChatGPT report export')}
          </div>
        </div>

        {/* Prominent Export Daily Report PDF Button */}
        <Button
          variant="acc"
          icon="download"
          onClick={handleExportPdf}
          style={{ fontWeight: 600, padding: '10px 18px', fontSize: '0.95rem', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}
        >
          {t('Export Daily Report PDF')}
        </Button>
      </div>

      {/* Date Selector Strip */}
      <div className="card" style={{ padding: '12px 16px', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              className="iconbtn"
              onClick={() => changeDate(-1)}
              aria-label="Previous day"
              style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--surface-2)' }}
            >
              <Icon name="chevronLeft" />
            </button>
            <input
              type="date"
              value={date}
              onChange={e => e.target.value && setDate(e.target.value)}
              style={{
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '6px 12px',
                fontSize: '1rem',
                fontWeight: 600,
                color: 'var(--fg)'
              }}
            />
            <button
              className="iconbtn"
              onClick={() => changeDate(1)}
              aria-label="Next day"
              style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--surface-2)' }}
            >
              <Icon name="chevronRight" />
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {date !== todayISO() && (
              <button
                className="btn small"
                onClick={() => setDate(todayISO())}
                style={{ padding: '4px 10px', fontSize: '0.85rem' }}
              >
                {t('Today')}
              </button>
            )}
            <button
              className={`btn small ${showExamples ? 'acc' : ''}`}
              onClick={() => setShowExamples(!showExamples)}
              style={{ padding: '4px 10px', fontSize: '0.85rem' }}
              title={t('Toggle illustrative example entries (never counted in totals)')}
            >
              <Icon name="lightbulb" />
              <span style={{ marginLeft: 4 }}>{showExamples ? t('Hide Examples') : t('Show Examples')}</span>
            </button>
          </div>
        </div>
      </div>

      {/* SECTION E: Daily Summary Card */}
      <div className="card" style={{ marginBottom: 24, border: '1px solid var(--border)', background: 'var(--surface)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--acc)', fontSize: '1.2rem' }}><Icon name="flame" /></span>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>{t('Daily Summary')}</h2>
          </div>
          <span className="small muted" style={{ fontWeight: 500 }}>
            {t('Daily Target')}: <strong style={{ color: 'var(--fg)' }}>1,900 kcal</strong>
          </span>
        </div>

        {/* Calorie Intake vs 1,900 kcal Target Meter */}
        <div style={{ background: 'var(--surface-2)', borderRadius: 12, padding: '16px', marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <div style={{ fontSize: '0.85rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
                {t('Calories Consumed')}
              </div>
              <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--fg)', lineHeight: 1.1 }}>
                {totals.calories_consumed} <span style={{ fontSize: '1rem', fontWeight: 500, color: 'var(--muted)' }}>/ 1,900 kcal</span>
              </div>
            </div>

            {/* Target Status Logic */}
            <div style={{ textAlign: 'right' }}>
              {totals.is_below_target && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'color-mix(in srgb,var(--green) 16%,transparent)', color: 'var(--green)', padding: '6px 12px', borderRadius: 20, fontWeight: 700, fontSize: '0.92rem' }}>
                  <Icon name="check" />
                  <span>{totals.calories_remaining} kcal {t('remaining to reach 1,900 target')}</span>
                </div>
              )}
              {totals.is_exact_target && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'color-mix(in srgb,var(--blue) 16%,transparent)', color: 'var(--blue)', padding: '6px 12px', borderRadius: 20, fontWeight: 700, fontSize: '0.92rem' }}>
                  <Icon name="checkCircle" />
                  <span>{t('1,900 kcal target reached exactly')}</span>
                </div>
              )}
              {totals.is_above_target && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'color-mix(in srgb,var(--orange) 16%,transparent)', color: 'var(--orange)', padding: '6px 12px', borderRadius: 20, fontWeight: 700, fontSize: '0.92rem' }}>
                  <Icon name="info" />
                  <span>{totals.calories_above} kcal {t('above 1,900 kcal target')}</span>
                </div>
              )}
            </div>
          </div>

          {/* Progress Bar */}
          <div style={{ height: 8, borderRadius: 4, background: 'var(--surface-3)', marginTop: 12, overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${Math.min(100, Math.round((totals.calories_consumed / 1900) * 100))}%`,
                background: totals.is_above_target ? 'var(--orange)' : 'var(--acc)',
                borderRadius: 4,
                transition: 'width 0.3s ease'
              }}
            />
          </div>

          {/* Non-judgmental explanation */}
          <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: 10, lineHeight: 1.4 }}>
            {t('Tracking note: The 1,900 kcal target is a personal tracking goal, not necessarily maintenance requirement. Exceeding 1,900 kcal does not automatically indicate body-fat gain.')}
          </div>
        </div>

        {/* Macro Breakdown Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 16 }}>
          <div style={{ background: 'var(--surface-2)', padding: '10px 12px', borderRadius: 10 }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--muted)', fontWeight: 600 }}>{t('Protein')}</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--fg)', marginTop: 2 }}>{totals.protein_g}g</div>
          </div>
          <div style={{ background: 'var(--surface-2)', padding: '10px 12px', borderRadius: 10 }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--muted)', fontWeight: 600 }}>{t('Carbohydrates')}</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--fg)', marginTop: 2 }}>{totals.carb_g}g</div>
          </div>
          <div style={{ background: 'var(--surface-2)', padding: '10px 12px', borderRadius: 10 }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--muted)', fontWeight: 600 }}>{t('Fat')}</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--fg)', marginTop: 2 }}>{totals.fat_g}g</div>
          </div>
          <div style={{ background: 'var(--surface-2)', padding: '10px 12px', borderRadius: 10 }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--muted)', fontWeight: 600 }}>{t('Water Consumed')}</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--blue)', marginTop: 2 }}>{totals.water_litres} L</div>
          </div>
        </div>

        {/* Activity & Workout Stats Strip */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, paddingTop: 12, borderTop: '1px solid var(--border)', fontSize: '0.88rem', color: 'var(--muted)' }}>
          <span>{t('Cardio Duration')}: <strong style={{ color: 'var(--fg)' }}>{totals.cardio_duration_min} min</strong></span>
          <span>•</span>
          <span>{t('Total Workout Duration')}: <strong style={{ color: 'var(--fg)' }}>{totals.total_workout_duration_min} min</strong></span>
          <span>•</span>
          <span>{t('Total Steps')}: <strong style={{ color: 'var(--fg)' }}>{totals.total_steps ? totals.total_steps.toLocaleString() : 0}</strong></span>
          {totals.exercise_calories_burned > 0 && (
            <>
              <span>•</span>
              <span>{t('Exercise Calories (est)')}: <strong style={{ color: 'var(--fg)' }}>{totals.exercise_calories_burned} kcal</strong></span>
            </>
          )}
        </div>
      </div>

      {/* SECTION A: Food Intake Table */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--green)', fontSize: '1.2rem' }}><Icon name="apple" /></span>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>{t('Food Intake')}</h2>
          </div>
          <Button
            variant="acc"
            icon="plus"
            size="small"
            onClick={() => handleOpenFoodModal()}
            style={{ fontWeight: 600 }}
          >
            {t('Add Food')}
          </Button>
        </div>

        {/* Meal Subtotals Ribbon */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 16 }}>
          {MEAL_TYPES.map(m => {
            const sub = totals.subtotals[m.id] || { calories: 0, protein: 0, carbs: 0, fat: 0 }
            return (
              <div key={m.id} style={{ background: 'var(--surface-2)', padding: '8px 10px', borderRadius: 8, borderLeft: `3px solid ${m.color}` }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--fg)' }}>{t(m.label)}</div>
                <div style={{ fontSize: '1rem', fontWeight: 700, color: m.color, marginTop: 2 }}>{Math.round(sub.calories)} kcal</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: 2 }}>
                  P: {Math.round(sub.protein)}g | C: {Math.round(sub.carbs)}g | F: {Math.round(sub.fat)}g
                </div>
              </div>
            )
          })}
        </div>

        {/* Food Table */}
        {displayFoods.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--muted)', background: 'var(--surface-2)', borderRadius: 10 }}>
            <Icon name="nutrition" style={{ fontSize: '2rem', marginBottom: 8, display: 'inline-block' }} />
            <div style={{ fontWeight: 600 }}>{t('No food entries recorded for this date')}</div>
            <div style={{ fontSize: '0.85rem', marginTop: 4 }}>{t('Click "Add Food" to manually record food, quantities, and macronutrients.')}</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border)', color: 'var(--muted)', fontSize: '0.8rem', textTransform: 'uppercase' }}>
                  <th style={{ padding: '8px 10px' }}>{t('Meal')}</th>
                  <th style={{ padding: '8px 10px' }}>{t('Food Name')}</th>
                  <th style={{ padding: '8px 10px' }}>{t('Quantity')}</th>
                  <th style={{ padding: '8px 10px' }}>{t('Calories')}</th>
                  <th style={{ padding: '8px 10px' }}>{t('Protein')}</th>
                  <th style={{ padding: '8px 10px' }}>{t('Carbs')}</th>
                  <th style={{ padding: '8px 10px' }}>{t('Fat')}</th>
                  <th style={{ padding: '8px 10px' }}>{t('Notes')}</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>{t('Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {displayFoods.map(f => (
                  <tr
                    key={f.id}
                    style={{
                      borderBottom: '1px solid var(--border)',
                      background: f.is_example ? 'color-mix(in srgb,var(--surface-2) 60%,transparent)' : 'transparent'
                    }}
                  >
                    <td style={{ padding: '10px', verticalAlign: 'middle' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '3px 8px',
                          borderRadius: 6,
                          fontSize: '0.78rem',
                          fontWeight: 600,
                          background: 'var(--surface-2)',
                          textTransform: 'capitalize'
                        }}
                      >
                        {f.meal_type}
                      </span>
                    </td>
                    <td style={{ padding: '10px', fontWeight: 600, verticalAlign: 'middle' }}>
                      {f.food_name}
                      {f.is_example && (
                        <span style={{ marginLeft: 6, fontSize: '0.72rem', background: 'var(--surface-3)', color: 'var(--muted)', padding: '2px 6px', borderRadius: 4 }}>
                          {t('Example - Not Counted')}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '10px', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>
                      {f.serving_quantity} {f.serving_unit}
                    </td>
                    <td style={{ padding: '10px', fontWeight: 700, verticalAlign: 'middle' }}>
                      {f.energy_kcal} kcal
                    </td>
                    <td style={{ padding: '10px', verticalAlign: 'middle' }}>{f.protein_g}g</td>
                    <td style={{ padding: '10px', verticalAlign: 'middle' }}>{f.carb_g}g</td>
                    <td style={{ padding: '10px', verticalAlign: 'middle' }}>{f.fat_g}g</td>
                    <td style={{ padding: '10px', color: 'var(--muted)', fontSize: '0.85rem', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                      {f.notes || '-'}
                    </td>
                    <td style={{ padding: '10px', textAlign: 'right', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>
                      {!f.is_example && (
                        <>
                          <button
                            className="iconbtn"
                            onClick={() => handleOpenFoodModal(f)}
                            style={{ width: 28, height: 28, marginRight: 4 }}
                            aria-label="Edit food entry"
                          >
                            <Icon name="pencil" />
                          </button>
                          <button
                            className="iconbtn danger"
                            onClick={() => handleDeleteFood(f)}
                            style={{ width: 28, height: 28 }}
                            aria-label="Delete food entry"
                          >
                            <Icon name="trash" />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--surface-2)', fontWeight: 700 }}>
                  <td colSpan={3} style={{ padding: '10px' }}>{t('Total Real Intake')}</td>
                  <td style={{ padding: '10px', color: 'var(--acc)' }}>{totals.calories_consumed} kcal</td>
                  <td style={{ padding: '10px' }}>{totals.protein_g}g</td>
                  <td style={{ padding: '10px' }}>{totals.carb_g}g</td>
                  <td style={{ padding: '10px' }}>{totals.fat_g}g</td>
                  <td colSpan={2} style={{ padding: '10px', fontSize: '0.82rem', color: 'var(--muted)' }}>
                    {totals.is_below_target ? `${totals.calories_remaining} kcal to target` : `${totals.calories_above} kcal above`}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* SECTION B: Water Intake Tracker */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--blue)', fontSize: '1.2rem' }}><Icon name="cup" /></span>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>{t('Water Intake')}</h2>
          </div>

          {/* Daily Water Goal Setting */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {editingWaterGoal ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="number"
                  step="0.1"
                  min="0.5"
                  max="10"
                  value={waterGoalDraft}
                  onChange={e => setWaterGoalDraft(e.target.value)}
                  style={{ width: 64, padding: '4px 6px', borderRadius: 6, border: '1px solid var(--border)' }}
                />
                <span style={{ fontSize: '0.85rem' }}>L</span>
                <button className="btn small acc" onClick={() => handleSaveWaterGoal(waterGoalDraft)}>
                  <Icon name="check" />
                </button>
                <button className="btn small" onClick={() => setEditingWaterGoal(false)}>
                  <Icon name="xmark" />
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.88rem' }}>
                <span className="muted">{t('Daily Goal')}:</span>
                <strong style={{ color: 'var(--fg)' }}>{waterGoalL} L</strong>
                <button
                  className="iconbtn"
                  onClick={() => setEditingWaterGoal(true)}
                  style={{ width: 24, height: 24 }}
                  aria-label="Edit water goal"
                >
                  <Icon name="pencil" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Hydration Status Bar */}
        <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '14px', marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <div>
              <span style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--blue)' }}>{totals.water_litres} L</span>
              <span style={{ fontSize: '0.9rem', color: 'var(--muted)', marginLeft: 6 }}>({totals.water_ml} ml)</span>
            </div>
            <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>
              {totals.water_litres >= waterGoalL ? (
                <span style={{ color: 'var(--green)' }}>✓ {t('Daily goal reached!')}</span>
              ) : (
                <span style={{ color: 'var(--muted)' }}>
                  {Math.round((waterGoalL - totals.water_litres) * 100) / 100} L {t('remaining')}
                </span>
              )}
            </div>
          </div>

          <div style={{ height: 8, borderRadius: 4, background: 'var(--surface-3)', overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${Math.min(100, Math.round((totals.water_litres / waterGoalL) * 100))}%`,
                background: 'var(--blue)',
                borderRadius: 4,
                transition: 'width 0.3s ease'
              }}
            />
          </div>
        </div>

        {/* Quick Add Buttons & Custom Amount */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          <button className="btn small" onClick={() => handleAddWater(250, 'Glass of water')}>
            + 250 ml
          </button>
          <button className="btn small" onClick={() => handleAddWater(500, 'Bottle of water')}>
            + 500 ml
          </button>
          <button className="btn small" onClick={() => handleAddWater(750, 'Large bottle')}>
            + 750 ml
          </button>
          <button className="btn small" onClick={() => handleAddWater(1000, '1 Litre jug')}>
            + 1,000 ml (1 L)
          </button>
        </div>

        {/* Custom Water Input */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 16 }}>
          <input
            type="number"
            min="1"
            placeholder={t('Amount')}
            value={customWaterAmount}
            onChange={e => setCustomWaterAmount(e.target.value)}
            style={{ width: 100, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)' }}
          />
          <select
            value={customWaterUnit}
            onChange={e => setCustomWaterUnit(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)' }}
          >
            <option value="ml">ml</option>
            <option value="L">L</option>
          </select>
          <input
            type="text"
            placeholder={t('Optional notes (e.g. morning glass, post-workout)')}
            value={customWaterNote}
            onChange={e => setCustomWaterNote(e.target.value)}
            style={{ flex: 1, minWidth: 160, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)' }}
          />
          <Button
            variant="acc"
            size="small"
            onClick={() => {
              const amt = customWaterUnit === 'L' ? parseFloat(customWaterAmount) * 1000 : parseFloat(customWaterAmount)
              handleAddWater(amt, customWaterNote)
            }}
          >
            {t('Add Water')}
          </Button>
        </div>

        {/* Water Log Entries List */}
        {water.length > 0 && (
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--muted)', fontWeight: 600, marginBottom: 8 }}>
              {t("Today's Water Entries")} ({water.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {water.map((w, idx) => (
                <div
                  key={w.id || idx}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 12px',
                    borderRadius: 8,
                    background: 'var(--surface-2)',
                    fontSize: '0.88rem'
                  }}
                >
                  <div>
                    <strong>{w.amount_ml} ml</strong> <span style={{ color: 'var(--muted)' }}>({(w.amount_ml / 1000).toFixed(2)} L)</span>
                    {w.notes && <span style={{ marginLeft: 8, color: 'var(--muted)', fontSize: '0.82rem' }}>— {w.notes}</span>}
                  </div>
                  <button
                    className="iconbtn danger"
                    onClick={() => handleDeleteWater(w.id)}
                    style={{ width: 26, height: 26 }}
                    aria-label="Delete water entry"
                  >
                    <Icon name="trash" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* SECTION C: Cardio Activity Log */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--orange)', fontSize: '1.2rem' }}><Icon name="figureRun" /></span>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>{t('Cardio Activity Log')}</h2>
          </div>
          <Button
            variant="acc"
            icon="plus"
            size="small"
            onClick={() => handleOpenCardioModal()}
            style={{ fontWeight: 600 }}
          >
            {t('Add Cardio Session')}
          </Button>
        </div>

        {cardio.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px 16px', color: 'var(--muted)', background: 'var(--surface-2)', borderRadius: 10 }}>
            <div style={{ fontWeight: 600 }}>{t('No cardio sessions recorded today')}</div>
            <div style={{ fontSize: '0.85rem', marginTop: 4 }}>{t('Record walking, running, cycling, treadmill, or HIIT sessions.')}</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border)', color: 'var(--muted)', fontSize: '0.8rem', textTransform: 'uppercase' }}>
                  <th style={{ padding: '8px 10px' }}>{t('Activity')}</th>
                  <th style={{ padding: '8px 10px' }}>{t('Duration')}</th>
                  <th style={{ padding: '8px 10px' }}>{t('Distance')}</th>
                  <th style={{ padding: '8px 10px' }}>{t('Steps')}</th>
                  <th style={{ padding: '8px 10px' }}>{t('Calories Burned (est)')}</th>
                  <th style={{ padding: '8px 10px' }}>{t('Notes')}</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>{t('Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {cardio.map(c => (
                  <tr key={c.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px', fontWeight: 600, textTransform: 'capitalize' }}>{c.activity_type}</td>
                    <td style={{ padding: '10px' }}>{c.duration_min} min</td>
                    <td style={{ padding: '10px' }}>{c.distance_km != null ? `${c.distance_km} km` : '-'}</td>
                    <td style={{ padding: '10px' }}>{c.steps != null ? c.steps.toLocaleString() : '-'}</td>
                    <td style={{ padding: '10px', color: 'var(--orange)', fontWeight: 600 }}>{c.calories_burned != null ? `${c.calories_burned} kcal` : '-'}</td>
                    <td style={{ padding: '10px', color: 'var(--muted)', fontSize: '0.85rem' }}>{c.notes || '-'}</td>
                    <td style={{ padding: '10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        className="iconbtn"
                        onClick={() => handleOpenCardioModal(c)}
                        style={{ width: 28, height: 28, marginRight: 4 }}
                        aria-label="Edit cardio session"
                      >
                        <Icon name="pencil" />
                      </button>
                      <button
                        className="iconbtn danger"
                        onClick={() => handleDeleteCardio(c)}
                        style={{ width: 28, height: 28 }}
                        aria-label="Delete cardio session"
                      >
                        <Icon name="trash" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--surface-2)', fontWeight: 700 }}>
                  <td style={{ padding: '10px' }}>{t('Total Cardio')}</td>
                  <td style={{ padding: '10px' }}>{totals.cardio_duration_min} min</td>
                  <td style={{ padding: '10px' }}>{totals.cardio_distance_km ? `${totals.cardio_distance_km} km` : '-'}</td>
                  <td style={{ padding: '10px' }}>{totals.total_steps ? totals.total_steps.toLocaleString() : '-'}</td>
                  <td style={{ padding: '10px', color: 'var(--orange)' }}>
                    {cardio.reduce((acc, c) => acc + (Number(c.calories_burned) || 0), 0) ? `${cardio.reduce((acc, c) => acc + (Number(c.calories_burned) || 0), 0)} kcal` : '-'}
                  </td>
                  <td colSpan={2} style={{ padding: '10px' }} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* SECTION D: Strength Workout Log */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--purple)', fontSize: '1.2rem' }}><Icon name="dumbbell" /></span>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>{t('Strength Workout Log')}</h2>
          </div>
          <Button
            variant="acc"
            icon="plus"
            size="small"
            onClick={() => handleOpenStrengthModal()}
            style={{ fontWeight: 600 }}
          >
            {t('Add Exercise')}
          </Button>
        </div>

        {strength.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px 16px', color: 'var(--muted)', background: 'var(--surface-2)', borderRadius: 10 }}>
            <div style={{ fontWeight: 600 }}>{t('No strength exercises recorded today')}</div>
            <div style={{ fontSize: '0.85rem', marginTop: 4 }}>{t('Log exercises, muscle groups, sets, repetitions, and weights.')}</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border)', color: 'var(--muted)', fontSize: '0.8rem', textTransform: 'uppercase' }}>
                  <th style={{ padding: '8px 10px' }}>{t('Exercise Name')}</th>
                  <th style={{ padding: '8px 10px' }}>{t('Muscle Group')}</th>
                  <th style={{ padding: '8px 10px' }}>{t('Sets')}</th>
                  <th style={{ padding: '8px 10px' }}>{t('Reps')}</th>
                  <th style={{ padding: '8px 10px' }}>{t('Weight (kg)')}</th>
                  <th style={{ padding: '8px 10px' }}>{t('Duration')}</th>
                  <th style={{ padding: '8px 10px' }}>{t('Calories (est)')}</th>
                  <th style={{ padding: '8px 10px' }}>{t('Notes')}</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>{t('Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {strength.map(s => (
                  <tr key={s.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px', fontWeight: 600 }}>{s.exercise_name}</td>
                    <td style={{ padding: '10px' }}>
                      {s.muscle_group ? (
                        <span style={{ background: 'var(--surface-2)', padding: '2px 8px', borderRadius: 4, fontSize: '0.8rem' }}>
                          {s.muscle_group}
                        </span>
                      ) : '-'}
                    </td>
                    <td style={{ padding: '10px' }}>{s.sets != null ? s.sets : '-'}</td>
                    <td style={{ padding: '10px' }}>{s.reps != null ? s.reps : '-'}</td>
                    <td style={{ padding: '10px' }}>{s.weight_kg != null ? `${s.weight_kg} kg` : '-'}</td>
                    <td style={{ padding: '10px' }}>{s.duration_min != null ? `${s.duration_min} min` : '-'}</td>
                    <td style={{ padding: '10px', color: 'var(--purple)', fontWeight: 600 }}>
                      {s.calories_burned != null ? `${s.calories_burned} kcal` : '-'}
                    </td>
                    <td style={{ padding: '10px', color: 'var(--muted)', fontSize: '0.85rem' }}>{s.notes || '-'}</td>
                    <td style={{ padding: '10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        className="iconbtn"
                        onClick={() => handleOpenStrengthModal(s)}
                        style={{ width: 28, height: 28, marginRight: 4 }}
                        aria-label="Edit strength exercise"
                      >
                        <Icon name="pencil" />
                      </button>
                      <button
                        className="iconbtn danger"
                        onClick={() => handleDeleteStrength(s)}
                        style={{ width: 28, height: 28 }}
                        aria-label="Delete strength exercise"
                      >
                        <Icon name="trash" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--surface-2)', fontWeight: 700 }}>
                  <td style={{ padding: '10px' }}>{t('Total Strength')}</td>
                  <td style={{ padding: '10px' }}>{strength.length} {t('exercises')}</td>
                  <td style={{ padding: '10px' }}>
                    {strength.reduce((acc, s) => acc + (Number(s.sets) || 0), 0) ? `${strength.reduce((acc, s) => acc + (Number(s.sets) || 0), 0)} sets` : '-'}
                  </td>
                  <td colSpan={2} style={{ padding: '10px' }} />
                  <td style={{ padding: '10px' }}>{totals.strength_duration_min ? `${totals.strength_duration_min} min` : '-'}</td>
                  <td style={{ padding: '10px', color: 'var(--purple)' }}>
                    {strength.reduce((acc, s) => acc + (Number(s.calories_burned) || 0), 0) ? `${strength.reduce((acc, s) => acc + (Number(s.calories_burned) || 0), 0)} kcal` : '-'}
                  </td>
                  <td colSpan={2} style={{ padding: '10px' }} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

/* ============================ MODALS ============================ */

function FoodFormModal({ date, existing, onSave }) {
  const [mealType, setMealType] = useState(existing?.meal_type || 'lunch')
  const [foodName, setFoodName] = useState(existing?.food_name || '')
  const [quantity, setQuantity] = useState(existing?.serving_quantity != null ? String(existing.serving_quantity) : '1')
  const [unit, setUnit] = useState(existing?.serving_unit || 'g')
  const [calories, setCalories] = useState(existing?.energy_kcal != null ? String(existing.energy_kcal) : '')
  const [protein, setProtein] = useState(existing?.protein_g != null ? String(existing.protein_g) : '')
  const [carbs, setCarbs] = useState(existing?.carb_g != null ? String(existing.carb_g) : '')
  const [fat, setFat] = useState(existing?.fat_g != null ? String(existing.fat_g) : '')
  const [notes, setNotes] = useState(existing?.notes || '')
  const [err, setErr] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!foodName.trim()) {
      setErr('Please enter food name')
      return
    }
    if (calories === '' || isNaN(parseFloat(calories))) {
      setErr('Please enter food calories (manual entry)')
      return
    }

    const entry = {
      id: existing?.id || 'food_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      date,
      meal_type: mealType,
      food_name: foodName.trim(),
      serving_quantity: Math.max(0.1, parseFloat(quantity) || 1),
      serving_unit: unit,
      energy_kcal: Math.max(0, parseFloat(calories) || 0),
      protein_g: Math.max(0, parseFloat(protein) || 0),
      carb_g: Math.max(0, parseFloat(carbs) || 0),
      fat_g: Math.max(0, parseFloat(fat) || 0),
      notes: notes.trim() || null
    }

    onSave(entry)
  }

  return (
    <form onSubmit={handleSubmit} style={{ padding: '4px 0 16px' }}>
      <h3 style={{ margin: '0 0 14px', fontSize: '1.2rem', fontWeight: 700 }}>
        {existing ? t('Edit Food Entry') : t('Add Food Entry')}
      </h3>

      {err && (
        <div style={{ color: 'var(--red)', fontSize: '0.85rem', marginBottom: 12, padding: '6px 10px', background: 'color-mix(in srgb,var(--red) 12%,transparent)', borderRadius: 6 }}>
          {err}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 12 }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>
            {t('Meal')}
          </label>
          <select
            value={mealType}
            onChange={e => setMealType(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)' }}
          >
            {MEAL_TYPES.map(m => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>
            {t('Food Name *')}
          </label>
          <input
            type="text"
            required
            placeholder="e.g. Scrambled Eggs, Brown Rice"
            value={foodName}
            onChange={e => setFoodName(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)' }}
          />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>
            {t('Quantity')}
          </label>
          <input
            type="number"
            step="any"
            min="0.1"
            value={quantity}
            onChange={e => setQuantity(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>
            {t('Unit')}
          </label>
          <select
            value={unit}
            onChange={e => setUnit(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)' }}
          >
            {UNITS.map(u => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14 }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>
            {t('Calories (kcal) *')}
          </label>
          <input
            type="number"
            step="any"
            min="0"
            required
            placeholder="0"
            value={calories}
            onChange={e => setCalories(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', fontWeight: 700 }}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>
            {t('Protein (g)')}
          </label>
          <input
            type="number"
            step="any"
            min="0"
            placeholder="0"
            value={protein}
            onChange={e => setProtein(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)' }}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>
            {t('Carbs (g)')}
          </label>
          <input
            type="number"
            step="any"
            min="0"
            placeholder="0"
            value={carbs}
            onChange={e => setCarbs(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)' }}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>
            {t('Fat (g)')}
          </label>
          <input
            type="number"
            step="any"
            min="0"
            placeholder="0"
            value={fat}
            onChange={e => setFat(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)' }}
          />
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>
          {t('Notes (optional)')}
        </label>
        <input
          type="text"
          placeholder="e.g. homemade, with 1 tsp oil, cooked"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)' }}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <Button variant="acc" type="submit" style={{ padding: '10px 20px', fontWeight: 600 }}>
          {t('Save Food Entry')}
        </Button>
      </div>
    </form>
  )
}

function CardioFormModal({ date, existing, onSave }) {
  const [activityType, setActivityType] = useState(existing?.activity_type || 'walking')
  const [durationMin, setDurationMin] = useState(existing?.duration_min != null ? String(existing.duration_min) : '')
  const [distanceKm, setDistanceKm] = useState(existing?.distance_km != null ? String(existing.distance_km) : '')
  const [steps, setSteps] = useState(existing?.steps != null ? String(existing.steps) : '')
  const [caloriesBurned, setCaloriesBurned] = useState(existing?.calories_burned != null ? String(existing.calories_burned) : '')
  const [notes, setNotes] = useState(existing?.notes || '')
  const [err, setErr] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!durationMin || isNaN(parseFloat(durationMin))) {
      setErr('Please enter duration in minutes')
      return
    }

    const entry = {
      id: existing?.id || 'cardio_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      date,
      activity_type: activityType,
      duration_min: Math.max(1, parseFloat(durationMin) || 0),
      distance_km: distanceKm !== '' ? Math.max(0, parseFloat(distanceKm)) : null,
      steps: steps !== '' ? Math.max(0, parseInt(steps, 10)) : null,
      calories_burned: caloriesBurned !== '' ? Math.max(0, parseFloat(caloriesBurned)) : null,
      notes: notes.trim() || null
    }

    onSave(entry)
  }

  return (
    <form onSubmit={handleSubmit} style={{ padding: '4px 0 16px' }}>
      <h3 style={{ margin: '0 0 14px', fontSize: '1.2rem', fontWeight: 700 }}>
        {existing ? t('Edit Cardio Session') : t('Add Cardio Session')}
      </h3>

      {err && (
        <div style={{ color: 'var(--red)', fontSize: '0.85rem', marginBottom: 12, padding: '6px 10px', background: 'color-mix(in srgb,var(--red) 12%,transparent)', borderRadius: 6 }}>
          {err}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>
            {t('Activity Type *')}
          </label>
          <select
            value={activityType}
            onChange={e => setActivityType(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)' }}
          >
            {CARDIO_TYPES.map(act => (
              <option key={act} value={act}>{act.charAt(0).toUpperCase() + act.slice(1)}</option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>
            {t('Duration (minutes) *')}
          </label>
          <input
            type="number"
            min="1"
            required
            placeholder="e.g. 30"
            value={durationMin}
            onChange={e => setDurationMin(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)' }}
          />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 12 }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>
            {t('Distance (km)')}
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder="optional"
            value={distanceKm}
            onChange={e => setDistanceKm(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>
            {t('Steps')}
          </label>
          <input
            type="number"
            min="0"
            placeholder="optional"
            value={steps}
            onChange={e => setSteps(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>
            {t('Est. Calories Burned')}
          </label>
          <input
            type="number"
            min="0"
            placeholder="optional"
            value={caloriesBurned}
            onChange={e => setCaloriesBurned(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)' }}
          />
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>
          {t('Notes (optional)')}
        </label>
        <input
          type="text"
          placeholder="e.g. brisk walk in park, incline 3"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)' }}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <Button variant="acc" type="submit" style={{ padding: '10px 20px', fontWeight: 600 }}>
          {t('Save Cardio Session')}
        </Button>
      </div>
    </form>
  )
}

function StrengthFormModal({ date, existing, onSave }) {
  const [exerciseName, setExerciseName] = useState(existing?.exercise_name || '')
  const [muscleGroup, setMuscleGroup] = useState(existing?.muscle_group || 'Chest')
  const [sets, setSets] = useState(existing?.sets != null ? String(existing.sets) : '')
  const [reps, setReps] = useState(existing?.reps != null ? String(existing.reps) : '')
  const [weightKg, setWeightKg] = useState(existing?.weight_kg != null ? String(existing.weight_kg) : '')
  const [durationMin, setDurationMin] = useState(existing?.duration_min != null ? String(existing.duration_min) : '')
  const [caloriesBurned, setCaloriesBurned] = useState(existing?.calories_burned != null ? String(existing.calories_burned) : '')
  const [notes, setNotes] = useState(existing?.notes || '')
  const [err, setErr] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!exerciseName.trim()) {
      setErr('Please enter exercise name')
      return
    }

    const entry = {
      id: existing?.id || 'strength_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      date,
      exercise_name: exerciseName.trim(),
      muscle_group: muscleGroup || null,
      sets: sets !== '' ? Math.max(1, parseInt(sets, 10)) : null,
      reps: reps !== '' ? Math.max(1, parseInt(reps, 10)) : null,
      weight_kg: weightKg !== '' ? Math.max(0, parseFloat(weightKg)) : null,
      duration_min: durationMin !== '' ? Math.max(0, parseFloat(durationMin)) : null,
      calories_burned: caloriesBurned !== '' ? Math.max(0, parseFloat(caloriesBurned)) : null,
      notes: notes.trim() || null
    }

    onSave(entry)
  }

  return (
    <form onSubmit={handleSubmit} style={{ padding: '4px 0 16px' }}>
      <h3 style={{ margin: '0 0 14px', fontSize: '1.2rem', fontWeight: 700 }}>
        {existing ? t('Edit Strength Exercise') : t('Add Strength Exercise')}
      </h3>

      {err && (
        <div style={{ color: 'var(--red)', fontSize: '0.85rem', marginBottom: 12, padding: '6px 10px', background: 'color-mix(in srgb,var(--red) 12%,transparent)', borderRadius: 6 }}>
          {err}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 12, marginBottom: 12 }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>
            {t('Exercise Name *')}
          </label>
          <input
            type="text"
            required
            placeholder="e.g. Barbell Squat, Dumbbell Curl"
            value={exerciseName}
            onChange={e => setExerciseName(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>
            {t('Muscle Group')}
          </label>
          <select
            value={muscleGroup}
            onChange={e => setMuscleGroup(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)' }}
          >
            {MUSCLE_GROUPS.map(mg => (
              <option key={mg} value={mg}>{mg}</option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 12 }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>
            {t('Sets')}
          </label>
          <input
            type="number"
            min="1"
            placeholder="e.g. 4"
            value={sets}
            onChange={e => setSets(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>
            {t('Reps')}
          </label>
          <input
            type="number"
            min="1"
            placeholder="e.g. 10"
            value={reps}
            onChange={e => setReps(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>
            {t('Weight (kg)')}
          </label>
          <input
            type="number"
            step="0.5"
            min="0"
            placeholder="e.g. 60"
            value={weightKg}
            onChange={e => setWeightKg(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)' }}
          />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>
            {t('Duration (min, optional)')}
          </label>
          <input
            type="number"
            min="0"
            placeholder="e.g. 20"
            value={durationMin}
            onChange={e => setDurationMin(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>
            {t('Est. Calories (optional)')}
          </label>
          <input
            type="number"
            min="0"
            placeholder="optional manual estimate"
            value={caloriesBurned}
            onChange={e => setCaloriesBurned(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)' }}
          />
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>
          {t('Notes (optional)')}
        </label>
        <input
          type="text"
          placeholder="e.g. drop set on last set, good form"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)' }}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <Button variant="acc" type="submit" style={{ padding: '10px 20px', fontWeight: 600 }}>
          {t('Save Strength Exercise')}
        </Button>
      </div>
    </form>
  )
}
