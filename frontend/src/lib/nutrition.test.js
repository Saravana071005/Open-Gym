import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../store/useStore.js'

describe('Nutrition Store & State Management', () => {
  beforeEach(() => {
    // Reset store state
    const storage = {}
    globalThis.localStorage = {
      getItem: k => storage[k] || null,
      setItem: (k, v) => { storage[k] = String(v) },
      removeItem: k => { delete storage[k] }
    }
    const curS = useStore.getState().S || {}
    useStore.setState({
      S: {
        ...curS,
        meals: [],
        nutritionTargets: {
          calories: 2000,
          protein: 140,
          carbs: 220,
          fat: 60,
          fibre: 30
        }
      }
    })
  })

  it('initializes with default nutrition targets and empty meals array', () => {
    const state = useStore.getState()
    expect(Array.isArray(state.S.meals)).toBe(true)
    expect(state.S.nutritionTargets.calories).toBe(2000)
    expect(state.S.nutritionTargets.protein).toBe(140)
  })

  it('updates nutrition targets properly', () => {
    const setTargets = useStore.getState().setNutritionTargets
    setTargets({ calories: 2400, protein: 180, carbs: 260, fat: 70, fibre: 35 })
    const state = useStore.getState()
    expect(state.S.nutritionTargets.calories).toBe(2400)
    expect(state.S.nutritionTargets.protein).toBe(180)
  })

  it('logs a new meal item and recalculates meal list', () => {
    const logMeal = useStore.getState().logMeal
    const newMeal = logMeal({
      d: '2026-10-11',
      type: 'breakfast',
      foodId: 'STAPLE:roti',
      name: 'Wheat Roti / Chapati',
      qty: 2,
      unit: 'piece',
      grams: 70,
      nutrients: {
        calories: 208,
        protein: 6.3,
        carbs: 45,
        fat: 2.1,
        fibre: 4.2
      }
    })

    expect(newMeal.id).toBeDefined()
    expect(newMeal.type).toBe('breakfast')
    const state = useStore.getState()
    expect(state.S.meals.length).toBe(1)
    expect(state.S.meals[0].nutrients.calories).toBe(208)
  })

  it('updates an existing meal item quantity and nutrients', () => {
    const { logMeal, updateMeal } = useStore.getState()
    const meal = logMeal({
      d: '2026-10-11',
      type: 'lunch',
      foodId: 'STAPLE:cooked_rice',
      name: 'Cooked Rice',
      qty: 150,
      unit: 'g',
      grams: 150,
      nutrients: { calories: 195, protein: 4.1, carbs: 42.3, fat: 0.5, fibre: 0.6 }
    })

    updateMeal(meal.id, {
      qty: 300,
      grams: 300,
      nutrients: { calories: 390, protein: 8.2, carbs: 84.6, fat: 1.0, fibre: 1.2 }
    })

    const state = useStore.getState()
    const updated = state.S.meals.find(m => m.id === meal.id)
    expect(updated.qty).toBe(300)
    expect(updated.nutrients.calories).toBe(390)
  })

  it('deletes an existing meal cleanly', () => {
    const { logMeal, deleteMeal } = useStore.getState()
    const meal1 = logMeal({
      d: '2026-10-11',
      type: 'breakfast',
      foodId: 'STAPLE:roti',
      name: 'Roti',
      nutrients: { calories: 208 }
    })
    const meal2 = logMeal({
      d: '2026-10-11',
      type: 'lunch',
      foodId: 'STAPLE:chicken_cooked',
      name: 'Chicken',
      nutrients: { calories: 165 }
    })

    expect(useStore.getState().S.meals.length).toBe(2)
    deleteMeal(meal1.id)
    const state = useStore.getState()
    expect(state.S.meals.length).toBe(1)
    expect(state.S.meals[0].id).toBe(meal2.id)
  })

  it('aggregates daily calorie and macro progress accurately', () => {
    const { logMeal } = useStore.getState()
    const date = '2026-10-11'
    logMeal({
      d: date,
      type: 'breakfast',
      nutrients: { calories: 400, protein: 25, carbs: 50, fat: 10, fibre: 5 }
    })
    logMeal({
      d: date,
      type: 'lunch',
      nutrients: { calories: 750, protein: 55, carbs: 80, fat: 20, fibre: 8 }
    })
    logMeal({
      d: date,
      type: 'dinner',
      nutrients: { calories: 600, protein: 40, carbs: 65, fat: 18, fibre: 7 }
    })
    // Different date
    logMeal({
      d: '2026-10-10',
      type: 'dinner',
      nutrients: { calories: 800, protein: 50, carbs: 90, fat: 25, fibre: 10 }
    })

    const dayMeals = useStore.getState().S.meals.filter(m => m.d === date)
    expect(dayMeals.length).toBe(3)

    const totalCals = dayMeals.reduce((acc, m) => acc + m.nutrients.calories, 0)
    const totalProt = dayMeals.reduce((acc, m) => acc + m.nutrients.protein, 0)
    expect(totalCals).toBe(1750)
    expect(totalProt).toBe(120)

    const targetCals = useStore.getState().S.nutritionTargets.calories // 2000
    const remainingCals = targetCals - totalCals
    expect(remainingCals).toBe(250)
  })
})
