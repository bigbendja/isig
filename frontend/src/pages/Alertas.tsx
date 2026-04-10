// src/pages/Alertas.tsx — v2
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, X, Plus, Bell, CheckCircle, AlertTriangle, ShieldAlert } from 'lucide-react'
import { api } from '@/services/api'
import toast from 'react-hot-toast'

const SEV_CFG: Record<string, { bg: string; text: string; border: string; label: string }> = {
  critica:  { bg: '#fee2e2', text: '#991b1b', border: '#fca5a5', label: 'Crítica' },
  alta:     { bg: '#ffedd5', text: '#9a3412', border: '#fdba74', label: 'Alta' },
  media:    { bg: '#fef9c3', text: '#854d0e', border: '#fde047', label: 'Media' },
  baja:     { bg: '#f0fdf4', text: '#166534', border: '#86efac', label: 'Baja' },
}

const TIPOS_ALERTA = [
  'nueva_mencion', 'cambio_cargo', 'nuevo_vinculo', 'lista_sancion',
  'cambio_domicilio', 'actividad_inusual', 'dato_contradictorio', 'manual',
]

const TIPO_LABEL: Record<string, string> = {
  nueva_mencion: 'Nueva mención', cambio_cargo: 'Cambio de cargo',
  nuevo_vinculo: 'Nuevo vínculo', lista_sancion: 'Lista de sanciones',
  cambio_domicilio: 'Cambio de domicilio', actividad_inusual: 'Actividad inusual',
  dato_contradictorio: 'Dato contradictorio', manual: 'Manual',
}

function SevBadge({ sev }: { sev: string }) {
  const cfg = SEV_CFG[sev] || SEV_CFG.media
  return (
    <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
      style={{ background: cfg.bg, color: cfg.text, border: `1px solid ${cfg.border}`, fontSize: '10px' }}>
      {cfg.label}
    </span>
  )
}

