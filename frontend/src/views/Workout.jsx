import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { exOr } from '../lib/exercises.js'
import { effectiveRoutine, lastEntryFor, bestWeightFor, buildSets, setsDoneActive, supersetUnits, unitOf, setLabel, modeOf, EFFORT, effortOf, stepEffort, capEffort } from '../lib/history.js'
import { fmtNum, fmtDate, todayISO, exCount, DAYN } from '../lib/format.js'
import { beep, vibrate } from '../lib/sound.js'
import { t } from '../lib/i18n.js'
import { api } from '../lib/api.js'
import Media from '../components/Media.jsx'
import { startFlow, exercisePicker, exConfigSheet, exerciseDetailSheet, topWeightSheet, finishWorkout, workoutCompleteSheet, confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button, Check, NumberField } from '../components/ui.jsx'
import { nextPrescription, applyPrescription } from '../lib/progression.js'
import { glyphOf } from '../lib/glyphs.js'

/* ---------- start chooser (no active workout) ---------- */
function StartChooser() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const todayR = effectiveRoutine(S, todayISO())
  const todayOvr = S.dayPlan[todayISO()] !== undefined
  const others = S.routines.filter(r => r !== todayR)
  return <div className="narrow">
    <div className="hdr"><div><h1>{t('Start workout')}</h1><div className="sub">{t(DAYN[new Date().getDay()])} — {todayR ? t('today is {0}', todayR.name) : t('rest day, but no one’s stopping you')}</div></div></div>
    {todayR && <div className="card" style={{ borderLeft: '4px solid var(--mint)', marginBottom: 16 }}>
      <div className="row between" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="lrow-i" style={{ width: 44, height: 44, borderRadius: 14, fontSize: 22, background: 'var(--mint-light)', color: 'var(--mint)' }}>
            <Icon name={glyphOf(todayR.emoji)} />
          </span>
          <div>
            <div className="accent" style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase' }}>{t("Today's Plan")}{todayOvr ? ' · ' + t('rescheduled') : ''}</div>
            <div className="big" style={{ fontSize: 20, marginTop: 2 }}>{todayR.name}</div>
            <div className="muted small">{exCount(todayR.ex.length)}</div>
          </div>
        </div>
      </div>
      <Button variant="primary" size="lg" icon="play" onClick={() => startFlow(todayR.id)}>{t('Start {0}', todayR.name)}</Button>
    </div>}
    {others.length > 0 && <><h4 className="sec">{t('Other routines')}</h4>
      <div>{others.map(r => <div key={r.id} className="workout-card" onClick={() => startFlow(r.id)}>
        <div className="workout-card-thumb"><Icon name={glyphOf(r.emoji) || 'dumbbell'} /></div>
        <div className="workout-card-info"><div className="workout-card-title">{r.name}</div><div className="workout-card-meta">{exCount(r.ex.length)}</div></div>
        <button className="btn sm" style={{ background: 'var(--mint)', color: '#fff', borderRadius: 9999, fontWeight: 600 }}>{t('Start')}</button>
      </div>)}</div></>}
    <div style={{ height: 14 }} />
    <Button icon="shuffle" onClick={() => startFlow(null)}>{t('Freestyle workout (pick as you go)')}</Button>
    {!S.routines.length && <><div style={{ height: 10 }} /><Button variant="primary" onClick={() => nav('/plan')}>{t('Build a plan first')}</Button></>}
  </div>
}

