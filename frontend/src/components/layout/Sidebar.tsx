// src/components/layout/Sidebar.tsx
import { NavLink, useLocation } from 'react-router-dom'
import { useAuthStore, useUIStore } from '@/stores'
import clsx from 'clsx'

const NAV_SECTIONS = [
  {
    label: 'Principal',
    items: [
      { path: '/',                label: 'Panel general',   icon: '▣', nivel: 1 },
      { path: '/personas',        label: 'Personas',        icon: '◉', nivel: 1 },
      { path: '/instituciones',   label: 'Instituciones',   icon: '◈', nivel: 1 },
      { path: '/investigaciones', label: 'Investigaciones', icon: '◧', nivel: 2 },
      { path: '/alertas',         label: 'Alertas',         icon: '◆', nivel: 1, badge: 'alertas' },
    ],
  },
  {
    label: 'Análisis',
    items: [
      { path: '/analytics', label: 'Analytics',      icon: '◈', nivel: 2 },
      { path: '/ia',        label: 'Asistente IA',   icon: '◉', nivel: 2 },
      { path: '/osint',     label: 'OSINT / Ingesta',icon: '◎', nivel: 3 },
      { path: '/archivos',  label: 'Archivos',       icon: '◧', nivel: 2 },
    ],
  },
  {
    label: 'Sistema',
    items: [
      { path: '/usuarios',      label: 'Usuarios',      icon: '◉', nivel: 4 },
      { path: '/auditoria',     label: 'Auditoría',     icon: '◆', nivel: 4 },
      { path: '/configuracion', label: 'Configuración', icon: '◈', nivel: 1 },
    ],
  },
]

export function Sidebar() {
  const { usuario } = useAuthStore()
  const { sidebarCollapsed, alertasCount } = useUIStore()
  const location = useLocation()

  const nivel = usuario?.nivel_acceso ?? 0

  return (
    <aside
      className="flex flex-col h-full transition-all duration-200 flex-shrink-0"
      style={{
        width: sidebarCollapsed ? '52px' : '220px',
        background: 'var(--bg-primary)',
        borderRight: '1px solid var(--border)',
      }}
    >
      {/* Logo */}
      <div
        className="flex items-center gap-2 px-4 h-13 flex-shrink-0"
        style={{
          height: 'var(--topbar-h)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div
          className="w-7 h-7 rounded flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
          style={{ background: 'var(--brand)' }}
        >
          SI
        </div>
        {!sidebarCollapsed && (
          <div className="min-w-0">
            <div className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              SIGINT
            </div>
            <div className="text-xs truncate" style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>
              DataCenter Pro
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2">
        {NAV_SECTIONS.map((section) => {
          const visibleItems = section.items.filter((i) => nivel >= (i.nivel ?? 1))
          if (visibleItems.length === 0) return null

          return (
            <div key={section.label} className="mb-1">
              {!sidebarCollapsed && (
                <div
                  className="px-3 py-1 text-xs font-medium uppercase tracking-wider"
                  style={{ color: 'var(--text-tertiary)', fontSize: '10px', letterSpacing: '0.08em' }}
                >
                  {section.label}
                </div>
              )}
              {visibleItems.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.path === '/'}
                  className={({ isActive }) =>
                    clsx(
                      'flex items-center gap-2 mx-2 px-2 py-1.5 rounded-md text-xs transition-all duration-150',
                      isActive
                        ? 'font-medium'
                        : 'hover:opacity-80'
                    )
                  }
                  style={({ isActive }) => ({
                    background: isActive ? 'var(--brand-light)' : 'transparent',
                    color: isActive ? 'var(--brand-dark)' : 'var(--text-secondary)',
                  })}
                >
                  <span className="text-sm flex-shrink-0">{item.icon}</span>
                  {!sidebarCollapsed && (
                    <>
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.badge === 'alertas' && alertasCount > 0 && (
                        <span
                          className="text-white text-xs px-1.5 py-0.5 rounded-full"
                          style={{ background: 'var(--accent-red)', fontSize: '10px', minWidth: '18px', textAlign: 'center' }}
                        >
                          {alertasCount > 99 ? '99+' : alertasCount}
                        </span>
                      )}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          )
        })}
      </nav>

      {/* User chip */}
      {!sidebarCollapsed && usuario && (
        <div
          className="p-3 flex-shrink-0"
          style={{ borderTop: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0"
              style={{ background: 'var(--brand-light)', color: 'var(--brand-dark)' }}
            >
              {(usuario.nombre_completo || usuario.username).slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                {usuario.nombre_completo || usuario.username}
              </div>
              <div className="flex items-center gap-1">
                <span
                  className="text-xs px-1.5 py-0.5 rounded"
                  style={{
                    background: 'var(--brand-light)',
                    color: 'var(--brand-dark)',
                    fontSize: '10px',
                  }}
                >
                  N{usuario.nivel_acceso}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}
