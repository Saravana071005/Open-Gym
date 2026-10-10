import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { EXDB, BODYPARTS, allExercises, equipmentOf } from '../lib/exercises.js'
import { bestWeightFor } from '../lib/history.js'
import { fmtNum } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { Thumb } from '../components/Media.jsx'
import { exerciseDetailSheet, addToRoutineSheet, customExSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

export default function Library() {
  const S = useStore(s => s.S)
  const toggleFavorite = useStore(s => s.toggleFavorite)
  const favorites = S.favorites || []
  const [q, setQ] = useState('')
  const [bp, setBp] = useState('')
  const [eq, setEq] = useState('')
  const [favOnly, setFavOnly] = useState(false)
  const [shown, setShown] = useState(40)
  const ql = q.toLowerCase().trim()
  const base = allExercises(S).filter(e =>
    (!favOnly || favorites.includes(e.id)) &&
    (!bp || e.bp === bp) &&
    (!ql || e.n.toLowerCase().includes(ql) || e.tg.includes(ql) || e.eq.includes(ql) || (e.desc || '').toLowerCase().includes(ql))
  )
  const eqOpts = equipmentOf(base)
  // Drop the equipment filter if the search narrowed it away, so you never hit a dead end.
  const eqOn = eqOpts.includes(eq) ? eq : ''
  const f = eqOn ? base.filter(e => e.eq === eqOn) : base

  return <>
    <div className="hdr"><div><h1>{t('Exercises')}</h1><div className="sub">{t('{0} exercises with animations', EXDB.length)}</div></div></div>
    <div className="search" style={{ marginBottom: 10 }}><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input className="input" placeholder={t('Search…')} value={q} onChange={e => { setQ(e.target.value); setShown(40) }} /></div>
    <div className="chips" style={{ marginBottom: eqOpts.length > 1 ? 8 : 12 }}>
      <button className={'chip' + (favOnly ? ' on' : '')} onClick={() => { setFavOnly(v => !v); setShown(40) }}>
        <Icon name="starFill" style={{ fontSize: 12, marginRight: 4, display: 'inline-block' }} />{t('Favorites')} ({favorites.length})
      </button>
      <button className={'chip nocap' + (!bp && !favOnly ? ' on' : '')} onClick={() => { setBp(''); setEq(''); setFavOnly(false); setShown(40) }}>{t('All')}</button>
      {BODYPARTS.map(b => <button key={b} className={'chip' + (bp === b && !favOnly ? ' on' : '')} onClick={() => { setBp(b); setEq(''); setFavOnly(false); setShown(40) }}>{t(b)}</button>)}
    </div>
    {eqOpts.length > 1 && <div className="chips" style={{ marginBottom: 12 }}>
      <button className={'chip nocap' + (!eqOn ? ' on' : '')} onClick={() => { setEq(''); setShown(40) }}>{t('Any equipment')}</button>
      {eqOpts.map(x => <button key={x} className={'chip' + (eqOn === x ? ' on' : '')} onClick={() => { setEq(x); setShown(40) }}>{t(x)}</button>)}
    </div>}
    <div className="list ex-grid-list">
      {!favOnly && <div className="item" onClick={() => customExSheet(null, ex => exerciseDetailSheet(ex), q.trim())}>
        <div className="thumb thumb-x"><Icon name="sparkles" /></div>
        <div className="grow"><div className="tt">{t('Create your own exercise')}</div><div className="ss">{t('name, body part, notes & optional image')}</div></div><Icon name="plus" className="chev" />
      </div>}
      {f.slice(0, shown).map(e => {
        const best = bestWeightFor(S, e.id)
        const isFav = favorites.includes(e.id)
        return <div key={e.id} className="item" onClick={() => exerciseDetailSheet(e)}>
          <Thumb ex={e} />
          <div className="grow"><div className="tt capitalize">{e.n}</div><div className="ss capitalize">{t(e.tg || e.bp)} · {t(e.eq)}</div></div>
          {best > 0 && <span className="tag acc">{fmtNum(best)}</span>}
          <button
            className={'iconbtn fav-btn' + (isFav ? ' on-fav' : '')}
            style={{ width: 32, height: 32, fontSize: 14, color: isFav ? 'var(--yellow)' : 'var(--label-3)' }}
            onClick={ev => { ev.stopPropagation(); toggleFavorite(e.id) }}
            aria-label={isFav ? t('Remove from favorites') : t('Add to favorites')}
          >
            <Icon name={isFav ? 'starFill' : 'star'} />
          </button>
          <Button size="sm" variant="tinted" icon="plus" onClick={ev => { ev.stopPropagation(); addToRoutineSheet(e) }}>{t('Plan')}</Button>
        </div>
      })}
      {f.length === 0 && <div className="empty"><div className="ico"><Icon name="magnifier" /></div>{favOnly ? t('No favorite exercises yet. Tap the star icon on any exercise to add it.') : t('No match')}</div>}
    </div>
    {f.length > shown && <><div style={{ height: 10 }} /><Button onClick={() => setShown(s => s + 40)}>{t('Show more')}</Button></>}
  </>
}
