import { useState } from 'react'
import { imgSrc, gifSrc, cdnImgSrc, cdnGifSrc } from '../lib/exercises.js'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'

// Big autoplaying animation; tap toggles to the still frame. `compact` shrinks it (superset cards).
// Custom exercises have no animation unless a custom image/media is attached.
// `minimizable` (workout view) adds a persistent minimize/expand control so the animation stops
// eating the screen; the chosen size is saved to settings and carries across exercises and
// future workouts.
export default function Media({ ex, id, compact, minimizable }) {
  const [playing, setPlaying] = useState(true)
  const [fallbackUsed, setFallbackUsed] = useState(false)
  const gifSize = useStore(s => s.S.gifSize)
  const update = useStore(s => s.update)
  if (!ex.gif && !ex.customImage) return null
  const mini = minimizable && gifSize === 'mini'
  const toggleSize = e => { e.stopPropagation(); update(s => { s.gifSize = mini ? 'full' : 'mini' }) }
  const currentSrc = ex.customImage || (
    fallbackUsed
      ? (playing ? cdnGifSrc(ex) : cdnImgSrc(ex))
      : (playing ? gifSrc(ex) : imgSrc(ex))
  )
  return (
    <div className={'exmedia' + (compact ? ' compact' : '') + (mini ? ' mini' : '')} id={id} onClick={() => setPlaying(p => !p)}>
      <img
        decoding="async"
        src={currentSrc}
        alt={ex.n}
        onError={() => {
          if (!fallbackUsed && !ex.customImage) setFallbackUsed(true)
        }}
      />
      {minimizable && (
        <button className="giftoggle" onClick={toggleSize}>
          <Icon name={mini ? 'expand' : 'minimize'} />{mini ? t('Expand') : t('Minimize')}
        </button>
      )}
      {!mini && (
        <span className="gifhint">
          <Icon name={playing ? 'pause' : 'play'} />{playing ? t('tap to pause') : t('tap to play')}
        </span>
      )}
    </div>
  )
}

export function Thumb({ ex }) {
  const [fallback, setFallback] = useState(false)
  if (!ex.img && !ex.customImage) return <div className="thumb thumb-x"><Icon name="dumbbell" /></div>
  const src = ex.customImage || (fallback ? cdnImgSrc(ex) : imgSrc(ex))
  return (
    <img
      className="thumb"
      loading="lazy"
      decoding="async"
      src={src}
      alt={ex.n || ''}
      onError={() => {
        if (!fallback && !ex.customImage) setFallback(true)
      }}
    />
  )
}