/* ---------- elapsed clock (isolated so the workout tree doesn't re-render every second) ---------- */
function Elapsed({ start }) {
  const [t, setT] = useState('0:00')
  useEffect(() => {
    const tick = () => { const s = Math.floor((Date.now() - start) / 1000); setT(Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')) }
    tick(); const iv = setInterval(tick, 1000); return () => clearInterval(iv)
  }, [start])
  return <span>{t}</span>
}

/* ---------- one exercise block (reps: weight×reps · time: a held duration · cardio: duration+speed) ---------- */
function ExerciseBlock({ entryIdx, compact, onToggle, onToggleWarmup, onField, onAddSet, onAddWarmupSet, onRemoveSet, onStartTimed, onOpenMenu }) {
  const S = useStore(s => s.S)
  const working = useUI(s => s.work)
  const entry = S.active.entries[entryIdx]
  const ex = exOr(entry.id)
  const mode = modeOf({ ...(entry.target || {}), id: entry.id })
  const cardio = mode === 'cardio'
  const timed = mode === 'time'
  const last = lastEntryFor(S, entry.id)
  const best = cardio ? 0 : Math.max(bestWeightFor(S, entry.id), (S.exWeights[entry.id] || {}).w || 0)
  const plan = entry.plan
  const col1 = cardio ? { f: 'min', step: 1, dec: false, hd: t('Duration (min)') }
    : timed ? { f: 'sec', step: 5, dec: false, hd: t('Seconds') }
      : { f: 'w', step: 2.5, dec: true, hd: t('Weight ({0})', S.unit) }
  const col2 = cardio ? { f: 'speed', step: 0.5, dec: true, hd: t('Speed (km/h)') }
    : timed ? { f: 'w', step: 2.5, dec: true, hd: t('Weight ({0})', S.unit) }
      : { f: 'r', step: 1, dec: false, hd: t('Reps') }
  const kind = effortOf(S)
  const eff = EFFORT[kind]
  const col3 = mode === 'reps' && eff ? { ...eff, eff: kind, dec: true, opt: true, hd: t(eff.hd) } : null

  const bump = (s, i, col, dir) => {
    if (col.eff) return onField(i, col.f, stepEffort(col.eff, s[col.f], dir))
    onField(i, col.f, Math.max(0, Math.round(((s[col.f] || 0) + dir * col.step) * 100) / 100))
  }

  const cell = (s, i, col, cls) => (
    <div className={'stp ' + cls}>
      <button aria-label="Decrease" onClick={() => bump(s, i, col, -1)}><Icon name="minus" /></button>
      <span className="val"><NumberField decimal={col.dec} nullable={col.opt} value={s[col.f] ?? ''}
        onChange={v => onField(i, col.f, col.eff ? capEffort(col.eff, v) : v)} /></span>
      <button aria-label="Increase" onClick={() => bump(s, i, col, 1)}><Icon name="plus" /></button>
    </div>
  )

  const getSetBadge = idx => {
    const s = entry.sets[idx]
    if (s.warmup) return 'W'
    const workIdx = entry.sets.slice(0, idx + 1).filter(x => !x.warmup).length
    return workIdx
  }

  return <>
    <Media ex={ex} key={entry.id} compact={compact} minimizable />
    <div className="row between" style={{ marginBottom: 6 }}>
      <div style={{ fontSize: compact ? 17 : 20, fontWeight: 600, letterSpacing: '-.02em', textTransform: 'capitalize', lineHeight: 1.2 }}>{ex.n}</div>
      <div className="row" style={{ gap: 6 }}>
        {onOpenMenu && <button className="iconbtn" aria-label={t('Exercise options')} title={t('Options')} onClick={onOpenMenu}><Icon name="gear" /></button>}
        <button className="iconbtn" aria-label={t('Details')} title={t('Details')} onClick={() => exerciseDetailSheet(ex)}><Icon name="info" /></button>
      </div>
    </div>
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
      {cardio && <span className="tag acc"><Icon name="figureRun" />{t('Cardio')}</span>}
      {(ex.tg || ex.bp) && <span className="tag">{t(ex.tg || ex.bp)}</span>}
      {ex.eq && <span className="tag">{t(ex.eq)}</span>}
      {best > 0 && <span className="tag nocap">{t('Best:')} {fmtNum(best)} {S.unit}</span>}
    </div>
    {last && <div className="small dim" style={{ marginBottom: 4 }}>{t('Last time')} ({fmtDate(last.d)}): {last.sets.map(s => setLabel(entry.id, s, last.target)).join(', ')}</div>}
    {plan && plan.why && plan.kind !== 'off' && <div className={'progline' + (plan.kind === 'deload' ? ' warn' : '')}>
      <Icon name={plan.kind === 'up' ? 'arrowUp' : plan.kind === 'deload' ? 'arrowDown' : 'lightbulb'} />
      <span>{t(...plan.why)}</span>
    </div>}
    <div className="card" style={{ marginTop: 10, marginBottom: 0 }}>
      <div className={'sethead' + (col3 ? ' eff3' : '')}><span className="n-sp" /><span className="w-sp">{col1.hd}</span><span className="r-sp">{col2.hd}</span>{col3 && <span className="eff-sp">{col3.hd}</span>}{timed && <span className="ck-sp" />}<span className="ck-sp" /></div>
      {entry.sets.map((s, i) => <div key={i} className={'setrow' + (s.done ? ' done' : '') + (s.warmup ? ' warmup-row' : '') + (col3 ? ' eff3' : '')}>
        <button
          className={'n setnum-btn' + (s.warmup ? ' warmup' : '')}
          title={s.warmup ? t('Warm-up set (click to switch to working set)') : t('Working set (click to switch to warm-up)')}
          onClick={() => onToggleWarmup && onToggleWarmup(i)}
        >
          {getSetBadge(i)}
        </button>
        {cell(s, i, col1, 'w')}
        {cell(s, i, col2, 'r')}
        {col3 && cell(s, i, col3, 'eff')}
        {timed && <button className="setgo" aria-label={t('Start set')} disabled={s.done || !!working}
          onClick={() => onStartTimed(i)}><Icon name="play" /></button>}
        <Check checked={s.done} onChange={() => onToggle(i)} />
      </div>)}
      <div style={{ height: 10 }} />
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        <Button size="sm" icon="flame" variant="tinted" onClick={onAddWarmupSet}>{t('+ Warm-up')}</Button>
        <Button size="sm" icon="plus" onClick={onAddSet}>{t('+ Set')}</Button>
        <Button size="sm" icon="minus" disabled={entry.sets.length <= 1} onClick={onRemoveSet}>{t('- Set')}</Button>
      </div>
    </div>
  </>
}

/* ---------- active workout ---------- */
function ActiveWorkout() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const { startRest, stopRest } = useUI()
  const A = S.active
  const units = supersetUnits(A.entries)
  const cur = Math.min(A.cur, Math.max(0, A.entries.length - 1))
  const unit = A.entries.length ? unitOf(units, cur) : []
  const unitIdx = units.findIndex(u => u === unit)
  const isSuperset = unit.length > 1

  const total = A.entries.reduce((n, e) => n + e.sets.length, 0)
  const done = setsDoneActive(A)

  const mutEntry = (idx, fn) => update(s => { fn(s.active.entries[idx]) }, true)
  const setField = (idx, i, field, v) => mutEntry(idx, e => {
    if (v == null) delete e.sets[i][field]; else e.sets[i][field] = v
  })
  const modeAt = idx => modeOf({ ...(A.entries[idx].target || {}), id: A.entries[idx].id })

  const addSet = idx => mutEntry(idx, e => {
    const l = e.sets[e.sets.length - 1]
    const m = modeOf({ ...(e.target || {}), id: e.id })
    if (m === 'cardio') e.sets.push({ min: l ? l.min : (e.target.min || 20), speed: l ? l.speed : (e.target.speed || 8), done: false })
    else if (m === 'time') e.sets.push({ sec: l ? l.sec : (e.target.sec || 45), w: l ? (l.w || 0) : (e.target.weight || 0), done: false })
    else e.sets.push({ w: l ? l.w : 0, r: l ? l.r : e.target.reps, done: false })
  })

  const addWarmupSet = idx => mutEntry(idx, e => {
    const first = e.sets[0] || {}
    const m = modeOf({ ...(e.target || {}), id: e.id })
    const baseW = (e.sets.find(s => s.w > 0)?.w || (e.target?.weight || 20))
    const warmW = Math.max(0, Math.round(baseW * 0.5 * 10) / 10)
    e.sets.unshift({
      w: m === 'reps' ? warmW : (first.w || 0),
      r: m === 'reps' ? (e.target?.reps || 10) : undefined,
      sec: m === 'time' ? Math.round((e.target?.sec || 45) * 0.6) : undefined,
      min: m === 'cardio' ? 5 : undefined,
      speed: m === 'cardio' ? Math.max(1, (first.speed || 6) * 0.7) : undefined,
      warmup: true,
      done: false
    })
  })

  const toggleWarmup = (idx, i) => mutEntry(idx, e => {
    e.sets[i].warmup = !e.sets[i].warmup
  })

  const removeSet = idx => mutEntry(idx, e => { if (e.sets.length > 1) e.sets.pop() })

  const replaceExercise = (idx, newEx) => {
    exConfigSheet(newEx, null, cfg => update(s => {
      const full = { ...cfg, id: newEx.id }
      const plan = nextPrescription(s, full, s.routines.find(r => r.id === s.active.routineId))
      s.active.entries[idx] = {
        id: newEx.id,
        target: { ...cfg },
        plan,
        sets: applyPrescription(buildSets(s, full), plan)
      }
    }), null, S.routines.find(r => r.id === A.routineId))
  }

  const removeExercise = idx => {
    if (A.entries.length <= 1) {
      useUI.getState().toast(t('At least one exercise is required in a session'))
      return
    }
    confirmSheet({
      title: t('Remove exercise?'),
      message: t('This exercise will be removed from your current session.'),
      confirmText: t('Remove'),
      danger: true,
      onConfirm: () => update(s => {
        s.active.entries.splice(idx, 1)
        s.active.cur = Math.max(0, Math.min(s.active.cur, s.active.entries.length - 1))
      })
    })
  }

  const moveExercise = (idx, dir) => {
    const target = idx + dir
    if (target < 0 || target >= A.entries.length) return
    update(s => {
      const temp = s.active.entries[idx]
      s.active.entries[idx] = s.active.entries[target]
      s.active.entries[target] = temp
      s.active.cur = target
    })
  }

  const openExerciseMenu = idx => {
    const currentEx = exOr(A.entries[idx].id)
    useUI.getState().openSheet(close => (
      <div>
        <h3 className="capitalize" style={{ marginBottom: 4 }}>{currentEx.n}</h3>
        <div className="muted small" style={{ marginBottom: 16 }}>{t('Manage exercise in this workout')}</div>
        <div className="list">
          <div className="item" onClick={() => { close(); exercisePicker(newEx => replaceExercise(idx, newEx)) }}>
            <span className="lrow-i"><Icon name="shuffle" /></span>
            <div className="grow"><div className="tt">{t('Replace exercise')}</div><div className="ss">{t('Swap with another from the library')}</div></div>
            <Icon name="chevronRight" className="chev" />
          </div>
          {idx > 0 && <div className="item" onClick={() => { close(); moveExercise(idx, -1) }}>
            <span className="lrow-i"><Icon name="arrowUp" /></span>
            <div className="grow"><div className="tt">{t('Move earlier')}</div><div className="ss">{t('Perform earlier in session')}</div></div>
          </div>}
          {idx < A.entries.length - 1 && <div className="item" onClick={() => { close(); moveExercise(idx, 1) }}>
            <span className="lrow-i"><Icon name="arrowDown" /></span>
            <div className="grow"><div className="tt">{t('Move later')}</div><div className="ss">{t('Perform later in session')}</div></div>
          </div>}
          <div className="item" onClick={() => { close(); exerciseDetailSheet(currentEx) }}>
            <span className="lrow-i"><Icon name="info" /></span>
            <div className="grow"><div className="tt">{t('Exercise details')}</div><div className="ss">{t('Instructions & demo')}</div></div>
          </div>
          <div className="item danger" onClick={() => { close(); removeExercise(idx) }}>
            <span className="lrow-i" style={{ background: 'var(--red)' }}><Icon name="trash" /></span>
            <div className="grow"><div className="tt" style={{ color: 'var(--red)' }}>{t('Remove exercise')}</div><div className="ss">{t('Remove from this workout')}</div></div>
          </div>
        </div>
      </div>
    ))
  }

  const startTimed = (idx, i) => {
    const e = A.entries[idx]
    useUI.getState().startWork(e.sets[i].sec || 45, exOr(e.id).n, elapsed => {
      mutEntry(idx, en => { en.sets[i].sec = elapsed })
      if (!useStore.getState().S.active.entries[idx].sets[i].done) toggle(idx, i)
    })
  }

  const toggle = (idx, i) => {
    const m = modeAt(idx)
    const cardioEntry = m === 'cardio'
    const isLastUnit = unitIdx >= units.length - 1
    let askTop = false, exJustDone = false, workoutDone = false
    mutEntry(idx, e => {
      e.sets[i].done = !e.sets[i].done
      if (e.sets[i].done) {
        beep(S.sound, 1040, 0.12); vibrate(30)
        const isLastExInUnit = idx === unit[unit.length - 1]
        const unitDone = unit.every(ui => (ui === idx ? e : A.entries[ui]).sets.every(x => x.done))
        if (isLastExInUnit && !unitDone) startRest(S.restSec)
        else if (unitDone) stopRest()
        if (unitDone && isLastUnit) workoutDone = true
        if (e.sets.every(x => x.done)) { exJustDone = true; if (m === 'reps' && !e.asked) { e.asked = true; askTop = true } }
      }
    })
    if (askTop) topWeightSheet(idx)
    else if (workoutDone) workoutCompleteSheet()
    else if (exJustDone && cardioEntry) useUI.getState().toast(t('Cardio logged'))
    else if (exJustDone && m === 'time') useUI.getState().toast(t('Hold logged'))
  }

  // Keyboard navigation on desktop
  useEffect(() => {
    const onKeyDown = e => {
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return
      if (e.key === 'ArrowLeft') {
        if (unitIdx > 0) update(s => { s.active.cur = units[unitIdx - 1][0] })
      } else if (e.key === 'ArrowRight') {
        if (unitIdx >= 0 && unitIdx < units.length - 1) update(s => { s.active.cur = units[unitIdx + 1][0] })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [unitIdx, units])

  // Prevent accidental tab closing / reload during workout
  useEffect(() => {
    const onBeforeUnload = e => {
      if (useStore.getState().S.active) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  // Live-presence heartbeat
  useEffect(() => {
    if (!useStore.getState().user) return
    let stopped = false
    const ping = active => {
      const A2 = useStore.getState().S.active
      if (!A2) return
      const u = supersetUnits(A2.entries)
      const c = Math.min(A2.cur, Math.max(0, A2.entries.length - 1))
      const ui = u.findIndex(x => x.includes(c))
      const tot = A2.entries.reduce((n, e) => n + e.sets.length, 0)
      api('/api/activity', { method: 'POST', body: JSON.stringify({
        active, name: A2.name, exIdx: ui + 1, exTotal: u.length,
        setsDone: setsDoneActive(A2), setsTotal: tot, startedAt: A2.start
      }) }).catch(() => {})
    }
    ping(true)
    const iv = setInterval(() => { if (!stopped) ping(true) }, 20000)
    return () => {
      stopped = true; clearInterval(iv)
      try { navigator.sendBeacon?.('/api/activity', new Blob([JSON.stringify({ active: false })], { type: 'application/json' })) } catch { /* */ }
      api('/api/activity', { method: 'POST', body: JSON.stringify({ active: false }) }).catch(() => {})
    }
  }, [])

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" aria-label={t('Discard')} onClick={() => confirmSheet({ title: t('Discard workout?'), message: t('The sets you logged in this session will be lost.'), confirmText: t('Discard'), danger: true, onConfirm: () => { update(s => { s.active = null }); stopRest(); nav('/home') } })}><Icon name="xmark" /></button>
      <div style={{ textAlign: 'center' }}><div style={{ fontWeight: 600 }}>{A.name}</div><div className="sub"><Elapsed start={A.start} /> · {t('{0} sets', done + '/' + total)}</div></div>
      <button className="iconbtn" style={{ color: 'var(--acc)' }} aria-label={t('Finish')} onClick={finishWorkout}><Icon name="check" /></button>
    </div>
    <div className="wprog"><i style={{ width: (total ? done / total * 100 : 0) + '%' }} /></div>

    {A.entries.length ? <>
      <div className="muted small" style={{ marginBottom: 6 }}>{isSuperset ? t('Superset {0} / {1}', unitIdx + 1, units.length) : t('Exercise {0} / {1}', unitIdx + 1, units.length)}</div>
      {isSuperset ? (
        <div className="ss-card">
          <div className="ss-hd"><Icon name="link" />{t('Superset · do these back-to-back, rest after both')}</div>
          {unit.map((idx, k) => <div key={idx} className="ss-ex">
            {k > 0 && <div className="ss-amp">+</div>}
            <ExerciseBlock entryIdx={idx} compact
              onToggle={i => toggle(idx, i)} onToggleWarmup={i => toggleWarmup(idx, i)} onField={(i, f, v) => setField(idx, i, f, v)} onAddSet={() => addSet(idx)} onAddWarmupSet={() => addWarmupSet(idx)} onRemoveSet={() => removeSet(idx)} onStartTimed={i => startTimed(idx, i)} onOpenMenu={() => openExerciseMenu(idx)} />
          </div>)}
        </div>
      ) : (
        <ExerciseBlock entryIdx={cur} onToggle={i => toggle(cur, i)} onToggleWarmup={i => toggleWarmup(cur, i)} onField={(i, f, v) => setField(cur, i, f, v)} onAddSet={() => addSet(cur)} onAddWarmupSet={() => addWarmupSet(cur)} onRemoveSet={() => removeSet(cur)} onStartTimed={i => startTimed(cur, i)} onOpenMenu={() => openExerciseMenu(cur)} />
      )}
    </> : <div className="empty"><div className="ico"><Icon name="shuffle" /></div>{t('Freestyle workout — add your first exercise.')}</div>}

    <div style={{ height: 12 }} />
    <div className="row">
      <Button icon="chevronLeft" disabled={unitIdx <= 0} onClick={() => update(s => { s.active.cur = units[unitIdx - 1][0] })}>{t('Prev')}</Button>
      <Button trailingIcon="chevronRight" disabled={unitIdx < 0 || unitIdx >= units.length - 1} onClick={() => update(s => { s.active.cur = units[unitIdx + 1][0] })}>{t('Next')}</Button>
    </div>
    <div style={{ height: 10 }} />
    <Button onClick={() => exercisePicker(ex => exConfigSheet(ex, null, cfg => update(s => {
      const full = { ...cfg, id: ex.id }
      const plan = nextPrescription(s, full, s.routines.find(r => r.id === s.active.routineId))
      s.active.entries.push({ id: ex.id, target: { ...cfg }, plan, sets: applyPrescription(buildSets(s, full), plan) })
      s.active.cur = s.active.entries.length - 1
    }), null, S.routines.find(r => r.id === A.routineId)))} icon="plus">{t('Add exercise')}</Button>
    <div style={{ height: 10 }} />
    {(() => {
      const exDone = A.entries.filter(e => e.sets.length && e.sets.every(s => s.done)).length
      const allDone = A.entries.length > 0 && exDone === A.entries.length
      return <button className={allDone ? 'btn primary' : 'btn ghost dim'} onClick={finishWorkout}>
        {allDone ? t('Finish workout') : t('Finish workout early · {0} exercises', exDone + '/' + A.entries.length)}
      </button>
    })()}
    <div style={{ height: 40 }} />
  </div>
}

export default function Workout() {
  const active = useStore(s => s.S.active)
  return active ? <ActiveWorkout /> : <StartChooser />
}
