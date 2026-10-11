import { useState, useEffect } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { todayISO, fmtDate } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

const MEAL_TYPES = [
  { id: 'breakfast', label: 'Breakfast', icon: 'sun', color: 'var(--orange)' },
  { id: 'lunch', label: 'Lunch', icon: 'sun', color: 'var(--yellow)' },
  { id: 'dinner', label: 'Dinner', icon: 'moon', color: 'var(--indigo)' },
  { id: 'snack', label: 'Snacks', icon: 'apple', color: 'var(--green)' }
]

const QUICK_EXAMPLES = [
  '2 wheat roti with chicken gravy',
  '100 g roasted peanuts',
  '150 g rice, 100 g chicken and 1 tablespoon oil',
  '1 katori dal tadka',
  '2 boiled eggs'
]

export default function Nutrition() {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const user = useStore(s => s.user)
  const isGuest = useStore(s => s.isGuest())
  const { openSheet, toast, confirmSheet } = useUI()

  const [date, setDate] = useState(todayISO())
  const [logs, setLogs] = useState([])
  const [totals, setTotals] = useState({ energy_kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0, fibre_g: 0 })
  const [targets, setTargets] = useState({
    calorie_target: S.nutritionTargets?.calorie || 2000,
    protein_target_g: S.nutritionTargets?.protein || 140,
    carb_target_g: S.nutritionTargets?.carb || 220,
    fat_target_g: S.nutritionTargets?.fat || 65,
    fibre_target_g: S.nutritionTargets?.fibre || 30,
    diet_preference: S.nutritionTargets?.diet || 'all'
  })
  const [loading, setLoading] = useState(false)

  // Natural Language input state
  const [nlInput, setNlInput] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [parsedMeal, setParsedMeal] = useState(null)
  const [selectedMealType, setSelectedMealType] = useState('lunch')
  const [analysisError, setAnalysisError] = useState(null)
  const [isQuotaError, setIsQuotaError] = useState(false)

  // Load targets
  useEffect(() => {
    if (user) {
      api('/api/nutrition/targets').then(res => {
        if (res.ok && res.targets) {
          setTargets({
            calorie_target: res.targets.calorie_target || 2000,
            protein_target_g: res.targets.protein_target_g || 140,
            carb_target_g: res.targets.carb_target_g || 220,
            fat_target_g: res.targets.fat_target_g || 65,
            fibre_target_g: res.targets.fibre_target_g || 30,
            diet_preference: res.targets.diet_preference || 'all'
          })
        }
      }).catch(() => {})
    }
  }, [user])

  // Load meal logs for date
  const loadLogs = async (d) => {
    setLoading(true)
    if (user) {
      try {
        const res = await api(`/api/nutrition/log?date=${d}`)
        if (res.ok) {
          setLogs(res.logs || [])
          setTotals(res.totals || { energy_kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0, fibre_g: 0 })
        }
      } catch (e) {
        // Fallback to local store
        const dayMeals = (S.meals || []).filter(m => m.date === d)
        setLogs(dayMeals)
        computeLocalTotals(dayMeals)
      }
    } else {
      const dayMeals = (S.meals || []).filter(m => m.date === d)
      setLogs(dayMeals)
      computeLocalTotals(dayMeals)
    }
    setLoading(false)
  }

  const computeLocalTotals = (list) => {
    const tot = { energy_kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0, fibre_g: 0 }
    for (const m of list) {
      tot.energy_kcal += Number(m.energy_kcal) || 0
      tot.protein_g += Number(m.protein_g) || 0
      tot.carb_g += Number(m.carb_g) || 0
      tot.fat_g += Number(m.fat_g) || 0
      tot.fibre_g += Number(m.fibre_g) || 0
    }
    tot.energy_kcal = Math.round(tot.energy_kcal * 10) / 10
    tot.protein_g = Math.round(tot.protein_g * 10) / 10
    tot.carb_g = Math.round(tot.carb_g * 10) / 10
    tot.fat_g = Math.round(tot.fat_g * 10) / 10
    tot.fibre_g = Math.round(tot.fibre_g * 10) / 10
    setTotals(tot)
  }

  useEffect(() => {
    loadLogs(date)
  }, [date, user])

  // Shift date helper
  const shiftDate = (days) => {
    const curr = new Date(date)
    curr.setDate(curr.getDate() + days)
    setDate(curr.toISOString().slice(0, 10))
  }

  // Handle Natural Language parse with Gemini
  const handleAnalyzeMeal = async () => {
    const trimmed = nlInput.trim()
    if (!trimmed) {
      setAnalysisError(t('Please enter a food description first.'))
      toast(t('Please enter a food description first.'))
      return
    }
    setAnalyzing(true)
    setAnalysisError(null)
    setIsQuotaError(false)
    try {
      const res = await api('/api/nutrition/parse', {
        method: 'POST',
        body: JSON.stringify({ text: trimmed })
      })
      if (res.ok) {
        setParsedMeal(res)
        setAnalysisError(null)
        setIsQuotaError(false)
      } else {
        const errMsg = res.error || t('Could not analyze meal description')
        setAnalysisError(errMsg)
        setIsQuotaError(!!res.isQuota || errMsg.toLowerCase().includes('quota') || errMsg.toLowerCase().includes('rate limit'))
        toast(errMsg)
      }
    } catch (e) {
      const errMsg = e.message || t('Error communicating with nutrition service')
      setAnalysisError(errMsg)
      setIsQuotaError(errMsg.toLowerCase().includes('quota') || errMsg.toLowerCase().includes('rate limit'))
      toast(errMsg)
    } finally {
      setAnalyzing(false)
    }
  }

  // Update parsed item portion dynamically
  const handleUpdateItemPortion = (idx, newQty) => {
    const q = Math.max(0, Number(newQty) || 0)
    setParsedMeal(prev => {
      if (!prev || !prev.items) return prev
      const items = [...prev.items]
      const target = { ...items[idx] }
      const oldQty = target.quantity ?? target.explicit_quantity ?? 1
      const factor = oldQty > 0 ? (q / oldQty) : 1
      target.quantity = q
      target.explicit_quantity = q

      const baseWeight = target.estimatedGrams ?? target.estimated_weight_g ?? target.grams ?? 100
      target.estimatedGrams = Math.round((baseWeight * factor) * 10) / 10
      target.estimated_weight_g = target.estimatedGrams
      target.grams = target.estimatedGrams

      const baseKcal = target.calories ?? target.energy_kcal ?? target.nutrients?.energy_kcal ?? 0
      const baseProt = target.protein ?? target.protein_g ?? target.nutrients?.protein_g ?? 0
      const baseCarb = target.carbohydrates ?? target.carb_g ?? target.nutrients?.carb_g ?? 0
      const baseFat = target.fat ?? target.fat_g ?? target.nutrients?.fat_g ?? 0
      const baseFib = target.fibre ?? target.fibre_g ?? target.nutrients?.fibre_g ?? 0

      target.calories = Math.round((baseKcal * factor) * 10) / 10
      target.energy_kcal = target.calories
      target.protein = Math.round((baseProt * factor) * 10) / 10
      target.protein_g = target.protein
      target.carbohydrates = Math.round((baseCarb * factor) * 10) / 10
      target.carb_g = target.carbohydrates
      target.fat = Math.round((baseFat * factor) * 10) / 10
      target.fat_g = target.fat
      target.fibre = Math.round((baseFib * factor) * 10) / 10
      target.fibre_g = target.fibre

      if (target.nutrients) {
        target.nutrients = {
          energy_kcal: target.calories,
          protein_g: target.protein,
          carb_g: target.carbohydrates,
          fat_g: target.fat,
          fibre_g: target.fibre
        }
      }
      items[idx] = target

      // Recalculate totals directly as sum of all items
      const totals = {
        calories: 0,
        protein: 0,
        carbohydrates: 0,
        fat: 0,
        fibre: 0,
        energy_kcal: 0,
        protein_g: 0,
        carb_g: 0,
        fat_g: 0,
        fibre_g: 0
      }
      for (const it of items) {
        totals.calories += (it.calories ?? it.energy_kcal ?? 0)
        totals.protein += (it.protein ?? it.protein_g ?? 0)
        totals.carbohydrates += (it.carbohydrates ?? it.carb_g ?? 0)
        totals.fat += (it.fat ?? it.fat_g ?? 0)
        totals.fibre += (it.fibre ?? it.fibre_g ?? 0)
      }
      totals.calories = Math.round(totals.calories * 10) / 10
      totals.protein = Math.round(totals.protein * 10) / 10
      totals.carbohydrates = Math.round(totals.carbohydrates * 10) / 10
      totals.fat = Math.round(totals.fat * 10) / 10
      totals.fibre = Math.round(totals.fibre * 10) / 10

      totals.energy_kcal = totals.calories
      totals.protein_g = totals.protein
      totals.carb_g = totals.carbohydrates
      totals.fat_g = totals.fat
      totals.fibre_g = totals.fibre

      return { ...prev, items, totals }
    })
  }

  // Remove parsed item from meal proposal
  const handleRemoveParsedItem = (idx) => {
    setParsedMeal(prev => {
      if (!prev || !prev.items) return prev
      const items = prev.items.filter((_, i) => i !== idx)
      const totals = { energy_kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0, fibre_g: 0 }
      for (const it of items) {
        totals.energy_kcal += (it.energy_kcal ?? it.nutrients?.energy_kcal ?? 0)
        totals.protein_g += (it.protein_g ?? it.nutrients?.protein_g ?? 0)
        totals.carb_g += (it.carb_g ?? it.nutrients?.carb_g ?? 0)
        totals.fat_g += (it.fat_g ?? it.nutrients?.fat_g ?? 0)
        totals.fibre_g += (it.fibre_g ?? it.nutrients?.fibre_g ?? 0)
      }
      totals.energy_kcal = Math.round(totals.energy_kcal * 10) / 10
      totals.protein_g = Math.round(totals.protein_g * 10) / 10
      totals.carb_g = Math.round(totals.carb_g * 10) / 10
      totals.fat_g = Math.round(totals.fat_g * 10) / 10
      totals.fibre_g = Math.round(totals.fibre_g * 10) / 10
      return { ...prev, items, totals, item_count: items.length }
    })
  }

  // Replace parsed item with an alternative candidate food
  const handleSelectAlternative = async (idx, alt) => {
    try {
      const res = await api(`/api/nutrition/food?id=${encodeURIComponent(alt.id)}`)
      if (res.ok && res.food) {
        const food = res.food
        setParsedMeal(prev => {
          if (!prev || !prev.items) return prev
          const items = [...prev.items]
          const target = { ...items[idx] }
          const factor = (target.estimated_weight_g || target.grams || 100) / 100
          target.ingredient_name = food.name
          target.food_name = food.name
          target.tamil_name = food.tamil_name || null
          target.energy_kcal = Math.round((food.energy_kcal * factor) * 10) / 10
          target.protein_g = Math.round((food.protein_g * factor) * 10) / 10
          target.carb_g = Math.round((food.carb_g * factor) * 10) / 10
          target.fat_g = Math.round((food.fat_g * factor) * 10) / 10
          target.fibre_g = Math.round((food.fibre_g * factor) * 10) / 10
          items[idx] = target

          // Recalculate totals
          const totals = { energy_kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0, fibre_g: 0 }
          for (const it of items) {
            totals.energy_kcal += (it.energy_kcal ?? it.nutrients?.energy_kcal ?? 0)
            totals.protein_g += (it.protein_g ?? it.nutrients?.protein_g ?? 0)
            totals.carb_g += (it.carb_g ?? it.nutrients?.carb_g ?? 0)
            totals.fat_g += (it.fat_g ?? it.nutrients?.fat_g ?? 0)
            totals.fibre_g += (it.fibre_g ?? it.nutrients?.fibre_g ?? 0)
          }
          totals.energy_kcal = Math.round(totals.energy_kcal * 10) / 10
          totals.protein_g = Math.round(totals.protein_g * 10) / 10
          totals.carb_g = Math.round(totals.carb_g * 10) / 10
          totals.fat_g = Math.round(totals.fat_g * 10) / 10
          totals.fibre_g = Math.round(totals.fibre_g * 10) / 10
          return { ...prev, items, totals }
        })
      }
    } catch (e) {
      toast(t('Could not load food details: {0}', e.message))
    }
  }

  // Explicit confirmation before adding parsed meal to daily profile
  const handleConfirmAndAddMeal = () => {
    if (!parsedMeal || !parsedMeal.items?.length) return
    const mealName = MEAL_TYPES.find(m => m.id === selectedMealType)?.label || selectedMealType
    confirmSheet({
      title: t('Log {0} to Daily Profile?', mealName),
      message: t('Add {0} item(s) totaling {1} kcal, {2}g protein for {3}?', parsedMeal.items.length, parsedMeal.totals?.energy_kcal, parsedMeal.totals?.protein_g, fmtDate(date)),
      confirmText: t('Confirm & Add Meal'),
      onConfirm: async () => {
        await executeAddParsedMeal(parsedMeal.items)
      }
    })
  }

  // Execute add after confirmation
  const executeAddParsedMeal = async (itemsToLog) => {
    let addedCount = 0

    for (const item of itemsToLog) {
      const entry = {
        date,
        meal_type: selectedMealType,
        food_id: item.food_id || null,
        food_name: item.ingredient_name || item.food_name || 'Food Item',
        serving_quantity: item.explicit_quantity ?? item.quantity ?? 1,
        serving_unit: item.quantity_unit || item.unit || 'g',
        serving_grams: item.estimated_weight_g ?? item.grams ?? 100,
        energy_kcal: item.energy_kcal ?? item.nutrients?.energy_kcal ?? 0,
        protein_g: item.protein_g ?? item.nutrients?.protein_g ?? 0,
        carb_g: item.carb_g ?? item.nutrients?.carb_g ?? 0,
        fat_g: item.fat_g ?? item.nutrients?.fat_g ?? 0,
        fibre_g: item.fibre_g ?? item.nutrients?.fibre_g ?? 0,
        assumptions: item.assumptions || []
      }

      if (user) {
        try {
          await api('/api/nutrition/log', {
            method: 'POST',
            body: JSON.stringify(entry)
          })
          addedCount++
        } catch (e) {
          // Fallback to local
          const localEntry = { ...entry, id: 'loc_' + Date.now() + Math.random() }
          update(s => {
            if (!s.meals) s.meals = []
            s.meals.push(localEntry)
          })
          addedCount++
        }
      } else {
        const localEntry = { ...entry, id: 'loc_' + Date.now() + Math.random() }
        update(s => {
          if (!s.meals) s.meals = []
          s.meals.push(localEntry)
        })
        addedCount++
      }
    }

    toast(t('Logged {0} items to {1}', addedCount, selectedMealType))
    setParsedMeal(null)
    setNlInput('')
    loadLogs(date)
  }

  // Delete logged item
  const handleDeleteEntry = (entry) => {
    confirmSheet({
      title: t('Delete food entry?'),
      message: t('Remove "{0}" ({1} kcal) from this meal?', entry.food_name, entry.energy_kcal),
      confirmText: t('Delete'),
      danger: true,
      onConfirm: async () => {
        if (user && !entry.id.startsWith('loc_')) {
          try {
            await api('/api/nutrition/log/delete', {
              method: 'POST',
              body: JSON.stringify({ id: entry.id })
            })
          } catch (e) {}
        }
        update(s => {
          if (s.meals) {
            s.meals = s.meals.filter(m => m.id !== entry.id)
          }
        })
        toast(t('Item removed'))
        loadLogs(date)
      }
    })
  }

  // Open Targets configuration sheet
  const handleOpenTargets = () => {
    openSheet(close => {
      let cal = targets.calorie_target || 2000
      let prot = targets.protein_target_g || 140
      let carb = targets.carb_target_g || 220
      let fat = targets.fat_target_g || 65
      let fib = targets.fibre_target_g || 30
      let diet = targets.diet_preference || 'all'

      return (
        <div>
          <h3>{t('Nutrition Targets')}</h3>
          <p className="muted small" style={{ marginBottom: 16 }}>
            {t('Configure your daily calorie and macronutrient targets. Progress is updated in real time as you log meals.')}
          </p>

          <div className="list" style={{ marginBottom: 16 }}>
            <div className="item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <div className="row between">
                <span className="tt">{t('Daily Calories')}</span>
                <span className="accent" style={{ fontWeight: 600 }}>{cal} kcal</span>
              </div>
              <input
                type="number"
                defaultValue={cal}
                onChange={e => { cal = Number(e.target.value) || 2000 }}
                style={{ width: '100%', marginTop: 8, padding: '8px 12px', background: 'var(--surface-2)', border: 'none', borderRadius: 8 }}
              />
            </div>

            <div className="item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <div className="row between">
                <span className="tt">{t('Protein Target')}</span>
                <span style={{ color: 'var(--blue)', fontWeight: 600 }}>{prot} g</span>
              </div>
              <input
                type="number"
                defaultValue={prot}
                onChange={e => { prot = Number(e.target.value) || 140 }}
                style={{ width: '100%', marginTop: 8, padding: '8px 12px', background: 'var(--surface-2)', border: 'none', borderRadius: 8 }}
              />
            </div>

            <div className="item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <div className="row between">
                <span className="tt">{t('Carbohydrate Target')}</span>
                <span style={{ color: 'var(--orange)', fontWeight: 600 }}>{carb} g</span>
              </div>
              <input
                type="number"
                defaultValue={carb}
                onChange={e => { carb = Number(e.target.value) || 220 }}
                style={{ width: '100%', marginTop: 8, padding: '8px 12px', background: 'var(--surface-2)', border: 'none', borderRadius: 8 }}
              />
            </div>

            <div className="item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <div className="row between">
                <span className="tt">{t('Fat Target')}</span>
                <span style={{ color: 'var(--yellow)', fontWeight: 600 }}>{fat} g</span>
              </div>
              <input
                type="number"
                defaultValue={fat}
                onChange={e => { fat = Number(e.target.value) || 65 }}
                style={{ width: '100%', marginTop: 8, padding: '8px 12px', background: 'var(--surface-2)', border: 'none', borderRadius: 8 }}
              />
            </div>

            <div className="item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <div className="row between">
                <span className="tt">{t('Dietary Fibre Target')}</span>
                <span style={{ color: 'var(--green)', fontWeight: 600 }}>{fib} g</span>
              </div>
              <input
                type="number"
                defaultValue={fib}
                onChange={e => { fib = Number(e.target.value) || 30 }}
                style={{ width: '100%', marginTop: 8, padding: '8px 12px', background: 'var(--surface-2)', border: 'none', borderRadius: 8 }}
              />
            </div>
          </div>

          <Button
            variant="primary"
            onClick={async () => {
              const updated = {
                calorie_target: cal,
                protein_target_g: prot,
                carb_target_g: carb,
                fat_target_g: fat,
                fibre_target_g: fib,
                diet_preference: diet
              }
              setTargets(updated)
              update(s => {
                s.nutritionTargets = { calorie: cal, protein: prot, carb, fat, fibre: fib, diet }
              })
              if (user) {
                try {
                  await api('/api/nutrition/targets', { method: 'POST', body: JSON.stringify(updated) })
                } catch (e) {}
              }
              toast(t('Targets saved'))
              close()
            }}
          >
            {t('Save Targets')}
          </Button>
        </div>
      )
    })
  }

  // Open Food & Recipe Explorer Sheet
  const handleOpenFoodSearch = (mealType) => {
    openSheet(close => {
      let searchQ = ''
      let results = []
      let searching = false

      const FoodSearchModal = () => {
        const [items, setItems] = useState([])
        const [q, setQ] = useState('')
        const [busy, setBusy] = useState(false)

        const runSearch = async (val) => {
          setQ(val)
          if (!val.trim()) { setItems([]); return }
          setBusy(true)
          try {
            const res = await api(`/api/nutrition/search?q=${encodeURIComponent(val)}&limit=15`)
            if (res.ok) setItems(res.foods || [])
          } catch (e) {}
          setBusy(false)
        }

        const handleSelectFood = async (food) => {
          const entry = {
            date,
            meal_type: mealType,
            food_id: food.id,
            food_name: food.name,
            serving_quantity: 1,
            serving_unit: food.serving_unit || 'g',
            serving_grams: food.serving_size_g || 100,
            energy_kcal: food.energy_kcal,
            protein_g: food.protein_g,
            carb_g: food.carb_g,
            fat_g: food.fat_g,
            fibre_g: food.fibre_g,
            assumptions: [`1 standard serving (${food.serving_size_g || 100} ${food.serving_unit || 'g'})`]
          }

          if (user) {
            try {
              await api('/api/nutrition/log', { method: 'POST', body: JSON.stringify(entry) })
            } catch (e) {
              update(s => { (s.meals = s.meals || []).push({ ...entry, id: 'loc_' + Date.now() }) })
            }
          } else {
            update(s => { (s.meals = s.meals || []).push({ ...entry, id: 'loc_' + Date.now() }) })
          }
          toast(t('Added {0} to {1}', food.name, mealType))
          close()
          loadLogs(date)
        }

        return (
          <div>
            <h3>{t('Search Food & Recipes')}</h3>
            <p className="muted small" style={{ marginBottom: 12 }}>
              {t('Search 7,000+ verified Indian staples, authentic recipes, and USDA ingredients.')}
            </p>
            <input
              type="search"
              placeholder={t('Search food, recipe, Tamil name...')}
              autoFocus
              value={q}
              onChange={e => runSearch(e.target.value)}
              style={{ width: '100%', padding: '12px 14px', background: 'var(--surface-2)', border: 'none', borderRadius: 10, marginBottom: 14 }}
            />

            {busy && <div className="muted small" style={{ textAlign: 'center', padding: 12 }}>{t('Searching foods...')}</div>}

            <div className="list" style={{ maxHeight: '55vh', overflowY: 'auto' }}>
              {items.map(f => (
                <div key={f.id} className="item" onClick={() => handleSelectFood(f)}>
                  <span className="lrow-i" style={{ background: f.is_recipe ? 'var(--orange)' : 'var(--acc)' }}>
                    <Icon name={f.is_recipe ? 'flame' : 'nutrition'} />
                  </span>
                  <div className="grow">
                    <div className="tt">{f.name} {f.tamil_name && <span className="muted">({f.tamil_name})</span>}</div>
                    <div className="ss">
                      {f.energy_kcal} kcal · P: {f.protein_g}g · C: {f.carb_g}g · F: {f.fat_g}g · {f.source}
                    </div>
                  </div>
                  <Icon name="plus" />
                </div>
              ))}
              {!items.length && q && !busy && (
                <div className="muted small" style={{ textAlign: 'center', padding: 24 }}>
                  {t('No foods found for "{0}". Try natural-language parser on the main tab.', q)}
                </div>
              )}
            </div>
          </div>
        )
      }

      return <FoodSearchModal />
    })
  }

  // Progress computations
  const calTarget = targets.calorie_target || 2000
  const calConsumed = totals.energy_kcal || 0
  const calRemaining = Math.max(0, Math.round(calTarget - calConsumed))
  const calPct = Math.min(100, Math.round((calConsumed / calTarget) * 100))

  return (
    <div className="nutrition-container">
      {/* Header & Date Bar */}
      <div className="hdr">
        <div>
          <h1>{t('Nutrition')}</h1>
          <div className="sub">{t('AI Food Calculator & Verified Meal Tracker')}</div>
        </div>
        <Button size="sm" icon="target" variant="tinted" onClick={handleOpenTargets}>
          {t('Targets')}
        </Button>
      </div>

      {/* Date Switcher */}
      <div className="card row between" style={{ padding: '10px 16px', marginBottom: 16 }}>
        <button className="iconbtn" onClick={() => shiftDate(-1)} aria-label="Previous day">
          <Icon name="chevronLeft" />
        </button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontWeight: 600, fontSize: 16 }}>
            {date === todayISO() ? t('Today') : fmtDate(date)}
          </div>
          <div className="muted small">{date}</div>
        </div>
        <button className="iconbtn" onClick={() => shiftDate(1)} aria-label="Next day">
          <Icon name="chevronRight" />
        </button>
      </div>

      <div className="cols">
        {/* Left Column: Progress & Daily Meal Log */}
        <div>
          {/* Calorie & Macro Target Progress Card */}
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="row between" style={{ marginBottom: 8 }}>
              <span className="muted small" style={{ textTransform: 'uppercase', letterSpacing: '.05em' }}>
                {t('Calories Today')}
              </span>
              <span className="accent" style={{ fontWeight: 600 }}>{calPct}%</span>
            </div>

            <div className="row between" style={{ alignItems: 'baseline', marginBottom: 12 }}>
              <div className="big" style={{ fontSize: 36 }}>{Math.round(calConsumed)} <span className="muted" style={{ fontSize: 18, fontWeight: 400 }}>/ {calTarget} kcal</span></div>
              <div className="muted small">
                {calConsumed > calTarget ? (
                  <span style={{ color: 'var(--red)', fontWeight: 600 }}>+{Math.round(calConsumed - calTarget)} {t('kcal over')}</span>
                ) : (
                  <span>{calRemaining} {t('kcal left')}</span>
                )}
              </div>
            </div>

            {/* Progress Bar */}
            <div style={{ height: 8, background: 'var(--surface-3)', borderRadius: 99, overflow: 'hidden', marginBottom: 16 }}>
              <div
                style={{
                  height: '100%',
                  width: `${calPct}%`,
                  background: calConsumed > calTarget ? 'var(--red)' : 'var(--acc)',
                  borderRadius: 99,
                  transition: 'width 0.4s ease'
                }}
              />
            </div>

            {/* Macro Summary Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              <div style={{ background: 'var(--surface-2)', padding: '10px 8px', borderRadius: 10, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--blue)', fontWeight: 600, textTransform: 'uppercase' }}>{t('Protein')}</div>
                <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>{Math.round(totals.protein_g)}g</div>
                <div className="muted" style={{ fontSize: 10 }}>/ {targets.protein_target_g}g</div>
              </div>
              <div style={{ background: 'var(--surface-2)', padding: '10px 8px', borderRadius: 10, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--orange)', fontWeight: 600, textTransform: 'uppercase' }}>{t('Carbs')}</div>
                <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>{Math.round(totals.carb_g)}g</div>
                <div className="muted" style={{ fontSize: 10 }}>/ {targets.carb_target_g}g</div>
              </div>
              <div style={{ background: 'var(--surface-2)', padding: '10px 8px', borderRadius: 10, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--yellow)', fontWeight: 600, textTransform: 'uppercase' }}>{t('Fat')}</div>
                <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>{Math.round(totals.fat_g)}g</div>
                <div className="muted" style={{ fontSize: 10 }}>/ {targets.fat_target_g}g</div>
              </div>
              <div style={{ background: 'var(--surface-2)', padding: '10px 8px', borderRadius: 10, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600, textTransform: 'uppercase' }}>{t('Fibre')}</div>
                <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>{Math.round(totals.fibre_g)}g</div>
                <div className="muted" style={{ fontSize: 10 }}>/ {targets.fibre_target_g}g</div>
              </div>
            </div>
          </div>

          {/* Meal Categories Sections */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {MEAL_TYPES.map(m => {
              const mealItems = logs.filter(l => l.meal_type === m.id)
              const mealCals = Math.round(mealItems.reduce((acc, curr) => acc + (curr.energy_kcal || 0), 0))

              return (
                <div key={m.id} className="card" style={{ padding: '14px 16px' }}>
                  <div className="row between" style={{ marginBottom: 10 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <span className="lrow-i" style={{ background: m.color, width: 26, height: 26, borderRadius: 6, fontSize: 15 }}>
                        <Icon name={m.icon} />
                      </span>
                      <span style={{ fontWeight: 600, fontSize: 16 }}>{t(m.label)}</span>
                    </div>
                    <div className="row" style={{ gap: 10 }}>
                      <span className="muted small" style={{ fontWeight: 500 }}>{mealCals} kcal</span>
                      <button
                        className="btn xs tinted"
                        onClick={() => handleOpenFoodSearch(m.id)}
                        title={t('Search food')}
                      >
                        <Icon name="plus" /> {t('Add')}
                      </button>
                    </div>
                  </div>

                  {mealItems.length > 0 ? (
                    <div className="list">
                      {mealItems.map(item => (
                        <div key={item.id} className="item" style={{ padding: '8px 4px', borderBottom: 'var(--hair) solid var(--sep)' }}>
                          <div className="grow">
                            <div style={{ fontWeight: 500, fontSize: 15 }}>{item.food_name}</div>
                            <div className="muted small">
                              {item.serving_quantity} {item.serving_unit} ({item.serving_grams}g) · P: {item.protein_g}g · C: {item.carb_g}g · F: {item.fat_g}g
                            </div>
                          </div>
                          <div className="row" style={{ gap: 8 }}>
                            <span style={{ fontWeight: 600, fontSize: 14 }}>{Math.round(item.energy_kcal)} kcal</span>
                            <button
                              className="iconbtn"
                              style={{ width: 28, height: 28, fontSize: 14, color: 'var(--red)' }}
                              onClick={() => handleDeleteEntry(item)}
                              title={t('Delete item')}
                            >
                              <Icon name="trash" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="muted small" style={{ padding: '6px 0', fontSize: 13 }}>
                      {t('No items logged yet')}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Right Column: AI / Natural Language Nutrition Calculator */}
        <div>
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="row between" style={{ marginBottom: 6 }}>
              <div className="row" style={{ gap: 8 }}>
                <span className="lrow-i" style={{ background: 'var(--purple)', width: 28, height: 28, borderRadius: 7, fontSize: 16 }}>
                  <Icon name="sparkles" />
                </span>
                <span style={{ fontWeight: 600, fontSize: 17 }}>{t('AI Meal Calculator')}</span>
              </div>
              <span className="chip sm nocap" style={{ background: 'var(--surface-2)', fontSize: 11, color: 'var(--purple)', fontWeight: 600 }}>
                <Icon name="sparkles" style={{ marginRight: 4 }} />
                {t('AI Estimated Nutrition')}
              </span>
            </div>
            <p className="muted small" style={{ marginBottom: 12 }}>
              {t('Describe your meal, ingredients, or recipes. Powered by Google Gemini AI to analyze each food into separate items with clinical nutritional estimates you can review and edit.')}
            </p>

            {/* Input Text Area */}
            <textarea
              rows={3}
              placeholder={t('e.g. 200 g overnight-soaked oats with 5 almonds and 5 grapes\nor: 2 idlis with sambar\nor: 100 g cooked rice with 150 g chicken breast')}
              value={nlInput}
              disabled={analyzing}
              onChange={e => {
                setNlInput(e.target.value)
                if (analysisError) setAnalysisError(null)
              }}
              style={{
                width: '100%',
                padding: '12px 14px',
                background: 'var(--surface-2)',
                border: '1px solid var(--surface-3)',
                borderRadius: 12,
                color: 'var(--label)',
                fontSize: 15,
                lineHeight: 1.4,
                resize: 'vertical',
                marginBottom: 10
              }}
            />

            {/* Quick Prompt Chips */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              {QUICK_EXAMPLES.map((ex, i) => (
                <button
                  key={i}
                  className="chip sm nocap"
                  disabled={analyzing}
                  onClick={() => {
                    setNlInput(ex)
                    if (analysisError) setAnalysisError(null)
                  }}
                  style={{ background: 'var(--surface-2)', cursor: 'pointer', fontSize: 12 }}
                >
                  {ex}
                </button>
              ))}
            </div>

            <Button
              variant="primary"
              icon={analyzing ? "spinner" : "sparkles"}
              disabled={!nlInput.trim() || analyzing}
              onClick={handleAnalyzeMeal}
            >
              {analyzing ? t('Analyzing meal with Gemini AI...') : t('Calculate Nutrition')}
            </Button>

            {/* Error / Quota Alert & Retry State */}
            {analysisError && (
              <div
                className="card"
                style={{
                  marginTop: 12,
                  marginBottom: 0,
                  border: isQuotaError ? '1px solid var(--orange)' : '1px solid var(--red)',
                  background: isQuotaError ? 'color-mix(in srgb, var(--orange) 10%, var(--surface-1))' : 'color-mix(in srgb, var(--red) 10%, var(--surface-1))',
                  padding: '12px 14px',
                  animation: 'slideup 0.2s ease'
                }}
              >
                <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                  <Icon
                    name={isQuotaError ? "triangle-exclamation" : "circle-exclamation"}
                    style={{ fontSize: 18, color: isQuotaError ? 'var(--orange)' : 'var(--red)', marginTop: 2 }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: isQuotaError ? 'var(--orange)' : 'var(--red)', marginBottom: 4 }}>
                      {isQuotaError ? t('Gemini Quota Exceeded') : t('Calculation Error')}
                    </div>
                    <div className="small" style={{ color: 'var(--label)', lineHeight: 1.4, marginBottom: 10 }}>
                      {analysisError}
                    </div>
                    <Button
                      variant="secondary"
                      icon="arrow-rotate-right"
                      onClick={handleAnalyzeMeal}
                      disabled={analyzing || !nlInput.trim()}
                      style={{ fontSize: 13, padding: '4px 10px' }}
                    >
                      {isQuotaError ? t('Retry') : t('Retry Calculation')}
                    </Button>
                  </div>
                  <button
                    className="iconbtn"
                    style={{ width: 22, height: 22, fontSize: 11 }}
                    onClick={() => { setAnalysisError(null); setIsQuotaError(false); }}
                  >
                    <Icon name="xmark" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Parsed AI Analysis Panel */}
          {parsedMeal && (
            <div className="card" style={{ border: '1px solid var(--acc)', animation: 'slideup 0.2s ease' }}>
              <div className="row between" style={{ marginBottom: 8, alignItems: 'center' }}>
                <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600, fontSize: 16 }}>{t('AI Estimated Nutrition')}</span>
                  <span className="chip sm nocap" style={{ background: 'color-mix(in srgb, var(--purple) 18%, transparent)', color: 'var(--purple)', fontSize: 11, fontWeight: 600 }}>
                    <Icon name="sparkles" style={{ marginRight: 4 }} />
                    {t('Google Gemini')}
                  </span>
                  {parsedMeal.calculation_status === 'complete' && (
                    <span className="chip sm" style={{ background: 'color-mix(in srgb, var(--green) 18%, transparent)', color: 'var(--green)', fontSize: 11 }}>
                      {t('Complete')}
                    </span>
                  )}
                  {parsedMeal.calculation_status === 'needs_clarification' && (
                    <span className="chip sm" style={{ background: 'color-mix(in srgb, var(--orange) 18%, transparent)', color: 'var(--orange)', fontSize: 11 }}>
                      {t('Needs Clarification')}
                    </span>
                  )}
                  {parsedMeal.calculation_status === 'approximate' && (
                    <span className="chip sm" style={{ background: 'color-mix(in srgb, var(--acc) 18%, transparent)', color: 'var(--acc)', fontSize: 11 }}>
                      {t('Approximate')}
                    </span>
                  )}
                </div>
                <button
                  className="iconbtn"
                  style={{ width: 26, height: 26, fontSize: 13 }}
                  onClick={() => setParsedMeal(null)}
                >
                  <Icon name="xmark" />
                </button>
              </div>

              {parsedMeal.input_summary && (
                <div className="muted small" style={{ marginBottom: 12, fontStyle: 'italic' }}>
                  "{parsedMeal.input_summary}"
                </div>
              )}

              {/* Items Breakdown */}
              <div className="list" style={{ marginBottom: 14 }}>
                {parsedMeal.items?.map((item, idx) => (
                  <div key={idx} className="item" style={{ flexDirection: 'column', alignItems: 'stretch', padding: '12px 10px', borderBottom: 'var(--hair) solid var(--sep)' }}>
                    <div className="row between" style={{ alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 15, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                          <span>{item.foodName || item.canonical_food_name || item.ingredient_name || item.food_name}</span>
                          {(item.originalText || item.original_text) && (item.originalText || item.original_text) !== (item.foodName || item.canonical_food_name || item.ingredient_name || item.food_name) && (
                            <span className="muted small" style={{ fontSize: 11, fontStyle: 'italic', fontWeight: 400 }}>
                              ("{item.originalText || item.original_text}")
                            </span>
                          )}
                          {(item.preparation || item.prep_state) && (
                            <span className="chip sm nocap" style={{ fontSize: 10, background: 'var(--surface-3)', padding: '2px 6px' }}>
                              {item.preparation || item.prep_state}
                            </span>
                          )}
                          {item.is_weight_estimated ? (
                            <span className="chip sm nocap" style={{ fontSize: 10, background: 'color-mix(in srgb, var(--orange) 14%, transparent)', color: 'var(--orange)', padding: '2px 6px' }}>
                              {t('Est. weight')}
                            </span>
                          ) : (
                            <span className="chip sm nocap" style={{ fontSize: 10, background: 'color-mix(in srgb, var(--green) 14%, transparent)', color: 'var(--green)', padding: '2px 6px' }}>
                              {t('Exact')}
                            </span>
                          )}
                          {item.confidence && (
                            <span className="chip sm nocap" style={{
                              fontSize: 10,
                              background: item.confidence === 'high' ? 'color-mix(in srgb, var(--green) 14%, transparent)' : item.confidence === 'low' ? 'color-mix(in srgb, var(--orange) 14%, transparent)' : 'var(--surface-3)',
                              color: item.confidence === 'high' ? 'var(--green)' : item.confidence === 'low' ? 'var(--orange)' : 'var(--label)',
                              padding: '2px 6px'
                            }}>
                              {item.confidence} {t('confidence')}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                        <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--acc)' }}>
                          {item.energy_kcal ?? item.nutrients?.energy_kcal} kcal
                        </span>
                        <button
                          className="iconbtn"
                          style={{ width: 24, height: 24, fontSize: 12, color: 'var(--muted)' }}
                          onClick={() => handleRemoveParsedItem(idx)}
                          title={t('Remove from meal')}
                        >
                          <Icon name="xmark" />
                        </button>
                      </div>
                    </div>

                    {/* Interactive Portion Editor */}
                    <div className="row between" style={{ marginTop: 8, flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                      <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                        <label className="muted small" style={{ fontSize: 12 }}>{t('Portion:')}</label>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={item.explicit_quantity ?? item.quantity ?? 1}
                          onChange={e => handleUpdateItemPortion(idx, e.target.value)}
                          style={{
                            width: 60,
                            padding: '4px 6px',
                            borderRadius: 6,
                            border: '1px solid var(--surface-3)',
                            background: 'var(--surface-2)',
                            color: 'var(--label)',
                            fontSize: 13,
                            textAlign: 'center'
                          }}
                        />
                        <span className="muted small">
                          {item.quantity_unit || item.unit} ({item.estimated_weight_g ?? item.grams}g)
                        </span>
                      </div>
                      <span className="muted small" style={{ fontWeight: 500 }}>
                        P: {item.protein_g ?? item.nutrients?.protein_g}g · C: {item.carb_g ?? item.nutrients?.carb_g}g · F: {item.fat_g ?? item.nutrients?.fat_g}g · Fib: {item.fibre_g ?? item.nutrients?.fibre_g}g
                      </span>
                    </div>

                    {/* Assumptions */}
                    {item.assumptions && item.assumptions.length > 0 && (
                      <div style={{ marginTop: 6, padding: '4px 8px', background: 'var(--surface-2)', borderRadius: 6, fontSize: 12, color: 'var(--muted)' }}>
                        {item.assumptions.map((assump, aIdx) => (
                          <div key={aIdx} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Icon name="circle-info" style={{ fontSize: 11, color: 'var(--acc)' }} />
                            <span>{assump}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Clarification Questions */}
                    {item.clarification_questions && item.clarification_questions.length > 0 && (
                      <div style={{ marginTop: 6, padding: '6px 10px', background: 'color-mix(in srgb, var(--orange) 14%, transparent)', borderRadius: 6, fontSize: 12, color: 'var(--orange)' }}>
                        {item.clarification_questions.map((qText, qIdx) => (
                          <div key={qIdx} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Icon name="triangle-exclamation" style={{ fontSize: 12 }} />
                            <span>{qText}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Meal Total Summary */}
              <div style={{ background: 'var(--surface-2)', padding: '12px 14px', borderRadius: 10, marginBottom: 12 }}>
                <div className="row between" style={{ fontWeight: 700, fontSize: 17, marginBottom: 4 }}>
                  <span>{t('Total Meal Nutrition')}</span>
                  <span className="accent">{parsedMeal.totals?.calories ?? parsedMeal.totals?.energy_kcal} kcal</span>
                </div>
                <div className="muted small row between" style={{ flexWrap: 'wrap', gap: 8 }}>
                  <span>{t('Protein: {0}g', parsedMeal.totals?.protein ?? parsedMeal.totals?.protein_g)}</span>
                  <span>{t('Carbs: {0}g', parsedMeal.totals?.carbohydrates ?? parsedMeal.totals?.carb_g)}</span>
                  <span>{t('Fat: {0}g', parsedMeal.totals?.fat ?? parsedMeal.totals?.fat_g)}</span>
                  <span>{t('Fibre: {0}g', parsedMeal.totals?.fibre ?? parsedMeal.totals?.fibre_g)}</span>
                </div>
                {parsedMeal.reconciliation_notes && (
                  <div className="muted small" style={{ marginTop: 8, fontSize: 11, borderTop: 'var(--hair) solid var(--sep)', paddingTop: 6 }}>
                    <Icon name="check" style={{ marginRight: 4, color: 'var(--green)' }} />
                    {parsedMeal.reconciliation_notes}
                  </div>
                )}
              </div>

              {/* Clarification Questions across meal */}
              {parsedMeal.clarifications && parsedMeal.clarifications.length > 0 && (
                <div style={{ marginBottom: 12, padding: '8px 12px', background: 'color-mix(in srgb, var(--orange) 12%, transparent)', borderRadius: 8, fontSize: 12, color: 'var(--orange)' }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('Clarification Questions:')}</div>
                  {parsedMeal.clarifications.map((cl, ci) => (
                    <div key={ci}>• {cl}</div>
                  ))}
                </div>
              )}

              {/* AI Disclaimer */}
              <div className="muted small" style={{ marginBottom: 14, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 11 }}>
                <Icon name="shield-halved" style={{ marginRight: 6, color: 'var(--acc)' }} />
                {parsedMeal.disclaimer || t('Nutritional values are AI-generated clinical estimates based on standard nutritional composition references, not laboratory-verified measurements. Portions and values are editable before logging.')}
              </div>

              {/* Meal Selection and Add Action */}
              <div className="row between" style={{ marginBottom: 12 }}>
                <span className="muted small">{t('Log to meal:')}</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  {MEAL_TYPES.map(m => (
                    <button
                      key={m.id}
                      className={`btn xs ${selectedMealType === m.id ? 'primary' : ''}`}
                      onClick={() => setSelectedMealType(m.id)}
                    >
                      {t(m.label)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="row" style={{ gap: 10 }}>
                <Button variant="primary" icon="check" onClick={handleConfirmAndAddMeal}>
                  {t('Review & Add to {0}', MEAL_TYPES.find(m => m.id === selectedMealType)?.label || selectedMealType)}
                </Button>
                <Button variant="ghost" onClick={() => setParsedMeal(null)}>
                  {t('Cancel')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
