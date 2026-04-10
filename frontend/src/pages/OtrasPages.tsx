// src/pages/OtrasPages.tsx
import { useState, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, institucionesService, investigacionesService, iaService } from '@/services/api'
import { getRiskColor } from '@/types'
import { useAuthStore } from '@/stores'
import { ArrowLeft, Send, Bot , Pencil, Trash2 } from 'lucide-react'
import { VinculoForm } from '@/components/VinculoForm'
import { VinculosGrafo } from '@/components/VinculosGrafo'
import { EtiquetasPanel } from '@/components/EtiquetasPanel'

// ── INSTITUCIONES (lista) ─────────────────────────────────────

export function Instituciones() {
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const { data, isLoading } = useQuery({
    queryKey: ['instituciones', page],
    queryFn: () => institucionesService.listar({ page, page_size: 25 }),
  })
  return (
    <div className="space-y-4 max-w-7xl mx-auto animate-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Instituciones</h1>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{data?.total ?? '\u2026'} registros</p>
        </div>
        <button className="btn-primary text-xs py-1" onClick={() => navigate('/instituciones/nueva')}>+ Nueva institución</button>
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
              {['Nombre', 'Tipo', 'Sector', 'País', 'Estado', 'Riesgo'].map(h => (
                <th key={h} className="text-left px-4 py-2 font-medium" style={{ color: 'var(--text-secondary)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && Array.from({ length: 8 }).map((_, i) => (
              <tr key={i}><td colSpan={6} className="px-4 py-3"><div className="skeleton h-4 rounded w-full" /></td></tr>
            ))}
            {!isLoading && data?.items?.map((inst: any) => (
              <tr key={inst.id} className="cursor-pointer hover:opacity-80" style={{ borderBottom: '1px solid var(--border)' }}
                onClick={() => navigate(`/instituciones/${inst.id}`)}>
                <td className="px-4 py-3 font-medium" style={{ color: 'var(--text-primary)' }}>{inst.nombre}</td>
                <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{inst.tipo_entidad || '—'}</td>
                <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{inst.sector || '—'}</td>
                <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{inst.pais_registro || '—'}</td>
                <td className="px-4 py-3">
                  <span className="badge capitalize" style={{ background: inst.estado_legal === 'activa' ? '#dcfce7' : '#f1f5f9', color: inst.estado_legal === 'activa' ? '#166534' : '#475569' }}>
                    {inst.estado_legal}
                  </span>
                </td>
                <td className="px-4 py-3 font-semibold" style={{ color: getRiskColor(inst.score_riesgo) }}>
                  {Math.round((inst.score_riesgo || 0) * 100)}%
                </td>
              </tr>
            ))}
            {!isLoading && (!data?.items || data.items.length === 0) && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>No hay instituciones registradas</td></tr>
            )}
          </tbody>
        </table>
        {data && data.pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: '1px solid var(--border)' }}>
            <button className="btn text-xs py-1" disabled={page === 1} onClick={() => setPage(p => p - 1)}>\u2190 Anterior</button>
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Página {page} de {data.pages}</span>
            <button className="btn text-xs py-1" disabled={page === data.pages} onClick={() => setPage(p => p + 1)}>Siguiente \u2192</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── INSTITUCIÓN DETALLE ────────────────────────────────────────

export function InstitucionDetalle() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { usuario } = useAuthStore()
  const nivel = usuario?.nivel_acceso ?? 1
  const [activeTab, setActiveTab] = useState<'general' | 'contacto' | 'financiero' | 'vinculos'>('general')
  const [showVinculoForm, setShowVinculoForm] = useState(false)
  const [editVinculo, setEditVinculo] = useState<any>(null)

  const { data: inst, isLoading } = useQuery({
    queryKey: ['institucion', id],
    queryFn: () => institucionesService.obtener(id!),
    enabled: !!id,
  })
  const { data: vinculos } = useQuery({
    queryKey: ['inst-vinculos', id],
    queryFn: () => api.get(`/vinculos/entidad/institucion/${id}`).then(r => r.data).catch(() => ({ items: [] })),
    enabled: !!id && activeTab === 'vinculos',
  })

  const eliminarVinculoMut = useMutation({
    mutationFn: (vid: string) => api.delete(`/vinculos/${vid}`).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inst-vinculos', id] })
      queryClient.refetchQueries({ queryKey: ['inst-vinculos', id] })
      queryClient.invalidateQueries({ queryKey: ['grafo'] })
      toast.success('Vínculo eliminado')
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail || 'Error al eliminar'),
  })
  const recalcularMut = useMutation({
    mutationFn: () => api.post(`/instituciones/${id}/recalcular-score`).then(r => r.data).catch(() => ({})),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['institucion', id] }); toast.success('Score recalculado') },
  })

  if (isLoading) return <div className="space-y-4 max-w-5xl mx-auto animate-in"><div className="skeleton h-40 rounded-xl" /></div>
  if (!inst) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <p style={{ color: 'var(--text-secondary)' }}>Institución no encontrada</p>
      <button className="btn" onClick={() => navigate('/instituciones')}>\u2190 Volver</button>
    </div>
  )

  const riskPct = Math.round((inst.score_riesgo || 0) * 100)

  return (
    <div className="space-y-4 max-w-5xl mx-auto animate-in">
      {showVinculoForm && (
        <VinculoForm origenTipo="institucion" origenId={inst.id} origenNombre={inst.nombre} onClose={() => setShowVinculoForm(false)} />
      )}
      {editVinculo && (
        <VinculoForm origenTipo="institucion" origenId={inst.id} origenNombre={inst.nombre}
          onClose={() => setEditVinculo(null)} vinculoExistente={editVinculo} />
      )}

      <div className="flex items-center justify-between">
        <button className="btn-ghost text-xs flex items-center gap-1.5" onClick={() => navigate('/instituciones')}>
          <ArrowLeft size={13} /> Instituciones
        </button>
        <div className="flex items-center gap-2">
          <button className="btn text-xs py-1" onClick={() => recalcularMut.mutate()} disabled={recalcularMut.isPending}>Score</button>
          {nivel >= 2 && <button className="btn-primary text-xs py-1" onClick={() => navigate(`/instituciones/${id}/editar`)}>Editar</button>}
        </div>
      </div>

      <div className="card p-5">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-xl flex items-center justify-center text-lg font-bold flex-shrink-0"
            style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
            {inst.nombre.slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{inst.nombre}</h1>
              {inst.nombre_corto && <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>{inst.nombre_corto}</span>}
            </div>
            <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>{[inst.tipo_entidad, inst.sector].filter(Boolean).join(' · ')}</p>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs font-mono px-2 py-0.5 rounded select-all" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-tertiary)', fontSize: '10px' }}>
                ID: {inst.id}
              </span>
              <button className="text-xs px-2 py-0.5 rounded hover:opacity-70" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-tertiary)', fontSize: '10px' }}
                onClick={() => { navigator.clipboard.writeText(inst.id); toast.success('ID copiado') }}>
                Copiar ID
              </button>
            </div>
          </div>
          <div className="flex-shrink-0 text-right">
            <div className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Riesgo</div>
            <div className="text-2xl font-semibold" style={{ color: getRiskColor(inst.score_riesgo || 0) }}>{riskPct}%</div>
          </div>
        </div>
      </div>

      <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'var(--bg-secondary)', width: 'fit-content' }}>
        {(['general', 'contacto', 'financiero', 'vinculos'] as const).map(t => (
          <button key={t} className="text-xs px-4 py-1.5 rounded-md capitalize transition-all"
            style={{ background: activeTab === t ? 'var(--bg-primary)' : 'transparent', color: activeTab === t ? 'var(--text-primary)' : 'var(--text-tertiary)', boxShadow: activeTab === t ? 'var(--shadow-sm)' : 'none' }}
            onClick={() => setActiveTab(t)}>
            {t === 'vinculos' ? 'Vínculos' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {activeTab === 'general' && (
        <>
        <div className="card p-4">
          <EtiquetasPanel entidadTipo="institucion" entidadId={inst.id} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="card p-4">
            <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>Datos legales</div>
            {[['País registro', inst.pais_registro], ['N.º registro', inst.numero_registro], ['Estado legal', inst.estado_legal], ['Tipo propiedad', inst.tipo_propiedad]].filter(([, v]) => v).map(([l, v]) => (
              <div key={l as string} className="flex justify-between py-1.5 text-xs" style={{ borderBottom: '1px solid var(--border)' }}>
                <span style={{ color: 'var(--text-secondary)' }}>{l}</span>
                <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{v as string}</span>
              </div>
            ))}
          </div>
          <div className="card p-4">
            <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>Datos comerciales</div>
            {[['Sector', inst.sector], ['Empleados', inst.numero_empleados?.toLocaleString()], ['Países operación', inst.paises_operacion?.join(', ')]].filter(([, v]) => v).map(([l, v]) => (
              <div key={l as string} className="flex justify-between py-1.5 text-xs" style={{ borderBottom: '1px solid var(--border)' }}>
                <span style={{ color: 'var(--text-secondary)' }}>{l}</span>
                <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{v as string}</span>
              </div>
            ))}
          </div>
          {inst.actividad_desc && (
            <div className="card p-4 col-span-2">
              <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>Actividad</div>
              <p className="text-xs" style={{ color: 'var(--text-primary)', lineHeight: 1.6 }}>{inst.actividad_desc}</p>
            </div>
          )}
        </div>
        </>
      )}

      {activeTab === 'contacto' && (
        <div className="card p-4">
          {[['Web', inst.web_principal], ['Email', inst.email_contacto], ['Teléfono', inst.telefono_central], ['Sede ciudad', inst.sede_ciudad], ['Dirección', inst.sede_direccion]].filter(([, v]) => v).map(([l, v]) => (
            <div key={l as string} className="flex justify-between py-1.5 text-xs" style={{ borderBottom: '1px solid var(--border)' }}>
              <span style={{ color: 'var(--text-secondary)' }}>{l}</span>
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{v as string}</span>
            </div>
          ))}
          {!inst.web_principal && !inst.email_contacto && !inst.telefono_central && (
            <p className="text-xs py-4 text-center" style={{ color: 'var(--text-tertiary)' }}>Sin datos de contacto</p>
          )}
        </div>
      )}

      {activeTab === 'financiero' && (
        <div className="card p-4">
          {nivel >= 3 ? (
            [['Capital social', inst.capital_social?.toLocaleString()], ['Patrimonio neto', inst.patrimonio_neto?.toLocaleString()], ['Facturación anual', inst.facturacion_anual?.toLocaleString()], ['Rating crédito', inst.rating_credito]].filter(([, v]) => v).map(([l, v]) => (
              <div key={l as string} className="flex justify-between py-1.5 text-xs" style={{ borderBottom: '1px solid var(--border)' }}>
                <span style={{ color: 'var(--text-secondary)' }}>{l}</span>
                <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{v as string}</span>
              </div>
            ))
          ) : (
            <p className="text-xs py-4 text-center" style={{ color: 'var(--text-tertiary)' }}>Requiere nivel 3+</p>
          )}
        </div>
      )}

      {activeTab === 'vinculos' && (
        <div className="space-y-4">
          {inst && (
            <VinculosGrafo
              entidadId={inst.id}
              entidadTipo="institucion"
              entidadNombre={inst.nombre}
              nivel={nivel}
            />
          )}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
            <div className="flex justify-end">
            {nivel >= 2 && <button className="btn-primary text-xs py-1" onClick={() => setShowVinculoForm(true)}>+ Añadir vínculo</button>}
          </div>
          <div className="card overflow-hidden">
            {!vinculos?.items?.length ? (
              <div className="p-8 text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>Sin vínculos registrados</div>
            ) : (
              <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                    {['Entidad', 'Tipo vínculo', 'Intensidad', 'Confianza'].map(h => (
                      <th key={h} className="text-left px-4 py-2 font-medium" style={{ color: 'var(--text-secondary)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {vinculos.items.map((v: any) => {
                    const otro = v.origen_id === id ? { nombre: v.destino_nombre, tipo: v.destino_tipo, eid: v.destino_id } : { nombre: v.origen_nombre, tipo: v.origen_tipo, eid: v.origen_id }
                    return (
                      <tr key={v.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td className="px-4 py-3">
                          <button className="hover:underline text-left font-medium" style={{ color: 'var(--brand)' }} onClick={() => navigate(`/${otro.tipo}s/${otro.eid}`)}>
                            {otro.nombre || otro.eid?.slice(0, 8)}
                          </button>
                        </td>
                        <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{v.tipo_vinculo_nombre || '—'}</td>
                        <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{Math.round((v.intensidad || 0) * 100)}%</td>
                        <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{v.confianza}/5</td>
                        {nivel >= 2 && (
                          <td className="px-4 py-3">
                            <div className="flex gap-1">
                              <button className="flex items-center text-xs px-2 py-1 rounded hover:opacity-70"
                                style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
                                onClick={() => setEditVinculo({
                                  id: v.id,
                                  tipo_vinculo_id: v.tipo_vinculo_id,
                                  intensidad: v.intensidad,
                                  confianza: v.confianza,
                                  descripcion: v.descripcion,
                                  bidireccional: v.bidireccional,
                                  destino_id: v.origen_id === id ? v.destino_id : v.origen_id,
                                  destino_tipo: v.origen_id === id ? v.destino_tipo : v.origen_tipo,
                                  destino_nombre: v.origen_id === id ? v.destino_nombre : v.origen_nombre,
                                })}><Pencil size={11} /></button>
                              <button className="flex items-center text-xs px-2 py-1 rounded hover:opacity-70"
                                style={{ background: '#fee2e2', color: '#dc2626', border: '1px solid #fecaca' }}
                                onClick={() => { if (confirm('¿Eliminar este vínculo?')) eliminarVinculoMut.mutate(v.id) }}><Trash2 size={11} /></button>
                            </div>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── INVESTIGACIONES ───────────────────────────────────────────

export function Investigaciones() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [newInv, setNewInv] = useState({ titulo: '', descripcion: '', prioridad: 3, clasificacion: 2 })

  const { data, isLoading } = useQuery({
    queryKey: ['investigaciones'],
    queryFn: () => investigacionesService.listar(),
  })

  const crearMut = useMutation({
    mutationFn: () => investigacionesService.crear(newInv),
    onSuccess: (inv: any) => {
      queryClient.invalidateQueries({ queryKey: ['investigaciones'] })
      toast.success('Investigación creada')
      setShowModal(false)
      setNewInv({ titulo: '', descripcion: '', prioridad: 3, clasificacion: 2 })
      navigate(`/investigaciones/${inv.id}`)
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || 'Error al crear'),
  })

  const estados: Record<string, { bg: string; text: string }> = {
    abierta: { bg: '#dbeafe', text: '#1e40af' }, en_curso: { bg: '#d1fae5', text: '#065f46' },
    pausada: { bg: '#fef3c7', text: '#92400e' }, cerrada: { bg: '#f1f5f9', text: '#475569' },
    archivada: { bg: '#f3f4f6', text: '#6b7280' },
  }

  return (
    <div className="space-y-4 max-w-5xl mx-auto animate-in">
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="card p-6 w-full max-w-md space-y-4" style={{ background: 'var(--bg-primary)' }}>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Nueva investigación</h2>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Título *</label>
              <input className="input" value={newInv.titulo} onChange={e => setNewInv(f => ({ ...f, titulo: e.target.value }))} placeholder="Título de la investigación" />
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Descripción</label>
              <textarea className="input" rows={3} value={newInv.descripcion} onChange={e => setNewInv(f => ({ ...f, descripcion: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Prioridad</label>
                <select className="input" value={newInv.prioridad} onChange={e => setNewInv(f => ({ ...f, prioridad: Number(e.target.value) }))}>
                  {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Clasificación</label>
                <select className="input" value={newInv.clasificacion} onChange={e => setNewInv(f => ({ ...f, clasificacion: Number(e.target.value) }))}>
                  {[1,2,3,4,5].map(n => <option key={n} value={n}>N{n}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button className="btn text-xs py-1.5 px-4" onClick={() => setShowModal(false)}>Cancelar</button>
              <button className="btn-primary text-xs py-1.5 px-4" onClick={() => crearMut.mutate()} disabled={!newInv.titulo.trim() || crearMut.isPending}>
                {crearMut.isPending ? 'Creando...' : 'Crear'}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between">
        <h1 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Investigaciones</h1>
        <button className="btn-primary text-xs py-1" onClick={() => setShowModal(true)}>+ Nueva investigación</button>
      </div>
      <div className="space-y-2">
        {isLoading && Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-20 rounded-xl" />)}
        {!isLoading && data?.items?.map((inv: any) => (
          <div key={inv.id} className="card p-4 cursor-pointer hover:opacity-90 transition-opacity" onClick={() => navigate(`/investigaciones/${inv.id}`)}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>{inv.codigo}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{ ...(estados[inv.estado] || estados.abierta), fontSize: '10px' }}>{inv.estado}</span>
                  <div className="flex gap-0.5">
                    {Array.from({ length: 5 }).map((_, i) => <div key={i} className="w-1.5 h-1.5 rounded-full" style={{ background: i < inv.prioridad ? 'var(--brand)' : 'var(--bg-tertiary)' }} />)}
                  </div>
                </div>
                <div className="text-sm font-medium mt-1" style={{ color: 'var(--text-primary)' }}>{inv.titulo}</div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                  Abierta {new Date(inv.fecha_apertura).toLocaleDateString('es-ES')}
                </div>
              </div>
              <span className="text-xs" style={{ color: 'var(--text-secondary)', fontSize: '10px' }}>N{inv.clasificacion}</span>
            </div>
          </div>
        ))}
        {!isLoading && (!data?.items || data.items.length === 0) && (
          <div className="card p-12 text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>No hay investigaciones activas</div>
        )}
      </div>
    </div>
  )
}

// ── ASISTENTE IA ──────────────────────────────────────────────

export function AsistenteIA() {
  const [messages, setMessages] = useState<{ role: 'user' | 'ai'; content: string }[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  const send = async () => {
    if (!input.trim() || isLoading) return
    const msg = input.trim()
    setInput('')
    setMessages(m => [...m, { role: 'user', content: msg }])
    setIsLoading(true)
    try {
      const res = await iaService.chat(msg)
      setMessages(m => [...m, { role: 'ai', content: (res as any).respuesta || (res as any).content || 'Sin respuesta' }])
    } catch {
      setMessages(m => [...m, { role: 'ai', content: 'Error al contactar con el modelo.' }])
    } finally {
      setIsLoading(false)
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
    }
  }

  return (
    <div className="flex flex-col max-w-3xl mx-auto animate-in" style={{ height: 'calc(100vh - 120px)' }}>
      <div className="flex items-center gap-2 mb-4">
        <Bot size={18} style={{ color: 'var(--brand)' }} />
        <h1 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Asistente IA</h1>
        <span className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--brand-light)', color: 'var(--brand-dark)' }}>Local</span>
      </div>
      <div className="flex-1 overflow-y-auto space-y-4 pb-4">
        {messages.length === 0 && (
          <div className="card p-8 text-center space-y-2">
            <Bot size={32} className="mx-auto" style={{ color: 'var(--text-tertiary)' }} />
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Asistente de inteligencia</p>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Puedes preguntarme sobre entidades, análisis de riesgo, o pedirme que analice expedientes.</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={"flex gap-3 " + (m.role === 'user' ? 'flex-row-reverse' : '')}>
            <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold"
              style={{ background: m.role === 'user' ? 'var(--brand)' : 'var(--bg-secondary)', color: m.role === 'user' ? '#fff' : 'var(--text-primary)' }}>
              {m.role === 'user' ? 'U' : 'IA'}
            </div>
            <div className="max-w-lg px-4 py-2.5 rounded-xl text-xs"
              style={{ background: m.role === 'user' ? 'var(--brand)' : 'var(--bg-secondary)', color: m.role === 'user' ? '#fff' : 'var(--text-primary)', lineHeight: 1.6 }}>
              {m.content}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: 'var(--bg-secondary)' }}>IA</div>
            <div className="px-4 py-2.5 rounded-xl" style={{ background: 'var(--bg-secondary)' }}>
              <div className="flex gap-1">{[0,1,2].map(i => <div key={i} className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: 'var(--text-tertiary)', animationDelay: `${i*0.15}s` }} />)}</div>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div className="flex items-center gap-2 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
        <input className="input flex-1" value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
          placeholder="Escribe tu consulta..." disabled={isLoading} />
        <button className="btn-primary p-2.5" onClick={send} disabled={!input.trim() || isLoading}><Send size={14} /></button>
      </div>
    </div>
  )
}

// ── AUDITORÍA ─────────────────────────────────────────────────

export function Auditoria() {
  const { data, isLoading } = useQuery({
    queryKey: ['auditoria'],
    queryFn: () => api.get('/auditoria').then(r => r.data).catch(() => []),
  })
  const logs = Array.isArray(data) ? data : (data?.items ?? [])
  return (
    <div className="space-y-4 max-w-5xl mx-auto animate-in">
      <h1 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Auditoría</h1>
      <div className="card overflow-hidden">
        <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
              {['Fecha', 'Usuario', 'Acción', 'Recurso', 'IP'].map(h => (
                <th key={h} className="text-left px-4 py-2 font-medium" style={{ color: 'var(--text-secondary)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && Array.from({ length: 10 }).map((_, i) => <tr key={i}><td colSpan={5} className="px-4 py-3"><div className="skeleton h-3 rounded w-full" /></td></tr>)}
            {!isLoading && logs.map((l: any, i: number) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                <td className="px-4 py-2.5" style={{ color: 'var(--text-tertiary)' }}>{l.created_at ? new Date(l.created_at).toLocaleString('es-ES') : '—'}</td>
                <td className="px-4 py-2.5 font-medium" style={{ color: 'var(--text-primary)' }}>{l.username || l.usuario_id?.slice(0, 8) || '—'}</td>
                <td className="px-4 py-2.5"><span className="badge capitalize" style={{ background: 'var(--bg-secondary)' }}>{l.accion}</span></td>
                <td className="px-4 py-2.5" style={{ color: 'var(--text-secondary)' }}>{[l.recurso_tipo, l.recurso_id?.slice(0, 8)].filter(Boolean).join(' · ') || '—'}</td>
                <td className="px-4 py-2.5" style={{ color: 'var(--text-tertiary)' }}>{l.ip_address || '—'}</td>
              </tr>
            ))}
            {!isLoading && logs.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center" style={{ color: 'var(--text-tertiary)' }}>Sin registros</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
