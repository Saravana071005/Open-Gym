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

// Reference examples showing the simplified food logging format (clearly marked and not counted in user data)
const EXAMPLE_ENTRIES = [
  {
    id: 'example-1',
    is_example: true,
    meal_type: 'breakfast',
    food_name: 'Rolled oats, overnight soaked',
    serving_quantity: 100,
    serving_unit: 'g',
    notes: 'Soaked overnight in water'
  },
  {
    id: 'example-2',
    is_example: true,
    meal_type: 'breakfast',
    food_name: 'Banana',
    serving_quantity: 150,
    serving_unit: 'g',
    notes: 'Medium banana, sliced'
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
          if (res.settings && res.settings.water_goal_litres != null) {
            setWaterGoalL(res.settings.water_goal_litres)
            setWaterGoalDraft(String(res.settings.water_goal_litres))
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
    const realFoods = foods.filter(f => !f.is_example)

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

    return {
      food_count: realFoods.length,
      calorie_target: 1900,
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

  // --- Simplified Food Operations ---
  const handleOpenFoodModal = (existing = null, defaultMeal = 'breakfast') => {
    openSheet(close => (
      <SimplifiedFoodFormModal
        date={date}
        existing={existing}
        defaultMeal={defaultMeal}
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
    <div className="narrow" style={{ maxWidth: 960, margin: '0 auto', padding: '16px 14px 80px' }}>
      {/* Page Title & Top Actions */}
      <div className="hdr" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 26, fontWeight: 700, margin: 0, letterSpacing: '-0.025em' }}>
            <span style={{ color: 'var(--coral)' }}><Icon name="apple" /></span>
            {t('Daily Health Log')}
          </h1>
          <div className="sub" style={{ fontSize: 13, color: 'var(--label-2)', marginTop: 2 }}>
            {t('Manual tracking · 1,900 kcal target · ChatGPT PDF')}
          </div>
        </div>

        {/* Prominent Export Daily Report PDF Button */}
        <Button
          variant="primary"
          icon="download"
          onClick={handleExportPdf}
          style={{ fontWeight: 700, padding: '10px 18px', fontSize: 14, borderRadius: 9999, boxShadow: '0 4px 14px -2px rgba(46,196,182,0.4)' }}
        >
          {t('Export Daily Report PDF')}
        </Button>
      </div>

      {/* Date Selector Strip */}
      <div className="card" style={{ padding: '12px 16px', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              className="iconbtn"
              onClick={() => changeDate(-1)}
              aria-label="Previous day"
              style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--surface-2)' }}
            >
              <Icon name="chevronLeft" />
            </button>
            <input
              type="date"
              value={date}
              onChange={e => e.target.value && setDate(e.target.value)}
              style={{
                background: 'var(--surface-2)',
                border: 'var(--card-border)',
                borderRadius: 12,
                padding: '6px 12px',
                fontSize: 14,
                fontWeight: 600,
                color: 'var(--label)'
              }}
            />
            <button
              className="iconbtn"
              onClick={() => changeDate(1)}
              aria-label="Next day"
              style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--surface-2)' }}
            >
              <Icon name="chevronRight" />
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {date !== todayISO() && (
              <button
                className="btn small"
                onClick={() => setDate(todayISO())}
                style={{ padding: '5px 12px', fontSize: 13, borderRadius: 9999 }}
              >
                {t('Today')}
              </button>
            )}
            <button
              className={`btn small ${showExamples ? 'primary' : ''}`}
              onClick={() => setShowExamples(!showExamples)}
              style={{ padding: '5px 12px', fontSize: 13, borderRadius: 9999 }}
              title={t('Toggle reference example entries')}
            >
              <Icon name="lightbulb" />
              <span style={{ marginLeft: 4 }}>{showExamples ? t('Hide Examples') : t('Show Examples')}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Calorie Goal & Overview Card — Inspired by Phone 6 in reference image */}
      <div className="calorie-goal-card">
        <div className="row between" style={{ alignItems: 'baseline', marginBottom: 4 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--label-2)', textTransform: 'uppercase' }}>
              {t('Calorie Goal')}
            </div>
            <div className="big" style={{ fontSize: 26, fontWeight: 800, marginTop: 2 }}>
              1,900 <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--label-2)' }}>kcal</span>
            </div>
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--label-2)' }}>
            {totals.food_count > 0 ? t('{0} foods recorded', totals.food_count) : t('No foods recorded')}
          </span>
        </div>

        {/* Progress Bar */}
        <div className="calorie-bar-wrap">
          <div className="calorie-bar-track">
            <div
              className="calorie-bar-fill"
              style={{ width: `${Math.min(100, totals.food_count * 25)}%` }}
            />
          </div>
        </div>

        {/* Summary Pills Grid */}
        <div className="macro-pills-grid">
          <div className="macro-pill-item">
            <span className="macro-pill-title">{t('Food Items')}</span>
            <span className="macro-pill-val">{totals.food_count}</span>
          </div>
          <div className="macro-pill-item">
            <span className="macro-pill-title">{t('Water')}</span>
            <span className="macro-pill-val" style={{ color: 'var(--teal)' }}>
              {totals.water_litres} L <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--label-3)' }}>/ {waterGoalL}L</span>
            </span>
          </div>
          <div className="macro-pill-item">
            <span className="macro-pill-title">{t('Activity')}</span>
            <span className="macro-pill-val" style={{ color: 'var(--coral)' }}>
              {totals.total_workout_duration_min} <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--label-3)' }}>min</span>
            </span>
          </div>
        </div>

        <div style={{ background: 'var(--surface-2)', borderRadius: 12, padding: '10px 14px', marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--mint)', fontSize: 16 }}><Icon name="info" /></span>
          <div style={{ fontSize: 12, color: 'var(--label-2)', lineHeight: 1.4 }}>
            {t('Manual logging without live AI APIs. Click "Export Daily Report PDF" to evaluate full calories, macros and hydration in ChatGPT.')}
          </div>
        </div>
      </div>

      {/* Today's Meals Section — Grouped cards matching Phone 6 in reference image */}
      <div style={{ marginBottom: 20 }}>
        <div className="row between" style={{ marginBottom: 12, padding: '0 4px' }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: 'var(--label)' }}>
            {t("Today's Meals")}
          </h2>
          <Button
            variant="tinted"
            icon="plus"
            size="sm"
            onClick={() => handleOpenFoodModal()}
          >
            {t('Add Food')}
          </Button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {MEAL_TYPES.map(meal => {
            const mealFoods = displayFoods.filter(f => f.meal_type === meal.id)
            return (
              <div key={meal.id} className="card" style={{ padding: '16px 18px', marginBottom: 0 }}>
                <div className="row between" style={{ marginBottom: mealFoods.length ? 12 : 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 10,
                        background: 'var(--surface-2)',
                        color: meal.color,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 18
                      }}
                    >
                      <Icon name={meal.icon} />
                    </span>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--label)' }}>
                        {t(meal.label)}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--label-2)' }}>
                        {mealFoods.length} {t(mealFoods.length === 1 ? 'item' : 'items')}
                      </div>
                    </div>
                  </div>

                  <button
                    className="iconbtn"
                    style={{ width: 32, height: 32, fontSize: 14, background: 'var(--surface-2)', color: 'var(--mint)' }}
                    onClick={() => handleOpenFoodModal(null, meal.id)}
                    aria-label={t('Add food to {0}', meal.label)}
                    title={t('Add food to {0}', meal.label)}
                  >
                    <Icon name="plus" />
                  </button>
                </div>

                {/* Food Entries in this meal */}
                {mealFoods.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {mealFoods.map(f => (
                      <div
                        key={f.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 10,
                          padding: '10px 12px',
                          borderRadius: 12,
                          background: f.is_example ? 'color-mix(in srgb, var(--surface-2) 60%, transparent)' : 'var(--surface-2)'
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--label)' }}>
                            {f.food_name}
                            {f.is_example && (
                              <span style={{ marginLeft: 6, fontSize: 11, background: 'var(--surface-3)', color: 'var(--label-3)', padding: '2px 6px', borderRadius: 4 }}>
                                {t('Example')}
                              </span>
                            )}
                          </div>
                          {f.notes && (
                            <div style={{ fontSize: 12, color: 'var(--label-2)', marginTop: 2 }}>
                              {f.notes}
                            </div>
                          )}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>
                          <span
                            style={{
                              background: 'var(--surface)',
                              border: 'var(--card-border)',
                              padding: '4px 10px',
                              borderRadius: 9999,
                              fontSize: 12,
                              fontWeight: 700,
                              color: 'var(--label)'
                            }}
                          >
                            {f.serving_quantity} {f.serving_unit}
                          </span>

                          {!f.is_example && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <button
                                className="iconbtn"
                                onClick={() => handleOpenFoodModal(f, meal.id)}
                                style={{ width: 28, height: 28, fontSize: 12 }}
                                aria-label="Edit food"
                              >
                                <Icon name="pencil" />
                              </button>
                              <button
                                className="iconbtn"
                                onClick={() => handleDeleteFood(f)}
                                style={{ width: 28, height: 28, fontSize: 12, color: 'var(--coral)' }}
                                aria-label="Delete food"
                              >
                                <Icon name="trash" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ padding: '8px 4px', fontSize: 13, color: 'var(--label-3)', fontStyle: 'italic' }}>
                    {t('No {0} entries recorded yet.', meal.label.toLowerCase())}
                  </div>
                )}
              </div>
            )
          })}
        </div>
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

      {/* Bottom Floating/Docked Export Report Card */}
      <div className="card" style={{ padding: 18, textAlign: 'center', background: 'var(--surface)', marginTop: 14 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--label)', marginBottom: 4 }}>
          {t('Ready to analyze your daily nutrition?')}
        </div>
        <div className="muted small" style={{ marginBottom: 14 }}>
          {t('Exports your complete daily food, water, cardio, steps, and strength records formatted for instant evaluation by ChatGPT.')}
        </div>
        <Button
          variant="primary"
          size="lg"
          icon="download"
          onClick={handleExportPdf}
          style={{ width: '100%', padding: '15px', borderRadius: 'var(--r)', fontSize: 16, fontWeight: 700 }}
        >
          {t('Export Daily Report PDF')}
        </Button>
      </div>
    </div>
  )
}

