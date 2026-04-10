// src/pages/Overview.tsx — Centro de Mando v2
// 3 estados: silencio / anomalía / crítico
// Arquitectura: Plan Maestro SIGINT DataCenter Pro
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Activity, Users, Building2, Network, Bell, ArrowRight, Clock, MapPin, RefreshCw } from 'lucide-react'
import { api, statsService, alertasService } from '@/services/api'
import { getRiskColor } from '@/types'
import { WorldDominationMap } from '@/components/WorldDominationMap'

// ── TIPOS ─────────────────────────────────────────────────────
type Estado = 'silencio' | 'anomalia' | 'critico'

// ── AFIRMACIÓN ATÓMICA ────────────────────────────────────────
function AfirmacionAtomica({ afirmacion, confianza, origen }: {
  afirmacion: string; confianza: number; origen: string
}) {
  const color = confianza >= 80 ? '#22c55e' : confianza >= 60 ? '#f59e0b' : '#ef4444'
  return (
    <div className="px-3 py-2.5 rounded-lg" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
      <div className="text-xs font-medium mb-1.5" style={{ color: 'var(--text-primary)', lineHeight: '1.5' }}>
        {afirmacion}
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1">
          <span style={{ fontSize: '9px', fontFamily: 'monospace', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>CONFIANZA</span>
          <span className="text-xs font-bold" style={{ color, fontFamily: 'monospace' }}>{confianza}%</span>
        </div>
        <div className="flex items-center gap-1 flex-1 min-w-0">
          <span style={{ fontSize: '9px', fontFamily: 'monospace', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>ORIGEN</span>
          <span className="truncate" style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{origen}</span>
        </div>
      </div>
    </div>
  )
}

// ── KPI CARD ──────────────────────────────────────────────────
function KpiCard({ label, value, delta, icon, color, onClick }: {
  label: string; value: string | number; delta?: string; icon: React.ReactNode; color?: string; onClick?: () => void
}) {
  return (
    <div className="card p-4 cursor-pointer hover:opacity-90 transition-opacity group" onClick={onClick}>
      <div className="flex items-start justify-between mb-2">
        <div className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-tertiary)', fontSize: '9px', letterSpacing: '0.1em' }}>{label}</div>
        <span style={{ color: color || 'var(--text-tertiary)', opacity: 0.5 }}>{icon}</span>
      </div>
      <div className="text-2xl font-semibold mb-0.5" style={{ color: color || 'var(--text-primary)' }}>{value}</div>
      {delta && <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{delta}</div>}
      <div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <span style={{ fontSize: '10px', color: 'var(--brand)' }}>Ver detalle</span>
        <ArrowRight size={10} style={{ color: 'var(--brand)' }} />
      </div>
    </div>
  )
}

// ── BADGE SEVERIDAD ───────────────────────────────────────────
function SevBadge({ sev }: { sev: string }) {
  const cfg: Record<string, {bg:string;text:string}> = {
    critica: { bg:'#fee2e2', text:'#991b1b' },
    alta:    { bg:'#ffedd5', text:'#9a3412' },
    media:   { bg:'#fef9c3', text:'#854d0e' },
    baja:    { bg:'#f0fdf4', text:'#166534' },
  }
  const c = cfg[sev] || cfg.baja
  return (
    <span className="text-xs px-2 py-0.5 rounded font-semibold"
      style={{ background: c.bg, color: c.text, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
      {sev}
    </span>
  )
}

// ── MAIN COMPONENT ────────────────────────────────────────────
export function Overview() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<'resumen'|'alertas'|'actividad'|'tareas'>('resumen')
  const [estado, setEstado] = useState<Estado>('silencio')
  const [lastUpdate, setLastUpdate] = useState(new Date())

  // Data fetching
  const { data: stats, refetch: refetchStats } = useQuery({
    queryKey: ['stats-overview'],
    queryFn: statsService.overview,
    refetchInterval: 60_000,
  })

  const { data: alertasData } = useQuery({
    queryKey: ['alertas-pendientes'],
    queryFn: () => alertasService.listar({ revisada: false, page: 1 }),
    refetchInterval: 30_000,
  })

  const { data: investigaciones } = useQuery({
    queryKey: ['investigaciones-recientes'],
    queryFn: () => api.get('/investigaciones?page=1&page_size=8').then((r: any) => r.data).catch(() => ({ items: [] })),
  })

  const { data: mlStats } = useQuery({
    queryKey: ['ml-stats'],
    queryFn: () => api.get('/ml/stats').then((r: any) => r.data).catch(() => ({})),
    refetchInterval: 120_000,
  })

  const alertas = alertasData?.items || []
  const alertasCriticas = alertas.filter((a: any) => a.severidad === 'critica')
  const alertasAltas    = alertas.filter((a: any) => a.severidad === 'alta')

  // Auto-detect estado based on real data
  useEffect(() => {
    if (alertasCriticas.length > 0) setEstado('critico')
    else if (alertasAltas.length > 0 || alertas.length > 5) setEstado('anomalia')
    else setEstado('silencio')
  }, [alertasCriticas.length, alertasAltas.length, alertas.length])

  // Estado-driven colors
  const estadoColor = estado === 'critico' ? '#dc2626' : estado === 'anomalia' ? '#f59e0b' : '#22c55e'
  const estadoBg    = estado === 'critico' ? '#fee2e2' : estado === 'anomalia' ? '#fef9c3' : '#f0fdf4'
  const estadoLabel = estado === 'critico' ? 'ALERTA CRÍTICA ACTIVA' : estado === 'anomalia' ? 'ANOMALÍA DETECTADA' : 'SISTEMA NOMINAL'

  const TABS = [
    { key: 'resumen',   label: 'Resumen' },
    { key: 'alertas',   label: `Alertas${alertas.length ? ` (${alertas.length})` : ''}` },
    { key: 'actividad', label: 'Actividad' },
    { key: 'tareas',    label: 'Mis tareas' },
  ]

  return (
    <div className="animate-in max-w-7xl mx-auto space-y-6">

      {/* ── ESTADO HEADER ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full"
            style={{ background: estadoBg, border: `1px solid ${estadoColor}33` }}>
            <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: estadoColor }} />
            <span className="text-xs font-bold tracking-widest" style={{ color: estadoColor, fontSize: '10px' }}>
              {estadoLabel}
            </span>
          </div>
          {/* Manual override */}
          <div className="flex gap-1">
            {(['silencio','anomalia','critico'] as Estado[]).map(e => (
              <button key={e} className="text-xs px-2 py-1 rounded transition-all"
                style={{
                  background: estado === e ? estadoColor : 'var(--bg-secondary)',
                  color: estado === e ? '#fff' : 'var(--text-tertiary)',
                  border: `1px solid ${estado === e ? estadoColor : 'var(--border)'}`,
                  fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.08em',
                }}
                onClick={() => setEstado(e)}>
                {e}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            <Clock size={11} />
            <span>Actualizado {lastUpdate.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <button className="btn p-1.5" onClick={() => { refetchStats(); setLastUpdate(new Date()) }}>
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      {/* ── FRANJA ALERTA CRÍTICA ── */}
      {(estado === 'critico' || alertasCriticas.length > 0) && (
        <div className="rounded-xl px-4 py-3 flex items-center gap-4"
          style={{ background: '#fee2e2', border: '1px solid #fca5a5' }}>
          <AlertTriangle size={18} style={{ color: '#dc2626', flexShrink: 0 }} />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold" style={{ color: '#991b1b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {alertasCriticas.length || 1} alerta{alertasCriticas.length !== 1 ? 's' : ''} crítica{alertasCriticas.length !== 1 ? 's' : ''} activa{alertasCriticas.length !== 1 ? 's' : ''}
            </div>
            <div className="text-xs truncate" style={{ color: '#dc2626' }}>
              {alertasCriticas[0]?.titulo || 'Situación crítica requiere atención inmediata'}
            </div>
          </div>
          <button className="text-xs px-3 py-1.5 rounded-lg flex-shrink-0 hover:opacity-80"
            style={{ background: '#dc2626', color: '#fff' }}
            onClick={() => { setActiveTab('alertas'); navigate('/alertas') }}>
            Ver detalle →
          </button>
        </div>
      )}

      {/* ── TABS ── */}
      <div style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex gap-1">
          {TABS.map(t => (
            <button key={t.key}
              className="px-4 py-2 text-xs font-medium transition-all"
              style={{
                borderBottom: activeTab === t.key ? `2px solid ${estadoColor}` : '2px solid transparent',
                color: activeTab === t.key ? estadoColor : 'var(--text-secondary)',
                marginBottom: '-1px',
              }}
              onClick={() => setActiveTab(t.key as any)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════
          TAB RESUMEN
      ══════════════════════════════════════════════════════════ */}
      {activeTab === 'resumen' && (
        <div className="space-y-6">

          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard label="Personas" value={stats?.total_personas?.toLocaleString() ?? '—'} icon={<Users size={16}/>} onClick={() => navigate('/personas')} />
            <KpiCard label="Instituciones" value={stats?.total_instituciones?.toLocaleString() ?? '—'} icon={<Building2 size={16}/>} onClick={() => navigate('/instituciones')} />
            <KpiCard label="Vínculos" value={stats?.total_vinculos?.toLocaleString() ?? '—'} icon={<Network size={16}/>} onClick={() => navigate('/personas')} />
            <KpiCard label="Alertas pendientes" value={alertas.length || '—'} color={alertas.length ? '#dc2626' : undefined} icon={<Bell size={16}/>} onClick={() => navigate('/alertas')} />
          </div>

          {/* Señal proactiva IA */}
          {mlStats && (mlStats.total_pep > 0 || mlStats.en_vigilancia > 0) && (
            <div className="rounded-xl px-4 py-3" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                  style={{ background: 'var(--brand-light)' }}>
                  <span style={{ fontSize: '12px' }}>🤖</span>
                </div>
                <div className="flex-1">
                  <div style={{ fontSize: '9px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '4px' }}>
                    SEÑAL PROACTIVA · Sistema
                  </div>
                  <AfirmacionAtomica
                    afirmacion={`${mlStats.en_vigilancia || 0} entidad${mlStats.en_vigilancia !== 1 ? 'es' : ''} en lista de vigilancia activa. ${mlStats.total_pep || 0} PEP registrado${mlStats.total_pep !== 1 ? 's' : ''} en el sistema.`}
                    confianza={94}
                    origen={`Sistema SIGINT · BD principal · ${new Date().toLocaleDateString('es-ES')}`}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Mapa + Feed + Mini-grafo */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* Mapa — 2 columnas */}
            <div className="lg:col-span-2 card overflow-hidden" style={{ minHeight: '340px' }}>
              <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                    🗺️ Mapa de inteligencia
                  </span>
                  <span className="text-xs ml-2" style={{ color: 'var(--text-tertiary)' }}>Entidades posicionadas</span>
                </div>
                <button className="text-xs flex items-center gap-1 hover:opacity-80" style={{ color: 'var(--brand)' }}
                  onClick={() => navigate('/mapa')}>
                  Explorar completo <ArrowRight size={11} />
                </button>
              </div>
              <div style={{ height: '300px' }}>
                <WorldDominationMap />
              </div>
            </div>

            {/* Feed resumido — 1 columna */}
            <div className="card overflow-hidden" style={{ display: 'flex', flexDirection: 'column' }}>
              <div className="flex items-center justify-between px-4 py-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                  ⚡ Feed de alertas
                </span>
                <button className="text-xs flex items-center gap-1 hover:opacity-80" style={{ color: 'var(--brand)' }}
                  onClick={() => navigate('/alertas')}>
                  Ver todo <ArrowRight size={11} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto" style={{ maxHeight: '280px' }}>
                {alertas.slice(0, 8).map((a: any) => (
                  <button key={a.id} className="w-full flex items-start gap-2.5 px-4 py-3 text-left hover:opacity-80 transition-opacity"
                    style={{ borderBottom: '1px solid var(--border)' }}
                    onClick={() => navigate('/alertas')}>
                    <SevBadge sev={a.severidad} />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                        {a.titulo || a.tipo_alerta}
                      </div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>
                        {new Date(a.created_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })} · {a.tipo_alerta?.replace('_', ' ')}
                      </div>
                    </div>
                  </button>
                ))}
                {!alertas.length && (
                  <div className="flex flex-col items-center justify-center py-10 gap-2">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: '#f0fdf4' }}>
                      <span>✓</span>
                    </div>
                    <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Sin alertas pendientes</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Investigaciones activas + Entidades de riesgo */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* Investigaciones */}
            <div className="card overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                  🔍 Investigaciones activas
                </span>
                <button className="text-xs flex items-center gap-1 hover:opacity-80" style={{ color: 'var(--brand)' }}
                  onClick={() => navigate('/investigaciones')}>
                  Ver todas <ArrowRight size={11} />
                </button>
              </div>
              {(investigaciones?.items || []).slice(0, 5).map((inv: any) => (
                <button key={inv.id} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:opacity-80"
                  style={{ borderBottom: '1px solid var(--border)' }}
                  onClick={() => navigate(`/investigaciones/${inv.id}`)}>
                  <div className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0"
                    style={{ background: inv.estado === 'en_curso' ? '#dbeafe' : '#f1f5f9' }}>
                    <span style={{ fontSize: '11px' }}>🔍</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{inv.titulo}</div>
                    <div className="text-xs" style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>
                      {inv.codigo} · {inv.estado?.replace('_', ' ')}
                    </div>
                  </div>
                  <div className="flex gap-0.5 flex-shrink-0">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="w-1 h-3 rounded-sm"
                        style={{ background: i < inv.prioridad ? '#f59e0b' : 'var(--bg-tertiary)' }} />
                    ))}
                  </div>
                </button>
              ))}
              {!investigaciones?.items?.length && (
                <div className="px-4 py-6 text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  No hay investigaciones activas
                </div>
              )}
            </div>

            {/* Métricas de riesgo */}
            <div className="card p-4 space-y-4">
              <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                📊 Métricas de inteligencia
              </div>
              {mlStats ? (
                <div className="space-y-3">
                  {[
                    { label: 'Score medio personas', value: mlStats.score_medio_personas, max: 1, fmt: (v: number) => `${Math.round(v * 100)}%` },
                    { label: 'Score medio instituciones', value: mlStats.score_medio_instituciones, max: 1, fmt: (v: number) => `${Math.round(v * 100)}%` },
                  ].map(m => (
                    <div key={m.label}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{m.label}</span>
                        <span className="text-xs font-semibold" style={{ color: getRiskColor(m.value || 0) }}>
                          {m.value ? m.fmt(m.value) : '—'}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-tertiary)' }}>
                        <div className="h-full rounded-full" style={{ width: `${(m.value || 0) * 100}%`, background: getRiskColor(m.value || 0) }} />
                      </div>
                    </div>
                  ))}
                  <div className="grid grid-cols-2 gap-3 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
                    {[
                      { label: 'PEPs', value: mlStats.total_pep, color: '#f59e0b' },
                      { label: 'En vigilancia', value: mlStats.en_vigilancia, color: '#dc2626' },
                      { label: 'Total vínculos', value: mlStats.total_vinculos, color: undefined },
                      { label: 'Alertas activas', value: mlStats.alertas_pendientes, color: mlStats.alertas_pendientes ? '#dc2626' : undefined },
                    ].map(m => (
                      <div key={m.label} className="text-center p-2 rounded-lg" style={{ background: 'var(--bg-secondary)' }}>
                        <div className="text-lg font-semibold" style={{ color: m.color || 'var(--text-primary)' }}>{m.value ?? '—'}</div>
                        <div style={{ fontSize: '9px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{m.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-xs text-center py-6" style={{ color: 'var(--text-tertiary)' }}>Cargando métricas...</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          TAB ALERTAS
      ══════════════════════════════════════════════════════════ */}
      {activeTab === 'alertas' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              {alertas.length} alerta{alertas.length !== 1 ? 's' : ''} pendiente{alertas.length !== 1 ? 's' : ''}
            </h2>
            <button className="btn-primary text-xs py-1.5 px-4" onClick={() => navigate('/alertas')}>
              Gestionar en módulo completo →
            </button>
          </div>

          {alertas.length === 0 && (
            <div className="card p-10 text-center">
              <div className="text-3xl mb-3">✓</div>
              <div className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Sistema nominal</div>
              <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>No hay alertas pendientes de revisión</div>
            </div>
          )}

          {alertas.map((a: any) => (
            <div key={a.id} className="card p-4">
              <div className="flex items-start gap-3">
                <SevBadge sev={a.severidad} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>{a.titulo || a.tipo_alerta}</div>
                  {a.descripcion && <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>{a.descripcion}</p>}
                  <AfirmacionAtomica
                    afirmacion={a.titulo || a.descripcion || 'Alerta generada por el sistema'}
                    confianza={a.severidad === 'critica' ? 95 : a.severidad === 'alta' ? 85 : 70}
                    origen={`${a.tipo_alerta?.replace('_', ' ')} · ${new Date(a.created_at).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
                  />
                </div>
                <button className="btn text-xs py-1 px-2 flex-shrink-0" onClick={() => navigate('/alertas')}>
                  Revisar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          TAB ACTIVIDAD
      ══════════════════════════════════════════════════════════ */}
      {activeTab === 'actividad' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Actividad reciente</h2>
            <button className="text-xs hover:opacity-80" style={{ color: 'var(--brand)' }}
              onClick={() => navigate('/auditoria')}>
              Ver registro completo →
            </button>
          </div>
          <ActivityFeed />
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          TAB MIS TAREAS
      ══════════════════════════════════════════════════════════ */}
      {activeTab === 'tareas' && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Mis tareas pendientes</h2>

          {/* Alertas asignadas */}
          {alertas.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                  ⚠️ Alertas pendientes de revisión
                </span>
              </div>
              {alertas.slice(0, 5).map((a: any) => (
                <button key={a.id} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:opacity-80"
                  style={{ borderBottom: '1px solid var(--border)' }}
                  onClick={() => navigate('/alertas')}>
                  <SevBadge sev={a.severidad} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{a.titulo || a.tipo_alerta}</div>
                  </div>
                  <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    {new Date(a.created_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Investigaciones activas */}
          {investigaciones?.items?.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                  🔍 Investigaciones a mi cargo
                </span>
              </div>
              {investigaciones.items.slice(0, 5).map((inv: any) => (
                <button key={inv.id} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:opacity-80"
                  style={{ borderBottom: '1px solid var(--border)' }}
                  onClick={() => navigate(`/investigaciones/${inv.id}`)}>
                  <div className="text-xs font-mono" style={{ color: 'var(--brand)' }}>{inv.codigo}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{inv.titulo}</div>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded" style={{ background: '#dbeafe', color: '#1e40af', fontSize: '10px' }}>
                    {inv.estado?.replace('_', ' ')}
                  </span>
                </button>
              ))}
            </div>
          )}

          {!alertas.length && !investigaciones?.items?.length && (
            <div className="card p-10 text-center">
              <div className="text-3xl mb-3">✅</div>
              <div className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Al día</div>
              <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>No tienes tareas pendientes</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── ACTIVITY FEED ─────────────────────────────────────────────
function ActivityFeed() {
  const { data } = useQuery({
    queryKey: ['auditoria-overview'],
    queryFn: () => api.get('/auditoria?limite=20').then((r: any) => r.data).catch(() => ({ items: [] })),
  })

  const ACCION_CFG: Record<string, {icon:string;color:string;label:string}> = {
    login:   { icon: '🔑', color: '#22c55e', label: 'Acceso' },
    create:  { icon: '➕', color: '#3b82f6', label: 'Creación' },
    update:  { icon: '✏️', color: '#f59e0b', label: 'Edición' },
    delete:  { icon: '🗑️', color: '#ef4444', label: 'Eliminación' },
    view:    { icon: '👁️', color: '#6b7280', label: 'Consulta' },
    ai_chat: { icon: '🤖', color: '#8b5cf6', label: 'IA Chat' },
    export:  { icon: '📤', color: '#0ea5e9', label: 'Exportación' },
  }

  const items = data?.items || []

  if (!items.length) {
    return (
      <div className="card p-8 text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>
        Sin actividad registrada en el sistema
      </div>
    )
  }

  return (
    <div className="card overflow-hidden">
      {items.map((item: any, i: number) => {
        const cfg = ACCION_CFG[item.accion] || { icon: '⚡', color: '#6b7280', label: item.accion }
        return (
          <div key={item.id || i} className="flex items-start gap-3 px-4 py-3"
            style={{ borderBottom: '1px solid var(--border)' }}>
            <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
              style={{ background: `${cfg.color}22`, fontSize: '12px' }}>
              {cfg.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                  {item.username || 'Sistema'}
                </span>
                <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: `${cfg.color}22`, color: cfg.color, fontSize: '9px' }}>
                  {cfg.label}
                </span>
                {item.recurso_tipo && (
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {item.recurso_tipo}
                  </span>
                )}
              </div>
              {item.recurso_desc && (
                <div className="text-xs truncate mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{item.recurso_desc}</div>
              )}
            </div>
            <div className="text-xs flex-shrink-0" style={{ color: 'var(--text-tertiary)' }}>
              {item.created_at ? new Date(item.created_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '—'}
            </div>
          </div>
        )
      })}
    </div>
  )
}