function ModalCrearAlerta({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({ titulo: '', tipo_alerta: 'manual', descripcion: '', severidad: 'media' })
  const [buscarQ, setBuscarQ] = useState('')
  const [buscarResults, setBuscarResults] = useState<any[]>([])
  const [entidadSel, setEntidadSel] = useState<any>(null)

  const crearMut = useMutation({
    mutationFn: () => api.post('/alertas', {
      ...form,
      entidad_tipo: entidadSel?.tipo,
      entidad_id: entidadSel?.id,
    }).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alertas'] })
      queryClient.invalidateQueries({ queryKey: ['alertas-kpis'] })
      toast.success('Alerta creada')
      onClose()
    },
    onError: () => toast.error('Error al crear'),
  })

  const buscar = async (q: string) => {
    setBuscarQ(q)
    if (q.length < 2) { setBuscarResults([]); return }
    const r = await api.get(`/search?q=${encodeURIComponent(q)}&limite=6`).catch(() => ({ data: { resultados: [] } }))
    setBuscarResults((r.data as any).resultados || [])
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div className="w-full max-w-lg rounded-xl shadow-xl overflow-hidden" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Crear alerta manual</h2>
          <button onClick={onClose}><X size={15} style={{ color: 'var(--text-tertiary)' }} /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Título *</label>
            <input className="input text-xs" value={form.titulo} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Tipo</label>
              <select className="input text-xs" value={form.tipo_alerta} onChange={e => setForm(f => ({ ...f, tipo_alerta: e.target.value }))}>
                {TIPOS_ALERTA.map(t => <option key={t} value={t}>{TIPO_LABEL[t]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Severidad</label>
              <select className="input text-xs" value={form.severidad} onChange={e => setForm(f => ({ ...f, severidad: e.target.value }))}>
                <option value="baja">Baja</option>
                <option value="media">Media</option>
                <option value="alta">Alta</option>
                <option value="critica">Crítica</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Descripción</label>
            <textarea className="input text-xs" rows={2} value={form.descripcion}
              onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Entidad afectada (opcional)</label>
            {entidadSel ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
                <span className="text-xs font-medium flex-1" style={{ color: 'var(--text-primary)' }}>{entidadSel.nombre}</span>
                <button onClick={() => setEntidadSel(null)}><X size={11} /></button>
              </div>
            ) : (
              <div className="relative">
                <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
                <input className="input pl-8 text-xs" placeholder="Buscar persona o institución..."
                  value={buscarQ} onChange={e => buscar(e.target.value)} />
                {buscarResults.length > 0 && (
                  <div className="absolute top-full left-0 w-full mt-1 rounded-lg overflow-hidden z-10"
                    style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)' }}>
                    {buscarResults.map((e: any) => (
                      <button key={e.id} className="w-full flex items-center gap-2 px-3 py-2 hover:opacity-80"
                        style={{ borderBottom: '1px solid var(--border)' }}
                        onClick={() => { setEntidadSel(e); setBuscarQ(''); setBuscarResults([]) }}>
                        <span className="text-xs">{e.tipo === 'persona' ? '👤' : '🏢'}</span>
                        <span className="text-xs" style={{ color: 'var(--text-primary)' }}>{e.nombre}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4" style={{ borderTop: '1px solid var(--border)' }}>
          <button className="btn text-xs py-2 px-4" onClick={onClose}>Cancelar</button>
          <button className="btn-primary text-xs py-2 px-5" disabled={!form.titulo || crearMut.isPending}
            onClick={() => crearMut.mutate()}>
            {crearMut.isPending ? 'Creando...' : 'Crear alerta'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ModalDetalleAlerta({ alerta, onClose, onRevisar }: { alerta: any; onClose: () => void; onRevisar: (id: string, accion: string) => void }) {
  const navigate = useNavigate()
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div className="w-full max-w-lg rounded-xl shadow-xl overflow-hidden" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2">
            <SevBadge sev={alerta.severidad} />
            <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
              {TIPO_LABEL[alerta.tipo_alerta] || alerta.tipo_alerta}
            </span>
          </div>
          <button onClick={onClose}><X size={15} style={{ color: 'var(--text-tertiary)' }} /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <div className="text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Título</div>
            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{alerta.titulo || '—'}</div>
          </div>
          {alerta.descripcion && (
            <div>
              <div className="text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Descripción</div>
              <p className="text-xs" style={{ color: 'var(--text-primary)', lineHeight: '1.6' }}>{alerta.descripcion}</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Fecha</div>
              <div className="text-xs" style={{ color: 'var(--text-primary)' }}>
                {new Date(alerta.created_at).toLocaleString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Estado</div>
              <div className="text-xs" style={{ color: 'var(--text-primary)' }}>
                {alerta.revisada ? `✓ Revisada — ${alerta.accion_tomada || ''}` : '⏳ Pendiente'}
              </div>
            </div>
          </div>
          {alerta.entidad_id && (
            <div>
              <div className="text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Entidad afectada</div>
              <button className="text-xs hover:underline" style={{ color: 'var(--brand)' }}
                onClick={() => { navigate(`/${alerta.entidad_tipo === 'persona' ? 'personas' : 'instituciones'}/${alerta.entidad_id}`); onClose() }}>
                {alerta.entidad_tipo === 'persona' ? '👤' : '🏢'} Ver expediente completo
              </button>
            </div>
          )}
          {alerta.notas_revision && (
            <div>
              <div className="text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Notas de revisión</div>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{alerta.notas_revision}</p>
            </div>
          )}
        </div>
        {!alerta.revisada && (
          <div className="flex gap-2 px-5 py-4" style={{ borderTop: '1px solid var(--border)' }}>
            <button className="flex-1 text-xs py-2 rounded-lg font-medium hover:opacity-80"
              style={{ background: '#dcfce7', color: '#166534' }}
              onClick={() => { onRevisar(alerta.id, 'actualizado_expediente'); onClose() }}>
              ✓ Marcar revisada
            </button>
            <button className="flex-1 text-xs py-2 rounded-lg font-medium hover:opacity-80"
              style={{ background: '#f1f5f9', color: '#475569' }}
              onClick={() => { onRevisar(alerta.id, 'falso_positivo'); onClose() }}>
              Ignorar / Falso positivo
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export function Alertas() {
  const queryClient = useQueryClient()
  const [showModal, setShowModal]         = useState(false)
  const [selectedAlerta, setSelectedAlerta] = useState<any>(null)
  const [buscarQ, setBuscarQ]             = useState('')
  const [filtroSev, setFiltroSev]         = useState('')
  const [filtroTipo, setFiltroTipo]       = useState('')
  const [filtroRevisada, setFiltroRevisada] = useState('')

  const { data: kpisData } = useQuery({
    queryKey: ['alertas-kpis'],
    queryFn: () => api.get('/alertas/kpis').then((r: any) => r.data).catch(() => null),
    refetchInterval: 30_000,
  })

  const { data, isLoading } = useQuery({
    queryKey: ['alertas', filtroSev, filtroTipo, filtroRevisada, buscarQ],
    queryFn: () => api.get('/alertas', {
      params: {
        severidad: filtroSev || undefined,
        tipo_alerta: filtroTipo || undefined,
        revisada: filtroRevisada === '' ? undefined : filtroRevisada === 'true',
        buscar: buscarQ || undefined,
        page_size: 50,
      }
    }).then((r: any) => r.data).catch(() => ({ items: [], total: 0 })),
    refetchInterval: 30_000,
  })

  const revisarMut = useMutation({
    mutationFn: ({ id, accion }: { id: string; accion: string }) =>
      api.patch(`/alertas/${id}/revisar?accion=${accion}`).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alertas'] })
      queryClient.invalidateQueries({ queryKey: ['alertas-kpis'] })
      toast.success('Alerta revisada')
    },
    onError: () => toast.error('Error al revisar'),
  })

  const kpis = kpisData?.kpis
  const hasFilters = filtroSev || filtroTipo || filtroRevisada !== '' || buscarQ

  return (
    <div className="space-y-8 max-w-7xl mx-auto animate-in">
      {showModal && <ModalCrearAlerta onClose={() => setShowModal(false)} />}
      {selectedAlerta && (
        <ModalDetalleAlerta
          alerta={selectedAlerta}
          onClose={() => setSelectedAlerta(null)}
          onRevisar={(id, accion) => revisarMut.mutate({ id, accion })}
        />
      )}

      {/* FILA 1 — KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Pendientes',    value: kpis?.pendientes    ?? '—', icon: <Bell size={16} />,        color: kpis?.pendientes    ? '#f59e0b' : undefined },
          { label: 'Críticas',      value: kpis?.criticas      ?? '—', icon: <ShieldAlert size={16} />, color: kpis?.criticas      ? '#dc2626' : undefined },
          { label: 'Altas',         value: kpis?.altas         ?? '—', icon: <AlertTriangle size={16} />, color: kpis?.altas        ? '#ea580c' : undefined },
          { label: 'Revisadas hoy', value: kpis?.revisadas_hoy ?? '—', icon: <CheckCircle size={16} />, color: '#166534' },
        ].map(k => (
          <div key={k.label} className="card p-4">
            <div className="flex items-start justify-between mb-2">
              <div className="text-xs" style={{ color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{k.label}</div>
              <span style={{ color: k.color || 'var(--text-tertiary)', opacity: 0.6 }}>{k.icon}</span>
            </div>
            <div className="text-2xl font-semibold" style={{ color: k.color || 'var(--text-primary)' }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* FILA 2+3 — Toolbar + Tabla */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-shrink-0">
            <h1 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Alertas</h1>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{data?.total ?? '…'} registros</p>
          </div>
          <div className="flex-1" />
          <div className="relative" style={{ width: '170px' }}>
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
            <input className="input pl-8 py-1.5 text-xs w-full" placeholder="Buscar..."
              value={buscarQ} onChange={e => setBuscarQ(e.target.value)} />
          </div>
          <select className="input text-xs py-1.5" style={{ width: '120px' }} value={filtroSev} onChange={e => setFiltroSev(e.target.value)}>
            <option value="">Severidad</option>
            <option value="critica">Crítica</option>
            <option value="alta">Alta</option>
            <option value="media">Media</option>
            <option value="baja">Baja</option>
          </select>
          <select className="input text-xs py-1.5" style={{ width: '150px' }} value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}>
            <option value="">Tipo</option>
            {TIPOS_ALERTA.map(t => <option key={t} value={t}>{TIPO_LABEL[t]}</option>)}
          </select>
          <select className="input text-xs py-1.5" style={{ width: '115px' }} value={filtroRevisada} onChange={e => setFiltroRevisada(e.target.value)}>
            <option value="">Estado</option>
            <option value="false">Pendiente</option>
            <option value="true">Revisada</option>
          </select>
          {hasFilters && (
            <button className="text-xs flex items-center gap-1 flex-shrink-0" style={{ color: 'var(--text-tertiary)' }}
              onClick={() => { setFiltroSev(''); setFiltroTipo(''); setFiltroRevisada(''); setBuscarQ('') }}>
              <X size={11} /> Limpiar
            </button>
          )}
          <div className="flex-1" />
          <button className="btn-primary text-xs py-1.5 px-4 flex items-center gap-1.5 flex-shrink-0" onClick={() => setShowModal(true)}>
            <Plus size={13} /> Nueva alerta
          </button>
        </div>

        <div className="card overflow-hidden">
          <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                {['Severidad', 'Tipo', 'Título', 'Entidad', 'Fecha', 'Estado', 'Acción'].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 font-medium uppercase tracking-wider"
                    style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} className="px-4 py-3"><div className="skeleton h-3 rounded w-3/4" /></td>
                  ))}
                </tr>
              ))}
              {!isLoading && data?.items?.map((a: any) => (
                <tr key={a.id} className="cursor-pointer hover:opacity-80"
                  style={{ borderBottom: '1px solid var(--border)', opacity: a.revisada ? 0.6 : 1 }}
                  onClick={() => setSelectedAlerta(a)}>
                  <td className="px-4 py-3"><SevBadge sev={a.severidad} /></td>
                  <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{TIPO_LABEL[a.tipo_alerta] || a.tipo_alerta}</td>
                  <td className="px-4 py-3" style={{ maxWidth: '220px' }}>
                    <div className="truncate font-medium" style={{ color: 'var(--text-primary)' }}>{a.titulo || a.tipo_alerta}</div>
                    {a.descripcion && <div className="truncate" style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>{a.descripcion}</div>}
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--text-tertiary)' }}>
                    {a.entidad_id ? (a.entidad_tipo === 'persona' ? '👤' : '🏢') : '—'}
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
                    {new Date(a.created_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                  </td>
                  <td className="px-4 py-3">
                    {a.revisada
                      ? <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: '#f0fdf4', color: '#166534', fontSize: '10px' }}>✓ Revisada</span>
                      : <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: '#fef9c3', color: '#854d0e', fontSize: '10px' }}>Pendiente</span>}
                  </td>
                  <td className="px-4 py-3">
                    {!a.revisada && (
                      <div className="flex gap-1">
                        <button className="text-xs px-2 py-1 rounded hover:opacity-80"
                          style={{ background: '#dcfce7', color: '#166534', fontSize: '10px' }}
                          onClick={e => { e.stopPropagation(); revisarMut.mutate({ id: a.id, accion: 'actualizado_expediente' }) }}>
                          ✓
                        </button>
                        <button className="text-xs px-2 py-1 rounded hover:opacity-80"
                          style={{ background: '#f1f5f9', color: '#475569', fontSize: '10px' }}
                          onClick={e => { e.stopPropagation(); revisarMut.mutate({ id: a.id, accion: 'falso_positivo' }) }}>
                          ✗
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {!isLoading && !data?.items?.length && (
                <tr><td colSpan={7} className="px-4 py-10 text-center" style={{ color: 'var(--text-tertiary)' }}>
                  {hasFilters ? 'No hay alertas que coincidan' : 'Sin alertas pendientes 🎉'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* FILA 4 — Rankings */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card overflow-hidden">
          <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>📊 Pendientes por severidad</span>
          </div>
          <div className="p-4 space-y-3">
            {['critica', 'alta', 'media', 'baja'].map(sev => {
              const cfg = SEV_CFG[sev]
              const count = kpisData?.por_severidad?.find((s: any) => s.severidad === sev)?.total || 0
              const total = Math.max(kpis?.pendientes || 1, 1)
              return (
                <div key={sev}>
                  <div className="flex items-center justify-between mb-1">
                    <SevBadge sev={sev} />
                    <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>{count}</span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-tertiary)' }}>
                    <div className="h-full rounded-full" style={{ width: `${Math.round((count / total) * 100)}%`, background: cfg.text }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>🔥 Más urgentes sin revisar</span>
          </div>
          {(kpisData?.recientes || []).map((a: any) => (
            <button key={a.id} className="w-full flex items-start gap-3 px-4 py-3 text-left hover:opacity-80"
              style={{ borderBottom: '1px solid var(--border)' }}
              onClick={() => setSelectedAlerta(a)}>
              <SevBadge sev={a.severidad} />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                  {a.titulo || TIPO_LABEL[a.tipo_alerta]}
                </div>
                <div className="text-xs" style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>
                  {new Date(a.created_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                </div>
              </div>
              <button className="text-xs px-2 py-1 rounded flex-shrink-0 hover:opacity-80"
                style={{ background: '#dcfce7', color: '#166534', fontSize: '10px' }}
                onClick={e => { e.stopPropagation(); revisarMut.mutate({ id: a.id, accion: 'actualizado_expediente' }) }}>
                ✓
              </button>
            </button>
          ))}
          {!kpisData?.recientes?.length && <p className="px-4 py-4 text-xs" style={{ color: 'var(--text-tertiary)' }}>Sin alertas pendientes</p>}
        </div>
      </div>
    </div>
  )
}