/* ============================ MODALS ============================ */

/**
 * Simplified Food Entry Form Modal:
 * Contains only Meal, Food Name, Quantity, Unit, and optional Notes.
 * Completely removes calories and macronutrient inputs.
 */
function SimplifiedFoodFormModal({ date, existing, defaultMeal = 'breakfast', onSave }) {
  const [mealType, setMealType] = useState(existing?.meal_type || defaultMeal)
  const [foodName, setFoodName] = useState(existing?.food_name || '')
  const [quantity, setQuantity] = useState(existing?.serving_quantity != null ? String(existing.serving_quantity) : '100')
  const [unit, setUnit] = useState(existing?.serving_unit || 'g')
  const [notes, setNotes] = useState(existing?.notes || '')
  const [err, setErr] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!foodName.trim()) {
      setErr('Please enter food name')
      return
    }
    if (quantity === '' || isNaN(parseFloat(quantity)) || parseFloat(quantity) <= 0) {
      setErr('Please enter a valid positive quantity')
      return
    }

    const entry = {
      id: existing?.id || 'food_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      date,
      meal_type: mealType,
      food_name: foodName.trim(),
      serving_quantity: parseFloat(quantity),
      serving_unit: unit,
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 14 }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>
            {t('Meal *')}
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
            placeholder="e.g. Rolled oats, overnight soaked"
            value={foodName}
            onChange={e => setFoodName(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)' }}
          />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>
            {t('Quantity *')}
          </label>
          <input
            type="number"
            step="any"
            min="0.1"
            required
            placeholder="e.g. 100"
            value={quantity}
            onChange={e => setQuantity(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', fontWeight: 600 }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>
            {t('Unit *')}
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

      <div style={{ marginBottom: 18 }}>
        <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>
          {t('Notes (optional)')}
        </label>
        <input
          type="text"
          placeholder="e.g. Soaked overnight in water, raw, boiled"
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
