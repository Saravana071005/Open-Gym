import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { effectiveRoutine } from '../lib/history.js'
import { todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'

export default function Sidebar({ onStart }) {
  const nav = useNavigate()
  const loc = useLocation()
  const { S, user, signOut } = useStore()
  const isGuest = useStore(s => s.isGuest())
  const hasCoach = useStore(s => s.coachConfig?.enabled)

  if (!user && !isGuest) return null

  const cur = loc.pathname.split('/')[1] || 'home'
  const isActive = k => {
    if (k === 'home') return cur === 'home'
    if (k === 'plan') return cur === 'plan'
    if (k === 'workout') return cur === 'workout'
    if (k === 'library') return cur === 'library'
    if (k === 'nutrition') return cur === 'nutrition'
    if (k === 'stats') return cur === 'stats'
    if (k === 'history') return cur === 'history'
    if (k === 'settings') return cur === 'settings'
    if (k === 'coach') return cur === 'coach'
    if (k === 'admin') return cur === 'admin'
    return false
  }

  const startWorkout = () => {
    if (!S.active) {
      const r = effectiveRoutine(S, todayISO())
      if (r && r.ex.length && onStart) {
        onStart(r.id)
        return
      }
    }
    nav('/workout')
  }

  const NavItem = ({ k, icon, to, label, badge }) => {
    const active = isActive(k)
    return (
      <button
        className={`sidebar-nav-item ${active ? 'active' : ''}`}
        onClick={() => nav(to)}
        aria-current={active ? 'page' : undefined}
      >
        <span className="sidebar-nav-icon"><Icon name={icon} /></span>
        <span className="sidebar-nav-label">{label}</span>
        {badge && <span className="sidebar-nav-badge">{badge}</span>}
      </button>
    )
  }

  return (
    <aside id="sidebar" className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-brand" onClick={() => nav('/home')}>
          <div className="sidebar-brand-icon">
            <Icon name="dumbbell" />
          </div>
          <div className="sidebar-brand-text">
            <span className="sidebar-brand-title">openGym</span>
            <span className="sidebar-brand-sub">Web Edition</span>
          </div>
        </div>
      </div>

      <div className="sidebar-action-wrap">
        {S.active ? (
          <button className="sidebar-active-btn" onClick={() => nav('/workout')}>
            <span className="sidebar-pulse-dot" />
            <div className="sidebar-active-info">
              <span className="sidebar-active-title">{t('Workout active')}</span>
              <span className="sidebar-active-desc">{t('Resume')} &rarr;</span>
            </div>
            <Icon name="play" />
          </button>
        ) : (
          <button className="sidebar-start-btn" onClick={startWorkout}>
            <Icon name="dumbbell" />
            <span>{t('Start workout')}</span>
          </button>
        )}
      </div>

      <nav className="sidebar-nav">
        <div className="sidebar-nav-group-title">{t('Navigation')}</div>
        <NavItem k="home" icon="house" to="/home" label={t('Home')} />
        <NavItem k="workout" icon={S.active ? "play" : "dumbbell"} to="/workout" label={t('Workout')} badge={S.active ? '●' : null} />
        <NavItem k="plan" icon="calendar" to="/plan" label={t('Plan')} />
        <NavItem k="nutrition" icon="nutrition" to="/nutrition" label={t('Nutrition')} />
        <NavItem k="library" icon="list" to="/library" label={t('Exercises')} />
        <NavItem k="stats" icon="chart" to="/stats" label={t('Stats')} />
        <NavItem k="history" icon="history" to="/history" label={t('History')} />

        <div className="sidebar-nav-group-title" style={{ marginTop: 14 }}>{t('Preferences')}</div>
        {hasCoach && <NavItem k="coach" icon="sparkles" to="/coach" label={t('AI Coach')} />}
        <NavItem k="settings" icon="gear" to="/settings" label={t('Settings')} />
        {user?.admin && <NavItem k="admin" icon="wrench" to="/admin" label={t('Admin')} />}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-user-card" onClick={() => nav('/settings')}>
          <div className="sidebar-user-avatar">
            <Icon name={user ? "personCircle" : "key"} />
          </div>
          <div className="sidebar-user-info">
            <span className="sidebar-user-name">
              {user ? (user.name || user.id) : t('Guest Mode')}
            </span>
            <span className="sidebar-user-meta">
              {user ? (user.admin ? 'Administrator' : 'Synced Account') : 'Local Storage Only'}
            </span>
          </div>
        </div>
      </div>
    </aside>
  )
}
