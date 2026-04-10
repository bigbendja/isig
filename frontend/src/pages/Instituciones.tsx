// src/pages/Instituciones.tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { institucionesService, api } from '@/services/api'
import { getRiskColor } from '@/types'
import { Search, SlidersHorizontal, X, AlertTriangle, Link } from 'lucide-react'

export function Instituciones() {
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [vigilancia, setVigilancia] = useState<boolean | undefined>()
  const [etiquetaIds, setEtiquetaIds] = useState<number[]>([])
  const [searchQ, setSearchQ] = useState('')
  const [showEtiquetas, setShowEtiquetas] = useState(false)
  const [showAll, setShowAll] = useState(false)

  const setVigilanciaR = (v: boolean | undefined) => { setVigilancia(v); setPage(1) }
  const toggleEtiqueta = (id: number) => {
    setEtiquetaIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
    setPage(1)
  }
  const removeEtiqueta = (id: number) => { setEtiquetaIds(prev => prev.filter(x => x !== id)); setPage(1) }
  const setSearchR = (v: string) => { setSearchQ(v); setPage(1) }

  const { data: etiquetas = [] } = useQuery({
    queryKey: ['etiquetas-todas'],
    queryFn: () => api.get('/etiquetas').then(r => r.data),
  })

  const { data, isLoading } = useQuery({
    queryKey: ['instituciones', page, vigilancia, etiquetaIds, searchQ],
    queryFn: () => institucionesService.listar({
      page, page_size: showAll ? 25 : 6,
      vigilancia,
      etiqueta_ids: etiquetaIds.length ? etiquetaIds.join(',') : undefined,
      buscar: searchQ || undefined,
    }),
  })

  const { data: kpis } = useQuery({
    queryKey: ['instituciones-kpis'],
    queryFn: () => api.get('/stats/instituciones-kpis').then((r: any) => r.data).catch(() => null),
  })

  const hasFilters = vigilancia || etiquetaIds.length > 0 || searchQ

  return (
    <div className="space-y-10 max-w-7xl mx-auto animate-in">

      {/* FILA 1 — Toolbar + Tabla */}
      <div>
        <div className="flex items-center gap-3 mb-3">
          <div className="flex-shrink-0">
            <h1 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Instituciones</h1>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{data?.total?.toLocaleString() ?? '…'} registros</p>
          </div>

          <div className="flex-1 card px-3 py-2 space-y-2">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
                <input className="input pl-8 py-1.5 text-xs w-full" placeholder="Buscar por nombre, sector, país..."
                  value={searchQ} onChange={e => setSearchR(e.target.value)} />
              </div>
              <button className="text-xs px-3 py-1.5 rounded-md transition-all font-medium flex-shrink-0"
                style={{ background: vigilancia ? '#dc2626' : 'var(--bg-secondary)', color: vigilancia ? '#fff' : 'var(--text-secondary)', border: `1px solid ${vigilancia ? '#dc2626' : 'var(--border)'}` }}
                onClick={() => setVigilanciaR(vigilancia ? undefined : true)}>
                🔴 Vigilancia
              </button>
              <button className="text-xs px-3 py-1.5 rounded-md transition-all flex items-center gap-1.5 flex-shrink-0"
                style={{ background: showEtiquetas ? 'var(--brand)' : 'var(--bg-secondary)', color: showEtiquetas ? '#fff' : 'var(--text-secondary)', border: `1px solid ${showEtiquetas ? 'var(--brand)' : 'var(--border)'}` }}
                onClick={() => setShowEtiquetas(s => !s)}>
                <SlidersHorizontal size={11} />
                Etiquetas {etiquetaIds.length ? `·${etiquetaIds.length}` : ''}
              </button>
              {hasFilters && (
                <button className="text-xs px-2 py-1.5 rounded-md flex items-center gap-1 flex-shrink-0"
                  style={{ color: 'var(--text-tertiary)' }}
                  onClick={() => { setVigilanciaR(undefined); setEtiquetaIds([]); setSearchR('') }}>
                  <X size={11} /> Limpiar
                </button>
              )}
            </div>

            {showEtiquetas && (
              <div className="flex flex-wrap gap-1.5 pt-1" style={{ borderTop: '1px solid var(--border)' }}>
                <button className="text-xs px-2.5 py-1 rounded-full transition-all font-medium"
                  style={{ background: etiquetaIds.length === 0 ? 'var(--text-primary)' : 'var(--bg-tertiary)', color: etiquetaIds.length === 0 ? 'var(--bg-primary)' : 'var(--text-secondary)' }}
                  onClick={() => { setEtiquetaIds([]); setPage(1) }}>
                  Todas
                </button>
                {etiquetas.map((e: any) => (
                  <button key={e.id} className="text-xs px-2.5 py-1 rounded-full transition-all font-medium"
                    style={{ background: etiquetaIds.includes(e.id) ? e.color : `${e.color}18`, color: etiquetaIds.includes(e.id) ? '#fff' : e.color, border: `1px solid ${e.color}55` }}
                    onClick={() => toggleEtiqueta(e.id)}>
                    {e.nombre}
                  </button>
                ))}
              </div>
            )}

            {(vigilancia || etiquetaIds.length > 0) && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Activos:</span>
                {vigilancia && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1"
                    style={{ background: 'var(--brand-light)', color: 'var(--brand-dark)' }}>
                    Vigilancia <button onClick={() => setVigilanciaR(undefined)}>×</button>
                  </span>
                )}
                {etiquetaIds.map((id: number) => {
                  const etq = etiquetas.find((e: any) => e.id === id)
                  if (!etq) return null
                  return (
                    <span key={id} className="text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1"
                      style={{ background: `${etq.color}22`, color: etq.color, border: `1px solid ${etq.color}55` }}>
                      {etq.nombre} <button onClick={() => removeEtiqueta(id)}>×</button>
                    </span>
                  )
                })}
              </div>
            )}
          </div>

          <button className="btn-primary text-xs py-1.5 px-4 flex-shrink-0 self-start mt-1"
            onClick={() => navigate('/instituciones/nueva')}>
            + Nueva institución
          </button>
        </div>

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                  {['Nombre', 'Sector', 'País', 'Estado', 'Riesgo', 'Prioridad'].map(h => (
                    <th key={h} className="text-left px-4 py-2.5 font-medium uppercase tracking-wider"
                      style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading && Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <td key={j} className="px-4 py-3"><div className="skeleton h-3 rounded w-3/4" /></td>
                    ))}
                  </tr>
                ))}
                {!isLoading && data?.items?.map((inst: any) => (
                  <tr key={inst.id} className="cursor-pointer hover:opacity-80 transition-opacity"
                    style={{ borderBottom: '1px solid var(--border)' }}
                    onClick={() => navigate(`/instituciones/${inst.id}`)}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
                          style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
                          {inst.nombre.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-medium" style={{ color: 'var(--text-primary)' }}>{inst.nombre}</div>
                          {inst.en_lista_vigilancia && <span style={{ color: 'var(--accent-red)', fontSize: '10px' }}>◆ En vigilancia</span>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{inst.sector || '—'}</td>
                    <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{inst.pais_registro || '—'}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-0.5 rounded capitalize"
                        style={{ background: inst.estado_legal === 'activa' ? '#dcfce7' : '#f1f5f9', color: inst.estado_legal === 'activa' ? '#166534' : '#475569', fontSize: '10px' }}>
                        {inst.estado_legal || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-secondary)' }}>
                          <div className="h-full rounded-full" style={{ width: `${(inst.score_riesgo || 0) * 100}%`, background: getRiskColor(inst.score_riesgo || 0) }} />
                        </div>
                        <span style={{ color: 'var(--text-secondary)', minWidth: '32px' }}>{Math.round((inst.score_riesgo || 0) * 100)}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-0.5">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <div key={i} className="w-1.5 h-1.5 rounded-full"
                            style={{ background: i < (inst.nivel_prioridad || 0) ? 'var(--brand)' : 'var(--bg-tertiary)' }} />
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
                {!isLoading && (!data?.items || data.items.length === 0) && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center" style={{ color: 'var(--text-tertiary)' }}>
                    No hay instituciones que coincidan con los filtros
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          {data && data.total > 6 && (
            <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: '1px solid var(--border)' }}>
              <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                Mostrando {data.items.length} de {data.total}
              </span>
              <div className="flex gap-2">
                {!showAll && (
                  <button className="btn text-xs py-1" onClick={() => setShowAll(true)}>
                    Ver todas ({data.total})
                  </button>
                )}
                {showAll && data.pages > 1 && (
                  <>
                    <button className="btn text-xs py-1 px-2" disabled={page === 1} onClick={() => setPage(p => p - 1)}>←</button>
                    <span className="text-xs self-center" style={{ color: 'var(--text-tertiary)' }}>Pág. {page}/{data.pages}</span>
                    <button className="btn text-xs py-1 px-2" disabled={page >= data.pages} onClick={() => setPage(p => p + 1)}>→</button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>


      {/* FILA 2 — KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total instituciones', value: kpis?.kpis?.total ?? '—', icon: '🏢' },
          { label: 'En vigilancia', value: kpis?.kpis?.en_vigilancia ?? '—', icon: '🔴', color: kpis?.kpis?.en_vigilancia ? 'var(--accent-red)' : undefined },
          { label: 'Con vínculos', value: kpis?.kpis?.con_vinculos ?? '—', icon: '🔗' },
          { label: 'Score medio riesgo', value: kpis?.kpis?.score_medio ? `${Math.round(kpis.kpis.score_medio * 100)}%` : '—', icon: '📊', color: kpis?.kpis?.score_medio ? getRiskColor(kpis.kpis.score_medio) : undefined },
        ].map(k => (
          <div key={k.label} className="card p-4">
            <div className="flex items-start justify-between">
              <div className="text-xs mb-1" style={{ color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{k.label}</div>
              <span style={{ fontSize: '18px', opacity: 0.4 }}>{k.icon}</span>
            </div>
            <div className="text-2xl font-semibold" style={{ color: (k as any).color || 'var(--text-primary)' }}>{k.value}</div>
          </div>
        ))}
      </div>


      {/* FILA 3 — Rankings */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">

        {/* Mayor riesgo */}
        <div className="card overflow-hidden" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>🔴 Mayor riesgo</span>
          </div>
          {(kpis?.top_riesgo || []).map((inst: any) => (
            <button key={inst.id} className="w-full flex items-center gap-3 px-3 py-2 text-left hover:opacity-80"
              style={{ borderBottom: '1px solid var(--border)' }} onClick={() => navigate(`/instituciones/${inst.id}`)}>
              <div className="w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold flex-shrink-0"
                style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '10px' }}>
                {inst.nombre.slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{inst.nombre}</div>
                <div className="text-xs" style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>{inst.sector || inst.pais_registro || '—'}</div>
              </div>
              <span className="text-xs font-semibold flex-shrink-0" style={{ color: getRiskColor(inst.score_riesgo), fontSize: '10px' }}>
                {Math.round(inst.score_riesgo * 100)}%
              </span>
            </button>
          ))}
          {!kpis?.top_riesgo?.length && <p className="px-4 py-4 text-xs" style={{ color: 'var(--text-tertiary)' }}>Sin datos</p>}
        </div>

        {/* Más vinculadas */}
        <div className="card overflow-hidden" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>🔗 Más vinculadas</span>
          </div>
          {(kpis?.mas_vinculadas || []).map((inst: any) => (
            <button key={inst.id} className="w-full flex items-center gap-3 px-3 py-2 text-left hover:opacity-80"
              style={{ borderBottom: '1px solid var(--border)' }} onClick={() => navigate(`/instituciones/${inst.id}`)}>
              <div className="w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold flex-shrink-0"
                style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '10px' }}>
                {inst.nombre.slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{inst.nombre}</div>
                <div className="text-xs" style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>{inst.sector || '—'}</div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <Link size={10} style={{ color: 'var(--brand)' }} />
                <span className="text-xs font-semibold" style={{ color: 'var(--brand)', fontSize: '10px' }}>{inst.total_vinculos}</span>
              </div>
            </button>
          ))}
          {!kpis?.mas_vinculadas?.length && <p className="px-4 py-4 text-xs" style={{ color: 'var(--text-tertiary)' }}>Sin datos</p>}
        </div>

        {/* En el radar */}
        <div className="card overflow-hidden" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>⚠️ En el radar</span>
          </div>
          {(kpis?.en_el_radar || []).map((inst: any) => (
            <button key={inst.id} className="w-full flex items-center gap-3 px-3 py-2 text-left hover:opacity-80"
              style={{ borderBottom: '1px solid var(--border)' }} onClick={() => navigate(`/instituciones/${inst.id}`)}>
              <AlertTriangle size={14} className="flex-shrink-0" style={{ color: getRiskColor(inst.score_riesgo) }} />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{inst.nombre}</div>
                <div className="text-xs truncate" style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>{inst.razon}</div>
              </div>
              <span className="text-xs font-semibold flex-shrink-0" style={{ color: getRiskColor(inst.score_riesgo), fontSize: '10px' }}>
                {Math.round(inst.score_riesgo * 100)}%
              </span>
            </button>
          ))}
          {!kpis?.en_el_radar?.length && <p className="px-4 py-4 text-xs" style={{ color: 'var(--text-tertiary)' }}>Sin señales de alerta</p>}
        </div>

      </div>
    </div>
  )
}
