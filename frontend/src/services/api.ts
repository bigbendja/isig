// src/services/api.ts
// ============================================================
// Cliente API centralizado — axios con interceptores JWT
// ============================================================
import axios, { type AxiosError } from 'axios'
import toast from 'react-hot-toast'
import type {
  LoginRequest, TokenResponse, SearchResponse,
  PersonaResumen, PersonaDetalle, InstitucionResumen,
  InstitucionDetalle, VinculoResumen, Alerta, Evento,
  InvestigacionResumen, PaginatedResponse,
} from '@/types'

// ── INSTANCIA BASE ────────────────────────────────────────────

export const api = axios.create({
  baseURL: '/api/v1',
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
})

// ── INTERCEPTOR REQUEST — adjunta JWT ─────────────────────────

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// ── INTERCEPTOR RESPONSE — refresca token ─────────────────────

let isRefreshing = false
let failedQueue: Array<{ resolve: (v: string) => void; reject: (e: Error) => void }> = []

const processQueue = (error: Error | null, token: string | null) => {
  failedQueue.forEach(({ resolve, reject }) => {
    if (error) reject(error)
    else resolve(token!)
  })
  failedQueue = []
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as typeof error.config & { _retry?: boolean }

    if (error.response?.status === 401 && !original._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject })
        }).then((token) => {
          original.headers!.Authorization = `Bearer ${token}`
          return api(original)
        })
      }

      original._retry = true
      isRefreshing = true

      const refreshToken = localStorage.getItem('refresh_token')
      if (!refreshToken) {
        useAuthStore_logout()
        return Promise.reject(error)
      }

      try {
        const { data } = await axios.post('/api/v1/auth/refresh', {
          refresh_token: refreshToken,
        })
        const newToken = data.access_token
        localStorage.setItem('access_token', newToken)
        localStorage.setItem('refresh_token', data.refresh_token)
        api.defaults.headers.common.Authorization = `Bearer ${newToken}`
        processQueue(null, newToken)
        original.headers!.Authorization = `Bearer ${newToken}`
        return api(original)
      } catch (refreshError) {
        processQueue(refreshError as Error, null)
        useAuthStore_logout()
        return Promise.reject(refreshError)
      } finally {
        isRefreshing = false
      }
    }

    // Mostrar error al usuario
    const msg = (error.response?.data as { detail?: string })?.detail
    if (error.response?.status !== 401) {
      toast.error(msg || 'Error de conexión con el servidor')
    }

    return Promise.reject(error)
  }
)

// Importación diferida para evitar ciclo circular
function useAuthStore_logout() {
  localStorage.removeItem('access_token')
  localStorage.removeItem('refresh_token')
  localStorage.removeItem('usuario')
  window.location.href = '/login'
}

// ============================================================
// SERVICIOS
// ============================================================

// ── AUTH ──────────────────────────────────────────────────────

export const authService = {
  login: (data: LoginRequest) =>
    api.post<TokenResponse>('/auth/login', data).then((r) => r.data),

  logout: () => api.post('/auth/logout').then((r) => r.data),

  refresh: (refresh_token: string) =>
    api.post<TokenResponse>('/auth/refresh', { refresh_token }).then((r) => r.data),

  setup2fa: () =>
    api.post<{ qr_image_b64: string; secret: string }>('/auth/2fa/setup').then((r) => r.data),

  verify2fa: (code: string) =>
    api.post('/auth/2fa/verify', { code }).then((r) => r.data),

  changePassword: (current_password: string, new_password: string) =>
    api.post('/auth/change-password', { current_password, new_password }).then((r) => r.data),
}

// ── BÚSQUEDA ──────────────────────────────────────────────────

export const searchService = {
  global: (q: string, tipo?: string, limite = 20) =>
    api.get<SearchResponse>('/search', { params: { q, tipo, limite } }).then((r) => r.data),
}

// ── PERSONAS ──────────────────────────────────────────────────

