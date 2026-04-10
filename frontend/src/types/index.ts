// src/types/index.ts
// ============================================================
// Tipos TypeScript centralizados — espejo de los schemas Python
// ============================================================

// ── AUTH ──────────────────────────────────────────────────────

export interface Usuario {
  id: string
  username: string
  email: string
  nombre_completo: string | null
  rol_id: number
  nivel_acceso: number
  activo: boolean
  ultimo_login: string | null
  created_at: string
}

export interface TokenResponse {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
  usuario: Usuario
}

export interface LoginRequest {
  username: string
  password: string
  totp_code?: string
}

// ── ENTIDADES ────────────────────────────────────────────────

export type EntidadTipo = 'persona' | 'institucion'

export interface PersonaResumen {
  id: string
  nombre_completo: string
  alias: string[] | null
  cargo_actual: string | null
  empresa_actual: string | null
  empresa_nombre: string | null
  ciudad_residencia: string | null
  pais_residencia: string | null
  es_pep: boolean
  en_lista_vigilancia: boolean
  score_riesgo: number
  nivel_prioridad: number
  completitud: number
  nivel_acceso_requerido: number
  created_at: string
  updated_at: string
}

export interface PersonaDetalle extends PersonaResumen {
  nombres: string | null
  apellidos: string | null
  genero: string | null
  fecha_nacimiento: string | null
  lugar_nacimiento: string | null
  fecha_fallecimiento: string | null
  nacionalidad: string | null
  otras_nacs: string[] | null
  estado_civil: string | null
  idiomas: string[] | null
  email_principal: string | null
  telefono_principal: string | null
  direccion_principal: string | null
  sector_principal: string | null
  nivel_pep: number | null
  nivel_riqueza: string | null
  patrimonio_est: number | null
  ingresos_anuales_est: number | null
  listas_externas: string[] | null
  score_influencia: number
  score_version: number
  fuente_primaria: string | null
  perfil_extendido: Record<string, FieldWithMetadata>
  ubicacion_actual?: { lat: number; lng: number }
}

export interface FieldWithMetadata {
  valor: unknown
  fuente: string
  fecha: string
  confianza: number  // 1–5
  verificado: boolean
  verificado_por?: string
  notas?: string
}

export interface InstitucionResumen {
  id: string
  nombre: string
  nombre_corto: string | null
  alias: string[] | null
  sector: string | null
  tipo_entidad: string | null
  pais_registro: string | null
  sede_ciudad: string | null
  estado_legal: string
  score_riesgo: number
  nivel_prioridad: number
  completitud: number
  nivel_acceso_requerido: number
  created_at: string
}

export interface InstitucionDetalle extends InstitucionResumen {
  subsector: string | null
  actividad_desc: string | null
  numero_registro: string | null
  cif_nif: string | null
  fecha_fundacion: string | null
  web_principal: string | null
  email_contacto: string | null
  telefono_central: string | null
  sede_direccion: string | null
  paises_operacion: string[] | null
  empresa_matriz: string | null
  grupo_empresarial: string | null
  tipo_propiedad: string | null
  cotiza_bolsa: boolean
  numero_empleados: number | null
  capital_social: number | null
  patrimonio_neto: number | null
  facturacion_anual: number | null
  rating_credito: string | null
  listas_externas: string[] | null
  score_influencia: number
  fuente_primaria: string | null
  perfil_extendido: Record<string, FieldWithMetadata>
  sede_coords?: { lat: number; lng: number }
}

// ── VÍNCULOS ─────────────────────────────────────────────────

export interface VinculoResumen {
  id: string
  origen_tipo: EntidadTipo
  origen_id: string
  origen_nombre: string | null
  destino_tipo: EntidadTipo
  destino_id: string
  destino_nombre: string | null
  tipo_vinculo_nombre: string | null
  tipo_vinculo_categoria: string | null
  intensidad: number
  vigente: boolean
  fecha_inicio: string | null
  confianza: number
  created_at: string
}

// ── BÚSQUEDA ──────────────────────────────────────────────────

export interface SearchResult {
  tipo: EntidadTipo
  id: string
  nombre: string
  subtitulo: string | null
  ciudad: string | null
  score_riesgo: number
  nivel_acceso_requerido: number
  relevancia: number
}

export interface SearchResponse {
  query: string
  total: number
  resultados: SearchResult[]
  tiempo_ms: number
}

// ── INVESTIGACIONES ───────────────────────────────────────────

export interface InvestigacionResumen {
  id: string
  codigo: string | null
  titulo: string
  estado: 'abierta' | 'en_curso' | 'pausada' | 'cerrada' | 'archivada'
  prioridad: number
  clasificacion: number
  responsable_id: string | null
  fecha_apertura: string
  fecha_objetivo: string | null
  etiquetas: string[] | null
}

// ── ALERTAS ───────────────────────────────────────────────────

export interface Alerta {
  id: string
  tipo_alerta: string
  titulo: string | null
  descripcion: string | null
  severidad: 'baja' | 'media' | 'alta' | 'critica'
  entidad_tipo: EntidadTipo | null
  entidad_id: string | null
  revisada: boolean
  created_at: string
  fuente_nombre: string | null
}

// ── EVENTOS ───────────────────────────────────────────────────

export interface Evento {
  id: string
  tipo_evento: string
  titulo: string
  descripcion: string | null
  fecha_evento: string | null
  importancia: number
  fuente: string | null
  verificado: boolean
}

// ── PAGINACIÓN ────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  total: number
  page: number
  page_size: number
  pages: number
  items: T[]
}

// ── UI ────────────────────────────────────────────────────────

export type Theme = 'light' | 'dark' | 'system'

export interface NavItem {
  id: string
  label: string
  icon: string
  path: string
  nivel_minimo?: number
  badge?: number
}

export type RiskLevel = 'none' | 'low' | 'medium' | 'high' | 'critical'

export function getRiskLevel(score: number): RiskLevel {
  if (score < 0.1) return 'none'
  if (score < 0.3) return 'low'
  if (score < 0.5) return 'medium'
  if (score < 0.75) return 'high'
  return 'critical'
}

export function getRiskColor(score: number): string {
  const level = getRiskLevel(score)
  return {
    none:     '#22c55e',
    low:      '#84cc16',
    medium:   '#f59e0b',
    high:     '#f97316',
    critical: '#ef4444',
  }[level]
}
