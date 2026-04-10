// src/pages/Analytics.tsx — v2 completo y funcional
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts'
import { Users, Building2, Link, AlertTriangle, TrendingUp, Shield } from 'lucide-react'
import { api } from '@/services/api'
import { getRiskColor } from '@/types'

const SEV_COLORS: Record<string, string> = {
  'Sin riesgo': '#22c55e', 'Bajo': '#84cc16',
  'Medio': '#f59e0b', 'Alto': '#f97316', 'Crítico': '#ef4444',
}

export function Analytics() {
  const navigate = useNavigate()
  const [tipoEntidad, setTipoEntidad] = useState<'persona' | 'institucion'>('persona')

  const { data: stats } = useQuery({
    queryKey: ['ml-stats'],
    queryFn: () => api.get('/ml/stats').then(r => r.data).catch(() => ({})),
    refetchInterval: 60_000,
  })

  const { data: distribucion = [] } = useQuery({
    queryKey: ['ml-distribucion', tipoEntidad],
    queryFn: () => api.get(`/ml/distribucion?tipo=${tipoEntidad}`).then(r => r.data).catch(() => []),
  })

  const { data: segmentos = [] } = useQuery({
    queryKey: ['ml-segmentos', tipoEntidad],
    queryFn: () => api.get(`/ml/segmentos?tipo=${tipoEntidad}`).then(r => r.data).catch(() => []),
  })

  const { data: topRiesgo = [] } = useQuery({
    queryKey: ['ml-top-riesgo'],
    queryFn: () => api.get('/ml/top-riesgo?limite=10').then(r => r.data).catch(() => []),
  })

  const { data: evolucion = [] } = useQuery({
    queryKey: ['ml-evolucion'],
    queryFn: () => api.get('/ml/evolucion-vinculos').then(r => r.data).catch(() => []),
  })

  const s = stats || {}

  return (
    <div className="space-y-8 max-w-7xl mx-auto animate-in">

      {/* FILA 1 — KPIs globales */}
      <div>
        <h1 className="text-base font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Analytics</h1>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: 'Total personas',      value: s.total_personas       ?? '—', icon: <Users size={16} />,         color: undefined },
            { label: 'Total instituciones', value: s.total_instituciones  ?? '—', icon: <Building2 size={16} />,     color: undefined },
            { label: 'Total vínculos',      value: s.total_vinculos       ?? '—', icon: <Link size={16} />,          color: undefined },
            { label: 'Alertas pendientes',  value: s.alertas_pendientes   ?? '—', icon: <AlertTriangle size={16} />, color: s.alertas_pendientes ? '#dc2626' : undefined },
            { label: 'Score medio personas',       value: s.score_medio_personas      ? `${Math.round(s.score_medio_personas * 100)}%`      : '—', icon: <Shield size={16} />, color: s.score_medio_personas      ? getRiskColor(s.score_medio_personas)      : undefined },
            { label: 'Score medio instituciones',  value: s.score_medio_instituciones ? `${Math.round(s.score_medio_instituciones * 100)}%` : '—', icon: <Shield size={16} />, color: s.score_medio_instituciones ? getRiskColor(s.score_medio_instituciones) : undefined },
            { label: 'Personas PEP',        value: s.total_pep            ?? '—', icon: <TrendingUp size={16} />,    color: s.total_pep ? '#f59e0b' : undefined },
            { label: 'En vigilancia',       value: s.en_vigilancia        ?? '—', icon: <AlertTriangle size={16} />, color: s.en_vigilancia ? '#dc2626' : undefined },
          ].map(k => (
            <div key={k.label} className="card p-4">
              <div className="flex items-start justify-between mb-2">
                <div className="text-xs" style={{ color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.07em', fontSize: '9px' }}>{k.label}</div>
                <span style={{ color: k.color || 'var(--text-tertiary)', opacity: 0.5 }}>{k.icon}</span>
              </div>
              <div className="text-xl font-semibold" style={{ color: k.color || 'var(--text-primary)' }}>{k.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* FILA 2 — Distribución riesgo + Evolución vínculos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Distribución de riesgo */}
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
              📊 Distribución de riesgo
            </span>
            <div className="flex rounded-md overflow-hidden" style={{ border: '1px solid var(--border)' }}>
              {(['persona', 'institucion'] as const).map(t => (
                <button key={t} className="px-3 py-1 text-xs capitalize transition-all"
                  style={{ background: tipoEntidad === t ? 'var(--brand)' : 'var(--bg-secondary)', color: tipoEntidad === t ? '#fff' : 'var(--text-secondary)' }}
                  onClick={() => setTipoEntidad(t)}>
                  {t === 'persona' ? 'Personas' : 'Instituciones'}
                </button>
              ))}
            </div>
          </div>
          <div className="p-4">
            {distribucion.length > 0 ? (
              <div className="flex gap-4">
                <ResponsiveContainer width="55%" height={200}>
                  <PieChart>
                    <Pie data={distribucion} dataKey="cantidad" nameKey="nivel" cx="50%" cy="50%" outerRadius={80} label={({ nivel, percent }) => `${(percent * 100).toFixed(0)}%`}>
                      {distribucion.map((entry: any) => (
                        <Cell key={entry.nivel} fill={SEV_COLORS[entry.nivel] || '#9ca3af'} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: any) => [v, 'Entidades']} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-2 pt-2">
                  {distribucion.map((d: any) => (
                    <div key={d.nivel} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: SEV_COLORS[d.nivel] || '#9ca3af' }} />
                        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{d.nivel}</span>
                      </div>
                      <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{d.cantidad}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-48 text-xs" style={{ color: 'var(--text-tertiary)' }}>Sin datos</div>
            )}
          </div>
        </div>

        {/* Evolución de vínculos */}
        <div className="card overflow-hidden">
          <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
              📈 Vínculos creados (últimos 12 meses)
            </span>
          </div>
          <div className="p-4">
            {evolucion.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={evolucion} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                  <XAxis dataKey="mes" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="total" fill="var(--brand)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-48 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                Sin vínculos en los últimos 12 meses
              </div>
            )}
          </div>
        </div>
      </div>

      {/* FILA 3 — Top riesgo + Segmentos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Top 10 por riesgo */}
        <div className="card overflow-hidden">
          <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>🔴 Top 10 entidades por riesgo</span>
          </div>
          {topRiesgo.map((e: any, i: number) => (
            <button key={e.id} className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:opacity-80"
              style={{ borderBottom: '1px solid var(--border)' }}
              onClick={() => navigate(`/${e.tipo === 'persona' ? 'personas' : 'instituciones'}/${e.id}`)}>
              <span className="text-xs font-bold w-5 text-center flex-shrink-0" style={{ color: 'var(--text-tertiary)' }}>{i + 1}</span>
              <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: e.tipo === 'persona' ? '#dbeafe' : '#fef3c7', fontSize: '10px' }}>
                {e.tipo === 'persona' ? '👤' : '🏢'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{e.nombre}</div>
                <div className="text-xs truncate" style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>
                  {[e.subtitulo, e.pais].filter(Boolean).join(' · ') || e.tipo}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <div className="w-14 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-secondary)' }}>
                  <div className="h-full rounded-full" style={{ width: `${Math.round(e.score_riesgo * 100)}%`, background: getRiskColor(e.score_riesgo) }} />
                </div>
                <span className="text-xs font-semibold" style={{ color: getRiskColor(e.score_riesgo), minWidth: '32px' }}>
                  {Math.round(e.score_riesgo * 100)}%
                </span>
              </div>
            </button>
          ))}
          {!topRiesgo.length && <div className="px-4 py-8 text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>Sin datos de riesgo</div>}
        </div>

        {/* Segmentos por sector */}
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
              🏷️ Por sector — {tipoEntidad === 'persona' ? 'Personas' : 'Instituciones'}
            </span>
          </div>
          {segmentos.length > 0 ? (
            <div className="p-4">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={segmentos} layout="vertical" margin={{ top: 0, right: 40, left: 0, bottom: 0 }}>
                  <XAxis type="number" tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="segmento" tick={{ fontSize: 9 }} width={110} />
                  <Tooltip formatter={(v: any, name: string) => [v, name === 'cantidad' ? 'Entidades' : 'Score medio']} />
                  <Bar dataKey="cantidad" fill="var(--brand)" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="px-4 py-8 text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>Sin sectores definidos</div>
          )}
        </div>
      </div>

      {/* FILA 4 — Nota sobre IA */}
      <div className="card p-5" style={{ border: '1px dashed var(--border)' }}>
        <div className="flex items-start gap-3">
          <div className="text-2xl flex-shrink-0">🤖</div>
          <div>
            <div className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
              Análisis avanzado con IA — Próximamente
            </div>
            <p className="text-xs" style={{ color: 'var(--text-secondary)', lineHeight: '1.6' }}>
              El módulo de IA incluirá: scoring automático con XGBoost, clustering de entidades, búsqueda semántica,
              detección de anomalías y generación de informes automáticos. Se conectará con el modelo local
              configurado en LM Studio (Qwen2.5 / Mistral / Gemma).
            </p>
          </div>
        </div>
      </div>

    </div>
  )
}
