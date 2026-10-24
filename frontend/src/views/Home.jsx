import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { effectiveRoutine, effectiveRoutineId, streakWeeks, lastBW, setsDoneActive } from '../lib/history.js'
import { fmtNum, fmtDate, todayISO, isoOf, weekKey, DAYS, DAYN } from '../lib/format.js'
import { t, dateLocale } from '../lib/i18n.js'
import { bwSheet, goalSheet, dayOverrideSheet, calendarSheet, startFlow, loadStarterPlan, bwDeltaColor } from '../sheets.jsx'
import LineChart from '../components/LineChart.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { glyphOf } from '../lib/glyphs.js'
import { coachAvailable, hasConsent } from '../lib/coach.js'
import { useCoachStatus } from '../lib/coach-api.js'
import { DEMO } from '../lib/demo.js'
import { MOBILE } from '../lib/mobile.js'

function CoachCard({ nav }) {
  const S = useStore(s => s.S)
  const { job, pending } = useCoachStatus(hasConsent(S))
  if (!hasConsent(S) || (!job && !pending)) return null
  const ready = !!pending
  return (
    <div className="card" style={ready ? { borderColor: 'var(--acc)' } : null}>
      <div className="today-row" onClick={() => nav(ready ? '/coach/proposal' : '/coach')} style={{ cursor: 'pointer' }}>
        <div className="row" style={{ gap: 10, minWidth: 0 }}>
          <span className="lrow-i" style={{ background: ready ? 'var(--acc)' : 'var(--coral)' }}><Icon name="sparkles" /></span>
          <div style={{ minWidth: 0 }}>
            <div className="lbl2">{t('Coach')}</div>
            <div className="ttl" style={{ fontWeight: 600 }}>{ready
              ? (pending.kind === 'create'
                ? t('Your plan is ready')
                : t(pending.changes?.length === 1 ? '{0} suggestion for you' : '{0} suggestions for you', pending.changes?.length || 0))
              : t('Reading your training…')}</div>
          </div>
        </div>
        {ready ? <span className="tag acc">{t('Review')}</span> : <Icon name="chevronRight" className="chev" />}
      </div>
    </div>
  )
}

