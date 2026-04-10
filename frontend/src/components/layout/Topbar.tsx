// src/components/layout/Topbar.tsx
import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Moon, Sun, Monitor, Bell, Menu, LogOut, Settings } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore, useThemeStore, useUIStore, useSearchStore } from '@/stores'
import { searchService, authService } from '@/services/api'
import { getRiskColor } from '@/types'
import clsx from 'clsx'
import toast from 'react-hot-toast'

export function Topbar() {
  const navigate = useNavigate()
  const { usuario, logout } = useAuthStore()
  const { theme, setTheme } = useThemeStore()
  const { setSidebarCollapsed, sidebarCollapsed, alertasCount } = useUIStore()
  const { query, setQuery, addRecentSearch, recentSearches } = useSearchStore()

  const [inputValue, setInputValue] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showThemeMenu, setShowThemeMenu] = useState(false)

  const searchRef = useRef<HTMLDivElement>(null)
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>()

  // Búsqueda con debounce
  const { data: searchData, isFetching } = useQuery({
    queryKey: ['global-search', query],
    queryFn: () => searchService.global(query, undefined, 8),
    enabled: query.length >= 2,
    staleTime: 30_000,
  })

  const handleInput = useCallback(
    (value: string) => {
      setInputValue(value)
      clearTimeout(searchTimeout.current)
      searchTimeout.current = setTimeout(() => {
        setQuery(value)
        if (value.length >= 2) setShowDropdown(true)
        else setShowDropdown(false)
      }, 300)
    },
    [setQuery]
  )

  const handleSelect = (tipo: string, id: string, nombre: string) => {
    addRecentSearch(inputValue || nombre)
    setShowDropdown(false)
    setInputValue('')
    setQuery('')
    navigate(`/${tipo}s/${id}`)
  }

  // Cerrar dropdown al hacer clic fuera
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Atajo de teclado Cmd/Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        const input = searchRef.current?.querySelector('input')
        input?.focus()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  const handleLogout = async () => {
    try {
      await authService.logout()
    } catch {}
    logout()
    navigate('/login')
    toast.success('Sesión cerrada')
  }

  const THEMES: { value: typeof theme; label: string; icon: typeof Sun }[] = [
    { value: 'light',  label: 'Claro',     icon: Sun },
    { value: 'dark',   label: 'Oscuro',    icon: Moon },
    { value: 'system', label: 'Sistema',   icon: Monitor },
  ]

  return (
    <header
      className="flex items-center gap-3 px-4 flex-shrink-0"
      style={{
        height: 'var(--topbar-h)',
        background: 'var(--bg-primary)',
        borderBottom: '1px solid var(--border)',
      }}
    >
      {/* Sidebar toggle */}
      <button
        className="btn-ghost p-1.5 rounded-md"
        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        title={sidebarCollapsed ? 'Expandir sidebar' : 'Colapsar sidebar'}
      >
        <Menu size={16} style={{ color: 'var(--text-secondary)' }} />
      </button>

      {/* Global search */}
      <div ref={searchRef} className="relative flex-1 max-w-xl">
        <div className="relative">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: 'var(--text-tertiary)' }}
          />
          <input
            className="input pl-8 pr-16 h-8 text-xs"
            placeholder="Buscar persona, empresa, ID... (⌘K)"
            value={inputValue}
            onChange={(e) => handleInput(e.target.value)}
            onFocus={() => {
              if (inputValue.length >= 2 || recentSearches.length > 0)
                setShowDropdown(true)
            }}
          />
          {isFetching && (
            <div
              className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: 'var(--brand)' }}
            />
          )}
          {!isFetching && inputValue && (
            <kbd
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs px-1.5 py-0.5 rounded"
              style={{ background: 'var(--bg-secondary)', color: 'var(--text-tertiary)', fontSize: '10px', border: '1px solid var(--border)' }}
            >
              ESC
            </kbd>
          )}
        </div>

        {/* Search dropdown */}
        {showDropdown && (
          <div
            className="absolute top-full mt-1 left-0 right-0 z-50 rounded-lg overflow-hidden animate-in"
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              boxShadow: 'var(--shadow-lg)',
            }}
          >
            {/* Resultados de búsqueda */}
            {searchData?.resultados && searchData.resultados.length > 0 ? (
              <>
                <div
                  className="px-3 py-1.5 text-xs uppercase tracking-wider"
                  style={{ color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border)', fontSize: '10px' }}
                >
                  {searchData.total} resultado{searchData.total !== 1 ? 's' : ''} · {searchData.tiempo_ms}ms
                </div>
                {searchData.resultados.map((r) => (
                  <button
                    key={r.id}
                    className="w-full flex items-center gap-3 px-3 py-2 text-left hover:opacity-80 transition-opacity"
                    style={{ borderBottom: '1px solid var(--border)' }}
                    onMouseDown={() => handleSelect(r.tipo, r.id, r.nombre)}
                  >
                    <div
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ background: getRiskColor(r.score_riesgo) }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                        {r.nombre}
                      </div>
                      {r.subtitulo && (
                        <div className="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>
                          {r.subtitulo}
                        </div>
                      )}
                    </div>
                    <span
                      className="text-xs px-1.5 py-0.5 rounded flex-shrink-0"
                      style={{
                        background: r.tipo === 'persona' ? '#dbeafe' : '#fef3c7',
                        color: r.tipo === 'persona' ? '#1e40af' : '#92400e',
                        fontSize: '10px',
                      }}
                    >
                      {r.tipo === 'persona' ? 'Persona' : 'Empresa'}
                    </span>
                  </button>
                ))}
                {searchData.total > 8 && (
                  <button
                    className="w-full px-3 py-2 text-xs text-center hover:opacity-80"
                    style={{ color: 'var(--brand)' }}
                    onMouseDown={() => {
                      setShowDropdown(false)
                      navigate(`/search?q=${encodeURIComponent(inputValue)}`)
                    }}
                  >
                    Ver todos los {searchData.total} resultados →
                  </button>
                )}
              </>
            ) : query.length >= 2 && !isFetching ? (
              <div className="px-3 py-4 text-xs text-center" style={{ color: 'var(--text-tertiary)' }}>
                Sin resultados para "{query}"
              </div>
            ) : recentSearches.length > 0 ? (
              <>
                <div
                  className="px-3 py-1.5 text-xs uppercase tracking-wider"
                  style={{ color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border)', fontSize: '10px' }}
                >
                  Búsquedas recientes
                </div>
                {recentSearches.slice(0, 5).map((s) => (
                  <button
                    key={s}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:opacity-80"
                    style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)' }}
                    onMouseDown={() => handleInput(s)}
                  >
                    <Search size={11} />
                    {s}
                  </button>
                ))}
              </>
            ) : null}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 ml-auto">
        {/* Alerts bell */}
        <button
          className="btn-ghost p-1.5 rounded-md relative"
          onClick={() => navigate('/alertas')}
          title="Alertas"
        >
          <Bell size={16} style={{ color: 'var(--text-secondary)' }} />
          {alertasCount > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full text-white flex items-center justify-center"
              style={{ background: 'var(--accent-red)', fontSize: '9px' }}
            >
              {alertasCount > 9 ? '9+' : alertasCount}
            </span>
          )}
        </button>

        {/* Theme toggle */}
        <div className="relative">
          <button
            className="btn-ghost p-1.5 rounded-md"
            onClick={() => setShowThemeMenu(!showThemeMenu)}
            title="Tema"
          >
            {theme === 'dark' ? (
              <Moon size={16} style={{ color: 'var(--text-secondary)' }} />
            ) : theme === 'light' ? (
              <Sun size={16} style={{ color: 'var(--text-secondary)' }} />
            ) : (
              <Monitor size={16} style={{ color: 'var(--text-secondary)' }} />
            )}
          </button>
          {showThemeMenu && (
            <div
              className="absolute right-0 top-full mt-1 z-50 rounded-lg overflow-hidden animate-in"
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                boxShadow: 'var(--shadow-lg)',
                minWidth: '130px',
              }}
            >
              {THEMES.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:opacity-80"
                  style={{
                    color: theme === value ? 'var(--brand)' : 'var(--text-primary)',
                    fontWeight: theme === value ? 500 : 400,
                    borderBottom: '1px solid var(--border)',
                  }}
                  onClick={() => { setTheme(value); setShowThemeMenu(false) }}
                >
                  <Icon size={13} />
                  {label}
                  {theme === value && <span className="ml-auto">✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* User menu */}
        <div className="relative">
          <button
            className="flex items-center gap-2 px-2 py-1 rounded-md hover:opacity-80 transition-opacity"
            onClick={() => setShowUserMenu(!showUserMenu)}
          >
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold"
              style={{ background: 'var(--brand-light)', color: 'var(--brand-dark)' }}
            >
              {(usuario?.nombre_completo || usuario?.username || 'U').slice(0, 2).toUpperCase()}
            </div>
            <div className="hidden sm:block text-left">
              <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                {usuario?.nombre_completo || usuario?.username}
              </div>
              <div className="text-xs" style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>
                Nivel {usuario?.nivel_acceso}
              </div>
            </div>
          </button>

          {showUserMenu && (
            <div
              className="absolute right-0 top-full mt-1 z-50 rounded-lg overflow-hidden animate-in"
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                boxShadow: 'var(--shadow-lg)',
                minWidth: '160px',
              }}
            >
              <button
                className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:opacity-80"
                style={{ color: 'var(--text-primary)', borderBottom: '1px solid var(--border)' }}
                onClick={() => { navigate('/configuracion'); setShowUserMenu(false) }}
              >
                <Settings size={13} /> Configuración
              </button>
              <button
                className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:opacity-80"
                style={{ color: 'var(--accent-red)' }}
                onClick={handleLogout}
              >
                <LogOut size={13} /> Cerrar sesión
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
