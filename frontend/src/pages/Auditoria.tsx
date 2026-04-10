// src/pages/Auditoria.tsx
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, X, Download, Activity, AlertTriangle, LogIn, Edit } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { api } from '@/services/api'

const ACCION_CFG: Record<string, { bg: string; text: string; label: string }> = {
  login:      { bg: '#dcfce7', text: '#166534', label: 'Login' },
  logout:     { bg: '#f1f5f9', text: '#475569', label: 'Logout' },
  create:     { bg: '#dbeafe', text: '#1e40af', label: 'Crear' },
  update:     { bg: '#fef9c3', text: '#854d0e', label: 'Editar' },
  delete:     { bg: '#fee2e2', text: '#dc2626', label: 'Eliminar' },
  view:       { bg: '#f1f5f9', text: '#475569', label: 'Ver' },
  export:     { bg: '#f3e8ff', text: '#7c3aed', label: 'Exportar' },
  search:     { bg: '#e0f2fe', text: '#0369a1', label: 'Buscar' },
  ai_chat:    { bg: '#ecfdf5', text: '#065f46', label: 'IA Chat' },
  ai_query:   { bg: '#ecfdf5', text: '#065f46', label: 'IA Query' },
  login_fail: { bg: '#fee2e2', text: '#dc2626', label: 'Login Fallido' },
}

const PERIODO_OPTIONS = [
  { valor: '1',   label: 'Hoy' },
  { valor: '7',   label: 'Última semana' },
  { valor: '30',  label: 'Último mes' },
  { valor: '90',  label: 'Últimos 3 meses' },
]

function AccionBadge({ accion, exito }: { accion: string; exito: boolean }) {
  const cfg = !exito
    ? { bg: '#fee2e2', text: '#dc2626', label: accion }
    : (ACCION_CFG[accion] || { bg: 'var(--bg-secondary)', text: 'var(--text-secondary)', label: accion })
  return (
    <span className="text-xs px-2 py-0.5 rounded-full font-medium"
      style={{ background: cfg.bg, color: cfg.text, fontSize: '10px' }}>
      {cfg.label}
    </span>
  )
}

