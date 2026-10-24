import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { effectiveRoutine } from '../lib/history.js'
import { todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'

export default function TabBar({ onStart }) {
  const nav = useNavigate()
  const loc = useLocation()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const isGuest = useStore(s => s.isGuest())
  if (!user && !isGuest) return null

  const cur = loc.pathname.split('/')[1] || 'home'
  const isTabActive = k => {
    if (k === 'home') return cur === 'home'
    if (k === 'workouts') return cur === 'plan' || cur === 'workout' || cur === 'library'
    if (k === 'activity') return cur === 'stats' || cur === 'history'
    if (k === 'nutrition') return cur === 'nutrition'
    if (k === 'profile') return cur === 'settings' || cur === 'admin' || cur === 'coach'
    return false
  }

  const Tab = ({ k, icon, to, label, badge }) => (
    <button
      className={isTabActive(k) ? 'on' : ''}
      onClick={() => nav(to)}
      aria-label={label}
      aria-current={isTabActive(k) ? 'page' : undefined}
    >
      <Icon name={icon} />
      <span>{label}</span>
      {badge && <span className="tab-badge" />}
    </button>
  )

  return (
    <nav id="tabbar" role="navigation" aria-label="Main Navigation">
      <Tab k="home" icon="house" to="/home" label={t('Home')} />
      <Tab
        k="workouts"
        icon={S.active ? 'play' : 'dumbbell'}
        to={S.active ? '/workout' : '/plan'}
        label={S.active ? t('Resume') : t('Workouts')}
        badge={!!S.active}
      />
      <Tab k="activity" icon="chart" to="/stats" label={t('Activity')} />
      <Tab k="nutrition" icon="nutrition" to="/nutrition" label={t('Health Log')} />
      <Tab k="profile" icon="person" to="/settings" label={t('Profile')} />
    </nav>
  )
}
