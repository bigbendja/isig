// src/stores/index.ts
// ============================================================
// Zustand stores — estado global de la aplicación
// ============================================================
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Theme, Usuario } from '@/types'

// ── AUTH STORE ────────────────────────────────────────────────

interface AuthState {
  usuario: Usuario | null
  isAuthenticated: boolean
  requires2FA: boolean
  setUsuario: (usuario: Usuario, accessToken: string, refreshToken: string) => void
  logout: () => void
  setRequires2FA: (v: boolean) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      usuario: null,
      isAuthenticated: false,
      requires2FA: false,

      setUsuario: (usuario, accessToken, refreshToken) => {
        localStorage.setItem('access_token', accessToken)
        localStorage.setItem('refresh_token', refreshToken)
        set({ usuario, isAuthenticated: true, requires2FA: false })
      },

      logout: () => {
        localStorage.removeItem('access_token')
        localStorage.removeItem('refresh_token')
        set({ usuario: null, isAuthenticated: false })
      },

      setRequires2FA: (v) => set({ requires2FA: v }),
    }),
    {
      name: 'sigint-auth',
      partialize: (state) => ({ usuario: state.usuario, isAuthenticated: state.isAuthenticated }),
    }
  )
)

// ── THEME STORE ───────────────────────────────────────────────

interface ThemeState {
  theme: Theme
  resolvedTheme: 'light' | 'dark'
  setTheme: (theme: Theme) => void
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'system',
      resolvedTheme: 'light',

      setTheme: (theme) => {
        const resolved =
          theme === 'system'
            ? window.matchMedia('(prefers-color-scheme: dark)').matches
              ? 'dark'
              : 'light'
            : theme

        document.documentElement.classList.toggle('dark', resolved === 'dark')
        set({ theme, resolvedTheme: resolved })
      },
    }),
    { name: 'sigint-theme' }
  )
)

// ── UI STORE ──────────────────────────────────────────────────

interface UIState {
  sidebarCollapsed: boolean
  activePanel: string
  searchOpen: boolean
  alertasCount: number
  setSidebarCollapsed: (v: boolean) => void
  setActivePanel: (panel: string) => void
  setSearchOpen: (v: boolean) => void
  setAlertasCount: (n: number) => void
}

export const useUIStore = create<UIState>((set) => ({
  sidebarCollapsed: false,
  activePanel: 'overview',
  searchOpen: false,
  alertasCount: 0,

  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
  setActivePanel: (panel) => set({ activePanel: panel }),
  setSearchOpen: (v) => set({ searchOpen: v }),
  setAlertasCount: (n) => set({ alertasCount: n }),
}))

// ── SEARCH STORE ──────────────────────────────────────────────

interface SearchState {
  query: string
  recentSearches: string[]
  setQuery: (q: string) => void
  addRecentSearch: (q: string) => void
  clearRecent: () => void
}

export const useSearchStore = create<SearchState>()(
  persist(
    (set, get) => ({
      query: '',
      recentSearches: [],

      setQuery: (q) => set({ query: q }),

      addRecentSearch: (q) => {
        if (!q.trim() || q.length < 2) return
        const recent = [q, ...get().recentSearches.filter((r) => r !== q)].slice(0, 10)
        set({ recentSearches: recent })
      },

      clearRecent: () => set({ recentSearches: [] }),
    }),
    { name: 'sigint-search' }
  )
)