function exportCSV(items: any[]) {
  const headers = ['Fecha', 'Usuario', 'Acción', 'Recurso', 'IP', 'Éxito']
  const rows = items.map(i => [
    i.created_at, i.username || '—', i.accion, i.recurso_tipo || '—', i.ip_address || '—', i.exito ? 'Sí' : 'No'
  ])
  const content = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n')
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = `auditoria_${new Date().toISOString().slice(0,10)}.csv`
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function Auditoria() {
  const [buscarQ, setBuscarQ]     = useState('')
  const [filtroAccion, setFiltroAccion] = useState('')
  const [filtroUsuario, setFiltroUsuario] = useState('')
  const [filtroPeriodo, setFiltroPeriodo] = useState('7')

  const { data: kpisData } = useQuery({
    queryKey: ['auditoria-kpis'],
    queryFn: () => api.get('/auditoria/kpis').then((r: any) => r.data).catch(() => ({})),
    refetchInterval: 60_000,
  })

  const { data: logData, isLoading } = useQuery({
    queryKey: ['auditoria-log', filtroAccion, filtroUsuario, filtroPeriodo, buscarQ],
    queryFn: () => api.get('/auditoria', {
      params: {
        accion: filtroAccion || undefined,
        usuario_id: filtroUsuario || undefined,
        limite: 200,
      }
    }).then((r: any) => r.data).catch(() => ({ items: [] })),
    refetchInterval: 30_000,
  })

  const k = kpisData || {}

  // Filter items client-side for buscar and periodo
  const ahora = Date.now()
  const diasMs = parseInt(filtroPeriodo) * 86400000
  const items = (logData?.items || []).filter((i: any) => {
    const dentroFecha = !filtroPeriodo || (ahora - new Date(i.created_at).getTime()) < diasMs
    const matchQ = !buscarQ || [i.username, i.accion, i.recurso_tipo, i.recurso_desc, i.ip_address]
      .some(v => v?.toLowerCase().includes(buscarQ.toLowerCase()))
    return dentroFecha && matchQ
  })

  // Prepare chart data — fill missing hours
  const porHora = k.por_hora || []
  const chartData = porHora.map((h: any) => ({
    hora: new Date(h.hora).getHours() + 'h',
    total: h.total,
  }))

  const hasFilters = buscarQ || filtroAccion || filtroUsuario || filtroPeriodo !== '7'

  return (
    <div className="space-y-8 max-w-7xl mx-auto animate-in">

      {/* FILA 1 — KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Eventos hoy',      value: k.eventos_hoy   ?? '—', icon: <Activity size={16} />,      color: undefined },
          { label: 'Logins hoy',       value: k.logins_hoy    ?? '—', icon: <LogIn size={16} />,         color: k.logins_hoy ? '#166534' : undefined },
          { label: 'Accesos fallidos', value: k.fallos_hoy    ?? '—', icon: <AlertTriangle size={16} />, color: k.fallos_hoy ? '#dc2626' : undefined },
          { label: 'Escrituras hoy',   value: k.escrituras_hoy ?? '—', icon: <Edit size={16} />,         color: k.escrituras_hoy ? '#1e40af' : undefined },
        ].map(kk => (
          <div key={kk.label} className="card p-4">
            <div className="flex items-start justify-between mb-2">
              <div className="text-xs" style={{ color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{kk.label}</div>
              <span style={{ color: kk.color || 'var(--text-tertiary)', opacity: 0.6 }}>{kk.icon}</span>
            </div>
            <div className="text-2xl font-semibold" style={{ color: kk.color || 'var(--text-primary)' }}>{kk.value}</div>
          </div>
        ))}
      </div>

      {/* FILA 2 — Gráficos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Actividad por hora */}
        <div className="card overflow-hidden">
          <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
              📈 Actividad últimas 24h
            </span>
          </div>
          <div className="p-4">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={chartData} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                  <XAxis dataKey="hora" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="total" fill="var(--brand)" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-40 text-xs" style={{ color: 'var(--text-tertiary)' }}>Sin actividad registrada</div>
            )}
          </div>
        </div>

        {/* Top usuarios */}
        <div className="card overflow-hidden">
          <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
              👥 Usuarios más activos (7 días)
            </span>
          </div>
          <div className="px-4 py-2">
            {(k.top_usuarios || []).map((u: any, i: number) => {
              const max = k.top_usuarios?.[0]?.total || 1
              return (
                <div key={u.username} className="flex items-center gap-3 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
                  <span className="text-xs font-bold w-4 flex-shrink-0" style={{ color: 'var(--text-tertiary)' }}>{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{u.nombre_completo || u.username}</div>
                    <div className="h-1.5 rounded-full mt-1 overflow-hidden" style={{ background: 'var(--bg-tertiary)' }}>
                      <div className="h-full rounded-full" style={{ width: `${Math.round((u.total / max) * 100)}%`, background: 'var(--brand)' }} />
                    </div>
                  </div>
                  <span className="text-xs font-semibold flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>{u.total}</span>
                </div>
              )
            })}
            {!k.top_usuarios?.length && <div className="py-6 text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>Sin datos</div>}
          </div>
        </div>
      </div>

      {/* FILA 3 — Toolbar + Tabla */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-shrink-0">
            <h1 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Registro de auditoría</h1>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{items.length} eventos</p>
          </div>
          <div className="flex-1" />
          <div className="relative" style={{ width: '170px' }}>
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
            <input className="input pl-8 py-1.5 text-xs w-full" placeholder="Buscar..."
              value={buscarQ} onChange={e => setBuscarQ(e.target.value)} />
          </div>
          <select className="input text-xs py-1.5" style={{ width: '120px' }}
            value={filtroAccion} onChange={e => setFiltroAccion(e.target.value)}>
            <option value="">Acción</option>
            {Object.entries(ACCION_CFG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select className="input text-xs py-1.5" style={{ width: '130px' }}
            value={filtroPeriodo} onChange={e => setFiltroPeriodo(e.target.value)}>
            {PERIODO_OPTIONS.map(p => <option key={p.valor} value={p.valor}>{p.label}</option>)}
          </select>
          {hasFilters && (
            <button className="text-xs flex items-center gap-1" style={{ color: 'var(--text-tertiary)' }}
              onClick={() => { setBuscarQ(''); setFiltroAccion(''); setFiltroUsuario(''); setFiltroPeriodo('7') }}>
              <X size={11} /> Limpiar
            </button>
          )}
          <div className="flex-1" />
          <button className="btn text-xs py-1.5 px-3 flex items-center gap-1.5 flex-shrink-0"
            onClick={() => exportCSV(items)} disabled={!items.length}>
            <Download size={13} /> Exportar CSV
          </button>
        </div>

        <div className="card overflow-hidden">
          <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                {['Fecha y hora', 'Usuario', 'Acción', 'Recurso', 'IP', 'Duración'].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 font-medium uppercase tracking-wider"
                    style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  {Array.from({ length: 6 }).map((_, j) => (
                    <td key={j} className="px-4 py-3"><div className="skeleton h-3 rounded w-3/4" /></td>
                  ))}
                </tr>
              ))}
              {!isLoading && items.map((item: any, idx: number) => (
                <tr key={item.id || idx}
                  style={{ borderBottom: '1px solid var(--border)', background: item.exito === false ? '#fff5f5' : 'transparent' }}>
                  <td className="px-4 py-2.5" style={{ color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
                    {item.created_at ? new Date(item.created_at).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="font-medium" style={{ color: 'var(--text-primary)' }}>{item.username || '—'}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    <AccionBadge accion={item.accion} exito={item.exito !== false} />
                  </td>
                  <td className="px-4 py-2.5" style={{ color: 'var(--text-secondary)', maxWidth: '200px' }}>
                    <div className="truncate">
                      {[item.recurso_tipo, item.recurso_desc].filter(Boolean).join(' · ') || item.endpoint || '—'}
                    </div>
                  </td>
                  <td className="px-4 py-2.5" style={{ color: 'var(--text-tertiary)', fontFamily: 'monospace', fontSize: '11px' }}>
                    {item.ip_address || '—'}
                  </td>
                  <td className="px-4 py-2.5" style={{ color: 'var(--text-tertiary)' }}>
                    {item.duracion_ms ? `${item.duracion_ms}ms` : '—'}
                  </td>
                </tr>
              ))}
              {!isLoading && !items.length && (
                <tr><td colSpan={6} className="px-4 py-10 text-center" style={{ color: 'var(--text-tertiary)' }}>
                  No hay eventos de auditoría registrados
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Distribución por acción */}
      {k.por_accion?.length > 0 && (
        <div className="card p-4">
          <div className="text-xs font-semibold mb-3 uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
            📊 Distribución por tipo de acción (7 días)
          </div>
          <div className="flex flex-wrap gap-2">
            {(k.por_accion || []).map((a: any) => {
              const cfg = ACCION_CFG[a.accion] || { bg: 'var(--bg-secondary)', text: 'var(--text-secondary)', label: a.accion }
              return (
                <button key={a.accion} className="flex items-center gap-2 px-3 py-2 rounded-lg hover:opacity-80"
                  style={{ background: cfg.bg, border: `1px solid ${cfg.text}33` }}
                  onClick={() => setFiltroAccion(a.accion === filtroAccion ? '' : a.accion)}>
                  <span className="text-xs font-medium" style={{ color: cfg.text }}>{cfg.label}</span>
                  <span className="text-xs font-bold" style={{ color: cfg.text }}>{a.total}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