export default function Home() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const config = useStore(s => s.config)
  const [weekOffset, setWeekOffset] = useState(0)
  const coachOn = coachAvailable(config, user, { demo: DEMO, mobile: MOBILE })

  const today = new Date()
  const todayStr = todayISO()
  const routine = effectiveRoutine(S, todayStr)
  const todayOvr = S.dayPlan[todayStr] !== undefined
  const bw = lastBW(S)
  const prevBW = S.bodyweight.length > 1 ? S.bodyweight[S.bodyweight.length - 2] : null
  const delta = bw && prevBW ? bw.w - prevBW.w : null

  // Read today's health log (food, water, cardio)
  const todayHealth = useMemo(() => {
    try {
      const stored = localStorage.getItem(`opengym_health_${todayStr}`)
      if (stored) return JSON.parse(stored)
    } catch (e) {}
    return null
  }, [todayStr, S.meals])

  const foodsToday = todayHealth?.foods || (S.meals || []).filter(m => m.d === todayStr || m.date === todayStr)
  const foodCount = foodsToday.length
  const waterLogs = todayHealth?.water || []
  const waterLitres = Math.round((waterLogs.reduce((a, w) => a + (Number(w.millilitres) || 0), 0) / 1000) * 10) / 10
  const waterGoal = S.nutritionTargets?.waterGoal || 2.5
  const waterPercent = Math.min(100, Math.round((waterLitres / waterGoal) * 100))

  const cardioLogs = todayHealth?.cardio || []
  const recordedSteps = cardioLogs.reduce((acc, c) => acc + (Number(c.steps) || 0), 0)
  const cardioMin = cardioLogs.reduce((acc, c) => acc + (Number(c.duration_minutes) || 0), 0)

  // Workouts today
  const todayWorkout = S.workouts.find(w => w.d === todayStr)
  const workoutDurMin = todayWorkout ? Math.round((todayWorkout.dur || 0) / 60000) : 0
  const activeWorkoutMin = S.active ? Math.max(1, Math.round((Date.now() - S.active.start) / 60000)) : 0
  const totalWorkoutMin = workoutDurMin || activeWorkoutMin

  const targetCalories = S.nutritionTargets?.calorie || S.nutritionTargets?.calories || 1900

  // Calculate today's real progress score (0 to 100%) based on actual recorded activities
  let progressScore = 0
  if (todayWorkout) progressScore += 50
  else if (S.active) progressScore += 25
  if (foodCount > 0) progressScore += Math.min(25, foodCount * 10)
  if (waterLitres > 0) progressScore += Math.min(25, Math.round((waterLitres / waterGoal) * 25))

  // Week strip calculation
  const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7) + weekOffset * 7)
  const doneDays = new Set(S.workouts.map(w => w.d))
  const weekData = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday); d.setDate(monday.getDate() + i)
    const iso = isoOf(d)
    const eff = effectiveRoutineId(S, iso)
    const ovr = S.dayPlan[iso] !== undefined
    const done = doneDays.has(iso)
    const dayWorkout = S.workouts.find(w => w.d === iso)
    const durM = dayWorkout ? Math.round((dayWorkout.dur || 0) / 60000) : 0
    // Fill height percentage: 100% for full workout, 40% if planned, 15% minimum track
    const fillPercent = done ? Math.min(100, Math.max(35, durM > 0 ? (durM / 60) * 100 : 75)) : eff ? 35 : 12

    weekData.push({
      iso,
      dayName: DAYS[d.getDay()],
      dateNum: d.getDate(),
      isToday: iso === todayStr,
      done,
      ovr,
      planned: !!eff,
      fillPercent,
      workout: dayWorkout
    })
  }

  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6)
  const wkLabel = weekOffset === 0
    ? t('This week')
    : `${monday.getDate()} ${monday.toLocaleDateString(dateLocale(), { month: 'short' })} – ${sunday.getDate()} ${sunday.toLocaleDateString(dateLocale(), { month: 'short' })}`

  const wThisWeek = S.workouts.filter(w => weekKey(w.d) === weekKey(todayStr)).length
  const plannedPerWeek = Object.keys(S.week).filter(k => S.week[k]).length
  const bwPoints = S.bodyweight.slice(-30).map(b => ({ t: b.t || new Date(b.d).getTime(), y: b.w, d: b.d }))

  const onToday = () => {
    if (S.active) nav('/workout')
    else if (routine) startFlow(routine.id)
    else dayOverrideSheet(todayStr)
  }

  // SVG circular progress ring calculations
  const radius = 40
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (progressScore / 100) * circumference

  return (
    <div className="narrow">
      {/* Header — Greeting inspired by Phone 2 in reference image */}
      <div className="hdr" style={{ alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            onClick={() => nav('/settings')}
            style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              background: 'var(--mint-light)',
              color: 'var(--mint)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 24,
              cursor: 'pointer',
              flex: 'none'
            }}
            title={t('Settings')}
          >
            <Icon name="personCircle" />
          </div>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>
              {user ? t('Hi, {0} 👋', user.name) : 'Hi, Alex 👋'}
            </h1>
            <div className="sub" style={{ fontSize: 13, color: 'var(--label-2)', marginTop: 2 }}>
              {t('Ready to crush your goals?')}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            className="iconbtn"
            onClick={() => nav('/nutrition')}
            aria-label={t('Daily Health Log')}
            title={t('Daily Health Log')}
          >
            <Icon name="bell" />
          </button>
          <button
            className="iconbtn"
            onClick={() => nav('/settings')}
            aria-label={t('Settings')}
            title={t('Settings')}
          >
            <Icon name="gear" />
          </button>
        </div>
      </div>

      {/* 1. Today's Progress Card — Inspired by Phone 2 in reference image */}
      <div className="progress-hero-card">
        <div className="progress-hero-ring-wrap">
          <svg className="progress-hero-svg" viewBox="0 0 100 100">
            {/* Background Track */}
            <circle
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke="var(--surface-2)"
              strokeWidth="9"
            />
            {/* Animated Progress Stroke */}
            <circle
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke="var(--mint)"
              strokeWidth="9"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              style={{ transition: 'stroke-dashoffset 0.6s ease' }}
            />
          </svg>
          <div className="progress-hero-center">
            <span className="progress-hero-percent">{progressScore}%</span>
          </div>
        </div>

        <div className="progress-hero-metrics">
          <div className="progress-hero-metric-row">
            <div className="progress-hero-metric-label">
              <span className="progress-hero-metric-dot" style={{ background: 'var(--mint)' }} />
              <span>{t('Workout')}</span>
            </div>
            <span className="progress-hero-metric-val">
              {totalWorkoutMin > 0 ? `${totalWorkoutMin} min` : (routine ? routine.name : t('Rest day'))}
            </span>
          </div>

          <div className="progress-hero-metric-row">
            <div className="progress-hero-metric-label">
              <span className="progress-hero-metric-dot" style={{ background: 'var(--coral)' }} />
              <span>{t('Target')}</span>
            </div>
            <span className="progress-hero-metric-val">{targetCalories} kcal</span>
          </div>

          <div className="progress-hero-metric-row">
            <div className="progress-hero-metric-label">
              <span className="progress-hero-metric-dot" style={{ background: 'var(--teal)' }} />
              <span>{t('Steps')}</span>
            </div>
            <span className="progress-hero-metric-val">
              {recordedSteps > 0 ? recordedSteps.toLocaleString() : '0'}
            </span>
          </div>

          <div className="progress-hero-metric-row">
            <div className="progress-hero-metric-label">
              <span className="progress-hero-metric-dot" style={{ background: 'var(--lavender)' }} />
              <span>{t('Water')}</span>
            </div>
            <span className="progress-hero-metric-val">
              {waterLitres} L <span style={{ color: 'var(--label-2)', fontWeight: 400, fontSize: 11 }}>/ {waterGoal}L</span>
            </span>
          </div>
        </div>
      </div>

      {/* 2. Weekly Activity Card — 7 vertical pill bars matching Phone 2 */}
      <div className="weekly-activity-card">
        <div className="row between" style={{ marginBottom: 6 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--label)' }}>
            {t('Weekly Activity')}
          </h2>
          <div className="row" style={{ gap: 4, alignItems: 'center' }}>
            <button
              className="iconbtn"
              style={{ width: 28, height: 28, fontSize: 13 }}
              onClick={() => setWeekOffset(w => w - 1)}
              aria-label="Previous week"
            >
              <Icon name="chevronLeft" />
            </button>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--label-2)' }}>{wkLabel}</span>
            <button
              className="iconbtn"
              style={{ width: 28, height: 28, fontSize: 13 }}
              onClick={() => setWeekOffset(w => w + 1)}
              aria-label="Next week"
            >
              <Icon name="chevronRight" />
            </button>
          </div>
        </div>

        <div className="weekly-activity-strip">
          {weekData.map((d, idx) => (
            <div
              key={idx}
              className={`weekly-bar-col ${d.isToday ? 'active' : ''} ${d.done ? 'completed' : ''}`}
              onClick={() => dayOverrideSheet(d.iso)}
              title={`${d.dayName} ${d.dateNum}: ${d.done ? 'Completed' : d.planned ? 'Planned' : 'Rest'}`}
            >
              <div className="weekly-bar-track">
                <div
                  className="weekly-bar-fill"
                  style={{ height: `${d.fillPercent}%` }}
                />
              </div>
              <span className="weekly-bar-day">{d.dayName.slice(0, 1)}</span>
              <div className="weekly-bar-dot" />
            </div>
          ))}
        </div>
      </div>

      {/* 3. Quick Actions 2x2 Grid — Phone 2 in reference image */}
      <div className="quick-actions-grid">
        <div className="quick-action-card" onClick={onToday}>
          <div className="quick-action-icon mint">
            <Icon name={S.active ? 'play' : 'dumbbell'} />
          </div>
          <div className="quick-action-title">
            {S.active ? t('Resume Workout') : t('Start Workout')}
          </div>
          <div className="quick-action-desc">
            {S.active ? t('In progress') : (routine ? routine.name : t('Pick routine'))}
          </div>
        </div>

        <div className="quick-action-card" onClick={() => nav('/nutrition')}>
          <div className="quick-action-icon coral">
            <Icon name="apple" />
          </div>
          <div className="quick-action-title">{t('Log Food')}</div>
          <div className="quick-action-desc">
            {foodCount > 0 ? t('{0} entries today', foodCount) : t('Manual logging')}
          </div>
        </div>

        <div className="quick-action-card" onClick={() => bwSheet()}>
          <div className="quick-action-icon lavender">
            <Icon name="scale" />
          </div>
          <div className="quick-action-title">{t('Body Stats')}</div>
          <div className="quick-action-desc">
            {bw ? `${fmtNum(bw.w)} ${S.unit}` : t('Record weight')}
          </div>
        </div>

        <div className="quick-action-card" onClick={() => nav('/nutrition')}>
          <div className="quick-action-icon amber">
            <Icon name="clipboard" />
          </div>
          <div className="quick-action-title">{t('Daily Report')}</div>
          <div className="quick-action-desc">{t('Export ChatGPT PDF')}</div>
        </div>
      </div>

      {coachOn && <CoachCard nav={nav} />}

      {/* Today's Routine / Active Banner */}
      <div
        className="card tappable"
        style={{ cursor: 'pointer', borderLeft: S.active ? '4px solid var(--coral)' : routine ? '4px solid var(--mint)' : undefined }}
        onClick={onToday}
      >
        <div className="row between">
          <div className="row" style={{ gap: 12, minWidth: 0 }}>
            <span
              className="lrow-i"
              style={{
                background: S.active ? 'var(--coral)' : routine ? 'var(--mint)' : 'var(--surface-3)',
                width: 38,
                height: 38,
                borderRadius: 12,
                fontSize: 18
              }}
            >
              <Icon name={S.active ? 'timer' : routine ? glyphOf(routine.emoji) : 'moon'} />
            </span>
            <div style={{ minWidth: 0 }}>
              <div className="lbl2" style={{ fontSize: 12, color: 'var(--label-2)' }}>{t('Today\'s Session')}</div>
              <div className="ttl" style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>
                {S.active ? t('{0} — in progress', S.active.name) : routine ? routine.name : t('Rest day')}
                {todayOvr && routine ? ' · ' + t('rescheduled') : ''}
              </div>
            </div>
          </div>
          {S.active ? (
            <span className="tag" style={{ color: 'var(--coral)', background: 'var(--coral-light)', fontWeight: 600 }}>
              {t('Resume')} &rarr;
            </span>
          ) : routine ? (
            <span className="tag acc" style={{ fontWeight: 600 }}>
              {t('Start')} &rarr;
            </span>
          ) : (
            <Icon name="plus" className="chev" />
          )}
        </div>
      </div>

      {!S.routines.length && !S.active && (
        <div className="card">
          <div className="row" style={{ gap: 10, marginBottom: 6 }}>
            <span className="lrow-i" style={{ background: 'var(--mint)' }}><Icon name="sparkles" /></span>
            <div className="big" style={{ fontSize: 20 }}>{t('Welcome!')}</div>
          </div>
          <div className="muted small" style={{ marginBottom: 12 }}>
            {t('Set up your weekly routine to get going — or load a ready-made Push / Pull / Legs plan.')}
          </div>
          {coachOn && (
            <>
              <Button variant="primary" icon="sparkles" onClick={() => nav(hasConsent(S) ? '/coach/intake' : '/coach')}>
                {t('Let the Coach build it')}
              </Button>
              <div style={{ height: 8 }} />
            </>
          )}
          <Button variant={coachOn ? 'plain' : 'primary'} icon="sparkles" onClick={loadStarterPlan}>
            {t('Load starter plan (PPL)')}
          </Button>
          <div style={{ height: 8 }} />
          <Button onClick={() => nav('/plan')}>{t('Build my own plan')}</Button>
        </div>
      )}

      {/* Body weight card */}
      <div className="card">
        <div className="row between" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--label)' }}>{t('Body weight')}</h2>
          <div className="row" style={{ gap: 8 }}>
            <Button size="sm" icon="target" style={S.targetW ? { color: 'var(--amber)' } : undefined} onClick={goalSheet}>
              {S.targetW ? fmtNum(S.targetW) : t('Goal')}
            </Button>
            <Button size="sm" icon="plus" onClick={() => bwSheet()}>{t('Log')}</Button>
          </div>
        </div>
        {bw ? (
          <>
            <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
              <div className="big">{fmtNum(bw.w)} <span className="muted" style={{ fontSize: '1rem', fontWeight: 500 }}>{S.unit}</span></div>
              {!!delta && (
                <span className="small row" style={{ gap: 2, fontWeight: 600, color: bwDeltaColor(delta, bw.w) }}>
                  <Icon name={delta > 0 ? 'arrowUp' : 'arrowDown'} style={{ fontSize: 12 }} />
                  {fmtNum(Math.abs(delta))}
                </span>
              )}
              <span className="dim small" style={{ marginLeft: 'auto' }}>{fmtDate(bw.d, true)}</span>
            </div>
            {S.targetW && (
              <div className="small row" style={{ color: 'var(--amber)', marginTop: 4, gap: 5 }}>
                <Icon name="target" style={{ fontSize: 13 }} />
                <span>
                  {t('Goal')} {fmtNum(S.targetW)} {S.unit} · {Math.abs(S.targetW - bw.w) < 0.05 ? t('reached!') : t(S.targetW > bw.w ? '{0} to gain' : '{0} to lose', fmtNum(Math.abs(S.targetW - bw.w)) + ' ' + S.unit)}
                </span>
              </div>
            )}
            <div className="chart" style={{ marginTop: 10 }}>
              <LineChart points={bwPoints} h={130} unit={S.unit} goal={S.targetW} />
            </div>
          </>
        ) : (
          <div className="muted small">{t("No entries yet — log your weight to start the curve. It's also asked before every workout.")}</div>
        )}
      </div>

      {/* Week streak card */}
      <div className="card tappable" style={{ cursor: 'pointer' }} onClick={() => calendarSheet()}>
        <div className="row between">
          <div>
            <div className="row" style={{ gap: 8, fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>
              <span style={{ color: 'var(--coral)' }}><Icon name="flame" /></span>
              {t('{0} week streak', streakWeeks(S))}
            </div>
            <div className="muted small" style={{ marginTop: 3 }}>
              {wThisWeek}{plannedPerWeek ? ' / ' + plannedPerWeek : ''} {t('this week')} · {t(S.workouts.length === 1 ? '{0} workout total' : '{0} workouts total', S.workouts.length)}
            </div>
          </div>
          <Icon name="calendar" className="chev" style={{ fontSize: 20 }} />
        </div>
      </div>
    </div>
  )
}
