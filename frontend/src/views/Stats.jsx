import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { EXIDX } from '../lib/exercises.js'
import { lastBW, streakWeeks, setLabel, modeOf, effortOf } from '../lib/history.js'
import { fmtNum, fmtDate, fmtVol, todayISO, weekKey, DAYS } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { bwSheet, goalSheet, calendarSheet, workoutDetailSheet, WorkoutRow, bwDeltaColor } from '../sheets.jsx'
import LineChart from '../components/LineChart.jsx'
import Heatmap from '../components/Heatmap.jsx'
import Icon from '../components/Icon.jsx'
import BodyMap, { BodyMapLegend } from '../components/BodyMap.jsx'
import { loadOfWorkouts, rankOf, MUSCLE_NAME } from '../lib/muscles.js'
import { e1rmSeries, best1RM } from '../lib/onerm.js'
import {
  hasEffort, displayScale, scaleName, toScale, avgRir, effortSummary, effortWeeks,
  effortHistogram, isHardSet, HARD_RIR
} from '../lib/effort.js'
import { Button, Segmented, SelectRow } from '../components/ui.jsx'

// Concentric Activity Rings Component — inspired by Phone 5 in reference image
function ActivityRings({ moveVal, moveGoal, exVal, exGoal, standVal, standGoal }) {
  const p1 = Math.min(100, Math.round((moveVal / Math.max(1, moveGoal)) * 100))
  const p2 = Math.min(100, Math.round((exVal / Math.max(1, exGoal)) * 100))
  const p3 = Math.min(100, Math.round((standVal / Math.max(1, standGoal)) * 100))

  const r1 = 44, r2 = 33, r3 = 22
  const c1 = 2 * Math.PI * r1
  const c2 = 2 * Math.PI * r2
  const c3 = 2 * Math.PI * r3

  return (
    <div className="activity-rings-card">
      <div className="row between" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--label)' }}>
          {t('Activity Rings')}
        </h2>
        <span className="small muted">{t('Daily Targets')}</span>
      </div>

      <div className="activity-rings-wrap">
        <svg className="activity-rings-svg" viewBox="0 0 100 100">
          {/* Ring 1 - Move (Coral) */}
          <circle cx="50" cy="50" r={r1} fill="none" stroke="var(--coral-light)" strokeWidth="7" />
          <circle
            cx="50" cy="50" r={r1} fill="none" stroke="var(--coral)" strokeWidth="7"
            strokeDasharray={c1} strokeDashoffset={c1 - (p1 / 100) * c1}
            strokeLinecap="round" style={{ transition: 'stroke-dashoffset 0.5s ease' }}
          />

          {/* Ring 2 - Exercise (Mint) */}
          <circle cx="50" cy="50" r={r2} fill="none" stroke="var(--mint-light)" strokeWidth="7" />
          <circle
            cx="50" cy="50" r={r2} fill="none" stroke="var(--mint)" strokeWidth="7"
            strokeDasharray={c2} strokeDashoffset={c2 - (p2 / 100) * c2}
            strokeLinecap="round" style={{ transition: 'stroke-dashoffset 0.5s ease' }}
          />

          {/* Ring 3 - Hydration / Stand (Teal) */}
          <circle cx="50" cy="50" r={r3} fill="none" stroke="color-mix(in srgb, var(--teal) 20%, transparent)" strokeWidth="7" />
          <circle
            cx="50" cy="50" r={r3} fill="none" stroke="var(--teal)" strokeWidth="7"
            strokeDasharray={c3} strokeDashoffset={c3 - (p3 / 100) * c3}
            strokeLinecap="round" style={{ transition: 'stroke-dashoffset 0.5s ease' }}
          />
        </svg>

        <div className="activity-rings-legend">
          <div className="activity-ring-item">
            <div className="activity-ring-label">
              <span className="activity-ring-dot" style={{ background: 'var(--coral)' }} />
              <span>{t('Move / Target')}</span>
            </div>
            <span className="activity-ring-val">
              {moveVal} <span style={{ color: 'var(--label-2)', fontWeight: 400, fontSize: 11 }}>/ {moveGoal} kcal</span>
            </span>
          </div>

          <div className="activity-ring-item">
            <div className="activity-ring-label">
              <span className="activity-ring-dot" style={{ background: 'var(--mint)' }} />
              <span>{t('Exercise')}</span>
            </div>
            <span className="activity-ring-val">
              {exVal} <span style={{ color: 'var(--label-2)', fontWeight: 400, fontSize: 11 }}>/ {exGoal} min</span>
            </span>
          </div>

          <div className="activity-ring-item">
            <div className="activity-ring-label">
              <span className="activity-ring-dot" style={{ background: 'var(--teal)' }} />
              <span>{t('Hydration')}</span>
            </div>
            <span className="activity-ring-val">
              {standVal} <span style={{ color: 'var(--label-2)', fontWeight: 400, fontSize: 11 }}>/ {standGoal} L</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

// Muscle Balance
function MuscleBalance({ S }) {
  const [win, setWin] = useState(7)
  const [hard, setHard] = useState(false)
  const [sel, setSel] = useState(null)
  const now = Date.now()
  const inWin = S.workouts.filter(w =>
    win === 0 ? true
      : win === 7 ? weekKey(w.d) === weekKey(todayISO())
        : (w.start || new Date(w.d).getTime()) > now - win * 86400000)

  const rated = inWin.some(w => w.entries.some(e => e.sets.some(s => s.done && isHardSet(s))))
  const on = hard && rated
  const load = loadOfWorkouts(inWin, on ? isHardSet : null)
  const { worked, missed } = rankOf(load)
  const top = worked.slice(0, 4)
  const max = worked.length ? load[worked[0]] : 0
  const sets = m => Math.round((load[m] || 0) * 10) / 10

  return (
    <div className="card">
      <div className="row between" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--label)' }}>
          {t('Muscle balance')} <span className="dim" style={{ textTransform: 'none', letterSpacing: 0, fontSize: 12 }}>· {on ? t('by hard sets') : t('by sets worked')}</span>
        </h2>
        {rated && (
          <Button size="sm" icon="flame" style={on ? { color: 'var(--amber)' } : undefined} onClick={() => { setHard(h => !h); setSel(null) }}>
            {on ? t('Hard') : t('All')}
          </Button>
        )}
      </div>
      <Segmented
        className="seg-range"
        value={win}
        onChange={v => { setWin(v); setSel(null) }}
        options={[{ value: 7, label: t('Week') }, { value: 30, label: '30d' }, { value: 90, label: '90d' }, { value: 0, label: t('All') }]}
      />
      {inWin.length ? (
        <>
          <BodyMap className="tappable" load={load} body={S.body} selected={sel} onMuscle={m => setSel(s => (s === m ? null : m))} />
          <BodyMapLegend />
          {sel && (
            <div className="mrow" style={{ borderTop: 'var(--hair) solid var(--sep)', marginTop: 4, paddingTop: 10 }}>
              <span className="nm"><b>{t(MUSCLE_NAME[sel])}</b></span>
              <span className="v">{sets(sel) ? t('{0} sets', sets(sel)) : on ? t('no hard sets') : t('not trained')}</span>
            </div>
          )}
          {!sel && top.map(m => (
            <div key={m} className="mrow">
              <span className="nm">{t(MUSCLE_NAME[m])}</span>
              <span className="bar"><i style={{ width: Math.round(load[m] / max * 100) + '%', background: on ? 'var(--amber)' : undefined }} /></span>
              <span className="v">{t('{0} sets', sets(m))}</span>
            </div>
          ))}
          {missed.length > 0 && (
            <>
              <h4 className="sec" style={{ marginTop: 12 }}>{on ? t('No hard sets in this period') : t('Not trained in this period')}</h4>
              <div className="mchips">{missed.map(m => <span key={m} className="mchip miss">{t(MUSCLE_NAME[m])}</span>)}</div>
            </>
          )}
          {!missed.length && worked.length > 0 && (
            <div className="muted small" style={{ marginTop: 10 }}>
              {on ? t('Every muscle group got at least one hard set in this period.') : t('Every muscle group got some work in this period.')}
            </div>
          )}
        </>
      ) : (
        <div className="muted small">{t('No workouts in this period yet.')}</div>
      )}
    </div>
  )
}