export const personasService = {
  listar: (params?: {
    page?: number; page_size?: number; sector?: string
    pais?: string; es_pep?: boolean; vigilancia?: boolean
    riesgo_min?: number; orden?: string
    buscar?: string; etiqueta_ids?: string
  }) =>
    api.get<PaginatedResponse<PersonaResumen>>('/personas', { params }).then((r) => r.data),

  obtener: (id: string) =>
    api.get<PersonaDetalle>(`/personas/${id}`).then((r) => r.data),

  crear: (data: Partial<PersonaDetalle>) =>
    api.post<PersonaResumen>('/personas', data).then((r) => r.data),

  actualizar: (id: string, data: Partial<PersonaDetalle>) =>
    api.patch<PersonaResumen>(`/personas/${id}`, data).then((r) => r.data),

  eliminar: (id: string) =>
    api.delete(`/personas/${id}`).then((r) => r.data),

  recalcularScore: (id: string) =>
    api.post(`/personas/${id}/recalcular-score`).then((r) => r.data),

  eventos: (id: string) =>
    api.get<Evento[]>(`/personas/${id}/eventos`).then((r) => r.data),

  vinculos: (id: string) =>
    api.get<PaginatedResponse<VinculoResumen>>(
      `/vinculos/entidad/persona/${id}`
    ).then((r) => r.data),
}

// ── INSTITUCIONES ─────────────────────────────────────────────

export const institucionesService = {
  listar: (params?: {
    page?: number; page_size?: number
    sector?: string; pais?: string; estado_legal?: string
    vigilancia?: boolean; buscar?: string; etiqueta_ids?: string
  }) =>
    api.get<PaginatedResponse<InstitucionResumen>>('/instituciones', { params }).then((r) => r.data),

  obtener: (id: string) =>
    api.get<InstitucionDetalle>(`/instituciones/${id}`).then((r) => r.data),

  crear: (data: Partial<InstitucionDetalle>) =>
    api.post<InstitucionResumen>('/instituciones', data).then((r) => r.data),

  actualizar: (id: string, data: Partial<InstitucionDetalle>) =>
    api.patch<InstitucionResumen>(`/instituciones/${id}`, data).then((r) => r.data),

  vinculos: (id: string) =>
    api.get<PaginatedResponse<VinculoResumen>>(
      `/vinculos/entidad/institucion/${id}`
    ).then((r) => r.data),
}

// ── VÍNCULOS ─────────────────────────────────────────────────

export const vinculosService = {
  crear: (data: Partial<VinculoResumen>) =>
    api.post<VinculoResumen>('/vinculos', data).then((r) => r.data),

  eliminar: (id: string) =>
    api.delete(`/vinculos/${id}`).then((r) => r.data),
}

// ── ALERTAS ───────────────────────────────────────────────────

export const alertasService = {
  listar: (params?: { revisada?: boolean; severidad?: string; page?: number }) =>
    api.get<PaginatedResponse<Alerta>>('/alertas', { params }).then((r) => r.data),

  revisar: (id: string, accion: string, notas?: string) =>
    api.patch(`/alertas/${id}/revisar`, { accion, notas }).then((r) => r.data),
}

// ── INVESTIGACIONES ───────────────────────────────────────────

export const investigacionesService = {
  listar: (params?: { estado?: string; page?: number }) =>
    api.get<PaginatedResponse<InvestigacionResumen>>('/investigaciones', { params }).then((r) => r.data),

  obtener: (id: string) =>
    api.get(`/investigaciones/${id}`).then((r) => r.data),

  crear: (data: Partial<InvestigacionResumen>) =>
    api.post<InvestigacionResumen>('/investigaciones', data).then((r) => r.data),
}

// ── ESTADÍSTICAS / OVERVIEW ───────────────────────────────────

export const statsService = {
  overview: () =>
    api.get<{
      total_personas: number
      total_instituciones: number
      total_vinculos: number
      alertas_pendientes: number
      score_medio_riesgo: number
      registros_hoy: number
    }>('/stats/overview').then((r) => r.data),
}

// ── MAPA ──────────────────────────────────────────────────────

export const mapaService = {
  entidades: (bounds?: {
    norte: number; sur: number; este: number; oeste: number
  }, tipo?: string) =>
    api.get<Array<{
      id: string; tipo: EntidadTipo; nombre: string
      lat: number; lng: number; score_riesgo: number
    }>>('/mapa/entidades', { params: { ...bounds, tipo } }).then((r) => r.data),
}

// ── IA ────────────────────────────────────────────────────────

export const iaService = {
  analizarExpediente: (entidad_tipo: string, entidad_id: string, instruccion?: string) =>
    api.post<{ analisis: string; modelo: string; tokens_usados: number }>(
      '/ia/analizar-expediente',
      { entidad_tipo, entidad_id, instruccion }
    ).then((r) => r.data),

  chat: (mensaje: string, contexto?: string) =>
    api.post<{ respuesta: string }>('/ia/chat', { mensaje, contexto }).then((r) => r.data),
}

type EntidadTipo = 'persona' | 'institucion'