// Effort Card
function EffortCard({ S }) {
  const [win, setWin] = useState(90)
  const kind = displayScale(S)
  const hd = scaleName(kind)
  const sum = effortSummary(S, win)
  const weeks = effortWeeks(S, win)
  const hist = effortHistogram(S, win)
  const maxBin = Math.max(1, ...hist.map(b => b.n))
  const pts = weeks.map(w => ({ t: w.t, y: toScale(kind, w.rir), note: t('{0} sets', w.sets) }))
  const binLabel = b => kind === 'rpe' ? (b.tail ? '≤ 6' : String(10 - b.rir)) : (b.tail ? b.rir + '+' : String(b.rir))

  return (
    <div className="card">
      <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--label)' }}>
        {t('Effort')} <span className="dim" style={{ textTransform: 'none', letterSpacing: 0, fontSize: 12 }}>· {t('how close to failure')}</span>
      </h2>
      <Segmented
        className="seg-range"
        value={win}
        onChange={setWin}
        options={[{ value: 30, label: '30d' }, { value: 90, label: '90d' }, { value: 365, label: '1Y' }, { value: 0, label: t('All') }]}
      />
      {sum.rated === 0 ? (
        <div className="muted small">{t('No rated sets in this period.')}</div>
      ) : (
        <>
          <div className="row between" style={{ alignItems: 'flex-end', gap: 12, marginTop: 10 }}>
            <div>
              <div className="stat-v">{sum.avg == null ? '—' : fmtNum(toScale(kind, sum.avg)) + ' ' + hd}</div>
              <div className="small dim">{t('average effort')}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="stat-v" style={{ color: 'var(--amber)' }}>{sum.hardPct == null ? '—' : Math.round(sum.hardPct * 100) + '%'}</div>
              <div className="small dim">{t('at {0} {1} or harder', hd, fmtNum(toScale(kind, HARD_RIR)))}</div>
            </div>
          </div>
          <div className="small dim" style={{ marginTop: 8 }}>{t('{0} of {1} finished sets rated', sum.rated, sum.done)}</div>
          {effortOf(S) === 'none' && (
            <div className="small" style={{ color: 'var(--amber)', marginTop: 4 }}>
              {t('Effort per set is switched off — turn it on in Settings to keep rating.')}
            </div>
          )}
          {pts.length > 1 && (
            <>
              <h4 className="sec" style={{ marginTop: 12 }}>{t('Week by week')}</h4>
              <div className="chart"><LineChart points={pts} h={140} unit={hd} color="var(--amber)" invert={kind === 'rir'} /></div>
            </>
          )}
          <h4 className="sec" style={{ marginTop: 12 }}>{t('Where the sets land')}</h4>
          {hist.map(b => (
            <div key={b.rir} className="mrow">
              <span className="nm">{hd} {binLabel(b)}</span>
              <span className="bar"><i style={{ width: Math.round(b.n / maxBin * 100) + '%', background: b.rir <= HARD_RIR ? 'var(--amber)' : 'var(--label-3)' }} /></span>
              <span className="v">{b.n ? b.n + ' · ' + Math.round(b.pct * 100) + '%' : '—'}</span>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

// Activity & Stats Screen
export default function Stats() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const [period, setPeriod] = useState('Week')
  const [range, setRange] = useState(90)
  const [exId, setExId] = useState(null)
  const [exMetric, setExMetric] = useState('top')
  const now = Date.now()
  const anyEffort = hasEffort(S)
  const kind = displayScale(S)
  const hd = scaleName(kind)

  // Read recorded health logs for today
  const todayStr = todayISO()
  const todayHealth = useMemo(() => {
    try {
      const stored = localStorage.getItem(`opengym_health_${todayStr}`)
      if (stored) return JSON.parse(stored)
    } catch (e) {}
    return null
  }, [todayStr])

  const recordedSteps = (todayHealth?.cardio || []).reduce((a, c) => a + (Number(c.steps) || 0), 0)
  const waterL = Math.round(((todayHealth?.water || []).reduce((a, w) => a + (Number(w.millilitres) || 0), 0) / 1000) * 10) / 10
  const waterGoal = S.nutritionTargets?.waterGoal || 2.5

  const todayWorkout = S.workouts.find(w => w.d === todayStr)
  const todayDurMin = todayWorkout ? Math.round((todayWorkout.dur || 0) / 60000) : (S.active ? Math.max(1, Math.round((Date.now() - S.active.start) / 60000)) : 0)

  // Volume in selected range
  const winWorkouts = S.workouts.filter(w => (w.start || new Date(w.d).getTime()) > now - 7 * 86400000)
  const totalVolume7d = winWorkouts.reduce((acc, w) => {
    return acc + w.entries.reduce((a, e) => {
      return a + (e.sets || []).filter(s => s.done).reduce((as, s) => as + (Number(s.w) || 0) * (Number(s.r) || 0), 0)
    }, 0)
  }, 0)

  // Volume curve points for the chart
  const volumePoints = S.workouts.slice(-14).map(w => {
    const vol = w.entries.reduce((a, e) => a + (e.sets || []).filter(s => s.done).reduce((as, s) => as + (Number(s.w) || 0) * (Number(s.r) || 0), 0), 0)
    return { t: w.start || new Date(w.d).getTime(), y: vol, d: w.d }
  })

  const bwPts = S.bodyweight.filter(b => range === 0 || (b.t || new Date(b.d).getTime()) > now - range * 86400000)
    .map(b => ({ t: b.t || new Date(b.d).getTime(), y: b.w, d: b.d }))
  const bw30 = S.bodyweight.filter(b => (b.t || new Date(b.d).getTime()) > now - 30 * 86400000)
  const bwDelta30 = bw30.length > 1 ? bw30[bw30.length - 1].w - bw30[0].w : null
  const monthW = S.workouts.filter(w => w.d.slice(0, 7) === todayISO().slice(0, 7)).length

  const exHist = [...new Set(S.workouts.flatMap(w => w.entries.map(e => e.id)))].filter(id => EXIDX[id]).sort((a, b) => EXIDX[a].n < EXIDX[b].n ? -1 : 1)
  const curEx = exId && exHist.includes(exId) ? exId : exHist[0] || null

  const curMode = curEx ? (() => {
    for (let i = S.workouts.length - 1; i >= 0; i--) {
      const en = S.workouts[i].entries.find(e => e.id === curEx)
      if (en) return modeOf({ ...(en.target || {}), id: curEx })
    }
    return modeOf({ id: curEx })
  })() : 'reps'
  const curCardio = curMode === 'cardio'
  const curTimed = curMode === 'time'
  const metric = s => curCardio ? (s.speed || 0) : curTimed ? (s.sec || 0) : (s.w || 0)
  const exUnit = curCardio ? 'km/h' : curTimed ? 's' : S.unit
  let exPts = [], exList = [], exBest = 0
  if (curEx) {
    S.workouts.forEach(w => {
      const en = w.entries.find(e => e.id === curEx)
      if (en) { const mx = Math.max(0, ...en.sets.filter(s => s.done).map(metric), curCardio || curTimed ? 0 : (en.topW || 0)); if (mx > 0) { exPts.push({ t: w.start, y: mx, d: w.d, sets: en.sets.filter(s => s.done), target: en.target }); if (mx > exBest) exBest = mx } }
    })
    exList = exPts.slice(-5).reverse()
  }

  const e1Pts = curEx ? e1rmSeries(S, curEx) : []
  const e1Best = curEx ? best1RM(S, curEx) : null
  const showE1 = e1Pts.length > 0
  const exRir = exPts.map(p => avgRir(p.sets))
  const showEff = exRir.filter(v => v != null).length >= 3
  const effPts = exPts.map((p, i) => (exRir[i] == null ? null : { t: p.t, y: toScale(kind, exRir[i]), d: p.d })).filter(Boolean)
  const onE1 = showE1 && exMetric === 'e1rm'
  const onEff = showEff && exMetric === 'effort'
  const topPts = exPts.map((p, i) => ({
    t: p.t, y: p.y, d: p.d,
    m: exRir[i] == null ? null : 1 - Math.min(4, Math.max(0, exRir[i])) / 4,
    note: exRir[i] == null ? undefined : hd + ' ' + fmtNum(toScale(kind, exRir[i]))
  }))
  const exOpts = [{ value: 'top', label: t('Top set') }]
  if (showE1) exOpts.push({ value: 'e1rm', label: t('Est. 1RM') })
  if (showEff) exOpts.push({ value: 'effort', label: t('Effort') })

  const periodOptions = ['Day', 'Week', 'Month', 'Year']

  return (
    <div className="narrow">
      {/* Header — matching Phone 5 in reference image */}
      <div className="hdr" style={{ alignItems: 'center', marginBottom: 14 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, letterSpacing: '-0.025em' }}>
            {t('Activity')}
          </h1>
          <div className="sub" style={{ fontSize: 13, color: 'var(--label-2)', marginTop: 2 }}>
            {t('Progress, trends & training logs')}
          </div>
        </div>
        <button className="iconbtn" onClick={() => nav('/history')} aria-label={t('History')} title={t('History')}>
          <Icon name="history" />
        </button>
      </div>

      {/* Period Selector Pills — Day, Week, Month, Year */}
      <div className="chips" style={{ marginBottom: 14 }}>
        {periodOptions.map(p => (
          <button
            key={p}
            className={`chip ${period === p ? 'on' : ''}`}
            onClick={() => setPeriod(p)}
          >
            {t(p)}
          </button>
        ))}
      </div>

      {/* Primary Metric Curve Card — Phone 5 in reference image */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row between" style={{ alignItems: 'flex-start', marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--label-2)', textTransform: 'uppercase' }}>
              {t('Total Volume Lifted (7d)')}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
              <div className="big" style={{ fontSize: 28, fontWeight: 800 }}>
                {totalVolume7d > 0 ? `${fmtNum(totalVolume7d)}` : '0'} <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--label-2)' }}>{S.unit}</span>
              </div>
              {totalVolume7d > 0 && (
                <span className="tag acc" style={{ fontSize: 12, padding: '3px 8px', borderRadius: 9999 }}>
                  ▲ {t('Active')}
                </span>
              )}
            </div>
          </div>
          <span className="small muted" style={{ fontSize: 12 }}>
            {winWorkouts.length} {t(winWorkouts.length === 1 ? 'workout' : 'workouts')}
          </span>
        </div>

        {volumePoints.length > 1 ? (
          <div className="chart" style={{ marginTop: 12 }}>
            <LineChart points={volumePoints} h={140} unit={S.unit} color="var(--coral)" />
          </div>
        ) : (
          <div className="muted small" style={{ padding: '16px 0', textAlign: 'center' }}>
            {t('Complete workouts to generate your training curve.')}
          </div>
        )}
      </div>

      {/* Concentric Activity Rings Card — Phone 5 */}
      <ActivityRings
        moveVal={todayHealth?.foods?.length ? 1900 : 0}
        moveGoal={1900}
        exVal={todayDurMin}
        exGoal={60}
        standVal={waterL}
        standGoal={waterGoal}
      />

      {/* Steps & Activity Card — Phone 5 in reference image */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row between" style={{ alignItems: 'flex-start', marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--label-2)', textTransform: 'uppercase' }}>
              {t('Steps Tracked')}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
              <div className="big" style={{ fontSize: 26, fontWeight: 800 }}>
                {recordedSteps > 0 ? recordedSteps.toLocaleString() : '0'} <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--label-2)' }}>{t('Steps')}</span>
              </div>
              {recordedSteps > 0 && (
                <span className="tag acc" style={{ fontSize: 11, padding: '2px 6px', borderRadius: 9999 }}>
                  ▲ {t('Recorded')}
                </span>
              )}
            </div>
          </div>
          <Button size="sm" variant="tinted" icon="plus" onClick={() => nav('/nutrition')}>
            {t('Log Cardio')}
          </Button>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 60, marginTop: 14 }}>
          {DAYS.map((d, i) => {
            const isToday = i === new Date().getDay()
            const heightPct = isToday && recordedSteps > 0 ? 90 : (isToday ? 20 : 15)
            return (
              <div key={d} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%' }}>
                <div style={{ flex: 1, width: 8, background: 'var(--surface-2)', borderRadius: 9999, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', overflow: 'hidden' }}>
                  <div style={{ width: '100%', height: `${heightPct}%`, background: isToday ? 'var(--mint)' : 'var(--surface-3)', borderRadius: 9999 }} />
                </div>
                <span style={{ fontSize: 10, fontWeight: 600, color: isToday ? 'var(--mint)' : 'var(--label-3)' }}>{d.slice(0, 1)}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Summary KPI Tiles */}
      <div className="tiles" style={{ marginBottom: 14 }}>
        <div className="tile"><div className="l"><Icon name="dumbbell" />{t('Workouts')}</div><div className="v">{S.workouts.length}</div></div>
        <div className="tile"><div className="l"><Icon name="calendar" />{t('This month')}</div><div className="v">{monthW}</div></div>
        <div className="tile"><div className="l"><Icon name="flame" />{t('Week streak')}</div><div className="v">{streakWeeks(S)}</div></div>
        <div className="tile">
          <div className="l"><Icon name="scale" />{t('Weight 30d')}</div>
          <div className="v" style={{ fontSize: 20, color: bwDelta30 === null ? 'inherit' : bwDeltaColor(bwDelta30, (lastBW(S) || {}).w || 0) }}>
            {bwDelta30 === null ? '—' : (bwDelta30 > 0 ? '+' : '') + fmtNum(bwDelta30) + ' ' + S.unit}
          </div>
        </div>
      </div>

      {/* Activity Heatmap — last 12 months */}
      <div className="card" style={{ marginBottom: 14 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--label)' }}>
          {t('Activity — last 12 months')} <span className="dim" style={{ textTransform: 'none', letterSpacing: 0, fontSize: 12 }}>· {t('by time trained')}</span>
        </h2>
        <Heatmap
          S={S}
          onDay={iso => {
            const ws = S.workouts.filter(w => w.d === iso)
            if (ws.length === 1) workoutDetailSheet(ws[0])
            else if (ws.length) calendarSheet(iso)
          }}
        />
      </div>

      {S.workouts.length > 0 && <MuscleBalance S={S} />}
      {anyEffort && <EffortCard S={S} />}

      <div className="cols">
        {/* Body weight card with time range */}
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
          <Segmented
            className="seg-range"
            value={range}
            onChange={setRange}
            options={[{ value: 30, label: '1M' }, { value: 90, label: '3M' }, { value: 365, label: '1Y' }, { value: 0, label: t('All') }]}
          />
          <div className="chart"><LineChart points={bwPts} h={160} unit={S.unit} goal={S.targetW} /></div>
        </div>

        {/* Exercise Progress Curve */}
        <div className="card">
          <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--label)' }}>{t('Exercise progress')}</h2>
          {exHist.length ? (
            <>
              <div className="sect-b" style={{ marginBottom: 10 }}>
                <SelectRow
                  title={t('Exercise')}
                  sheetTitle={t('Exercise progress')}
                  value={curEx}
                  onChange={setExId}
                  options={exHist.map(id => ({ value: id, label: EXIDX[id].n }))}
                />
              </div>
              {exOpts.length > 1 && (
                <Segmented
                  className="seg-range"
                  value={onEff ? 'effort' : onE1 ? 'e1rm' : 'top'}
                  onChange={setExMetric}
                  options={exOpts}
                />
              )}
              <div className="chart">
                {onEff ? (
                  <LineChart points={effPts} h={150} unit={hd} color="var(--amber)" invert={kind === 'rir'} />
                ) : (
                  <LineChart points={onE1 ? e1Pts.map(p => ({ t: p.t, y: p.y, d: p.d })) : topPts} h={150} unit={exUnit} color="var(--mint)" />
                )}
              </div>
              <div style={{ marginTop: 8 }}>
                {exList.map((p, i) => (
                  <div key={i} className="row between small" style={{ padding: '6px 0', borderBottom: 'var(--hair) solid var(--sep)' }}>
                    <span className="muted">{fmtDate(p.d, true)}</span>
                    <span>{p.sets.map(s => setLabel(curEx, s, p.target)).join('  ')}</span>
                  </div>
                ))}
              </div>
              <div className="small dim" style={{ marginTop: 8 }}>
                {onEff ? t('Average effort per workout') : onE1 ? t('Estimated 1RM per workout') : curCardio ? t('Top speed per workout') : curTimed ? t('Longest hold per workout') : t('Best set weight per workout')}
                {onEff ? '' : <> · {t('Best:')}{' '}<b className="accent">{fmtNum(onE1 ? e1Best.est : exBest)} {onE1 ? S.unit : exUnit}</b></>}
              </div>
            </>
          ) : (
            <div className="muted small">{t('Finish your first workout to see progress curves here.')}</div>
          )}
        </div>
      </div>

      {/* Recent Workouts */}
      {S.workouts.length > 0 && (
        <div style={{ marginTop: 12, marginBottom: 20 }}>
          <div className="row between" style={{ marginBottom: 10, padding: '0 4px' }}>
            <h4 className="sec" style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--label-2)' }}>
              {t('Recent workouts')}
            </h4>
            <Button size="sm" variant="ghost" trailingIcon="chevronRight" onClick={() => nav('/history')}>
              {t('All')} {S.workouts.length}
            </Button>
          </div>
          <div className="list">
            {[...S.workouts].reverse().slice(0, 6).map(w => (
              <WorkoutRow key={w.id} w={w} onClick={() => workoutDetailSheet(w)} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
