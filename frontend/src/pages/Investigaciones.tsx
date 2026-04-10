// src/pages/Investigaciones.tsx — v2 completo
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, X, Plus, FileSearch, Clock, CheckCircle, Archive, AlertCircle } from 'lucide-react'
import { api } from '@/services/api'
import { getRiskColor } from '@/types'
import toast from 'react-hot-toast'

const TIPOS_INVESTIGACION = [
  // Seguros / Corporativo
  { valor: 'due_diligence',       label: 'Due Diligence',              grupo: 'Corporativo' },
  { valor: 'kyc_kyb',             label: 'KYC / KYB',                  grupo: 'Corporativo' },
  { valor: 'fraude_siniestros',   label: 'Fraude en Siniestros',       grupo: 'Corporativo' },
  { valor: 'riesgo_contraparte',  label: 'Riesgo de Contraparte',      grupo: 'Corporativo' },
  // Financiero / Regulatorio
  { valor: 'blanqueo_capitales',  label: 'Blanqueo de Capitales',      grupo: 'Financiero' },
  { valor: 'financ_terrorismo',   label: 'Financiación del Terrorismo',grupo: 'Financiero' },
  { valor: 'evasion_fiscal',      label: 'Evasión Fiscal',             grupo: 'Financiero' },
  { valor: 'corrupcion_soborno',  label: 'Corrupción y Soborno',       grupo: 'Financiero' },
  // Inteligencia
  { valor: 'analisis_red',        label: 'Análisis de Red de Influencia', grupo: 'Inteligencia' },
  { valor: 'perfilado_pep',       label: 'Perfilado de PEP',           grupo: 'Inteligencia' },
  { valor: 'vigilancia_persona',  label: 'Vigilancia de Persona',      grupo: 'Inteligencia' },
  { valor: 'analisis_competitivo',label: 'Análisis Competitivo',       grupo: 'Inteligencia' },
  // Operacional
  { valor: 'investigacion_interna',label: 'Investigación Interna',     grupo: 'Operacional' },
  { valor: 'fuga_informacion',    label: 'Fuga de Información',        grupo: 'Operacional' },
  { valor: 'conflicto_interes',   label: 'Conflicto de Interés',       grupo: 'Operacional' },
]

const ROLES_ENTIDAD = [
  'Sujeto principal', 'Persona de interés', 'Testigo', 'Cómplice',
  'Empresa vinculada', 'Beneficiario', 'Víctima', 'Informante',
]

const ESTADO_COLORS: Record<string, { bg: string; text: string; icon: any }> = {
  abierta:    { bg: '#dcfce7', text: '#166534', icon: FileSearch },
  en_curso:   { bg: '#dbeafe', text: '#1e40af', icon: Clock },
  cerrada:    { bg: '#f1f5f9', text: '#475569', icon: CheckCircle },
  archivada:  { bg: '#fef3c7', text: '#92400e', icon: Archive },
  suspendida: { bg: '#fee2e2', text: '#dc2626', icon: AlertCircle },
}

function EstadoBadge({ estado }: { estado: string }) {
  const cfg = ESTADO_COLORS[estado] || ESTADO_COLORS.abierta
  return (
    <span className="text-xs px-2 py-0.5 rounded-full capitalize font-medium"
      style={{ background: cfg.bg, color: cfg.text, fontSize: '10px' }}>
      {estado.replace('_', ' ')}
    </span>
  )
}

function PrioridadDots({ nivel }: { nivel: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="w-1.5 h-1.5 rounded-full"
          style={{ background: i < nivel ? (nivel >= 4 ? '#dc2626' : nivel >= 3 ? '#f59e0b' : 'var(--brand)') : 'var(--bg-tertiary)' }} />
      ))}
    </div>
  )
}

// ── MODAL CREAR INVESTIGACIÓN ──────────────────────────────────
function ModalNuevaInvestigacion({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const navigate    = useNavigate()
  const [step, setStep] = useState(1)
  const [form, setForm] = useState({
    titulo: '', tipo_investigacion: '', descripcion: '', objetivo: '',
    prioridad: 3, clasificacion: 2, fecha_objetivo: '',
  })
  const [sujetos, setSujetos] = useState<Array<{ id: string; nombre: string; tipo: string; rol: string }>>([])
  const [buscarQ, setBuscarQ] = useState('')
  const [buscarResults, setBuscarResults] = useState<any[]>([])

  const crearMut = useMutation({
    mutationFn: async () => {
      const inv = await api.post('/investigaciones', {
        ...form,
        fecha_objetivo: form.fecha_objetivo || undefined,
      }).then(r => r.data)
      // Add sujetos
      for (const s of sujetos) {
        await api.post(`/investigaciones/${inv.id}/entidades`, {
          entidad_tipo: s.tipo, entidad_id: s.id, rol_en_caso: s.rol,
        }).catch(() => {})
      }
      return inv
    },
    onSuccess: (inv) => {
      queryClient.invalidateQueries({ queryKey: ['investigaciones'] })
      queryClient.invalidateQueries({ queryKey: ['investigaciones-kpis'] })
      toast.success('Investigación creada')
      onClose()
      navigate(`/investigaciones/${inv.id}`)
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail || 'Error al crear'),
  })

  const buscar = async (q: string) => {
    setBuscarQ(q)
    if (q.length < 2) { setBuscarResults([]); return }
    const r = await api.get(`/search?q=${encodeURIComponent(q)}&limite=6`).catch(() => ({ data: { resultados: [] } }))
    setBuscarResults((r.data as any).resultados || [])
  }

  const addSujeto = (e: any) => {
    if (!sujetos.find(s => s.id === e.id)) {
      setSujetos(prev => [...prev, { id: e.id, nombre: e.nombre, tipo: e.tipo, rol: 'Sujeto principal' }])
    }
    setBuscarQ(''); setBuscarResults([])
  }

  const tipoLabel = TIPOS_INVESTIGACION.find(t => t.valor === form.tipo_investigacion)?.label

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="w-full max-w-2xl rounded-xl shadow-2xl overflow-hidden" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Nueva investigación</h2>
            <div className="flex items-center gap-2 mt-1">
              {[1, 2, 3].map(s => (
                <div key={s} className="flex items-center gap-1">
                  <div className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold"
                    style={{ background: step >= s ? 'var(--brand)' : 'var(--bg-tertiary)', color: step >= s ? '#fff' : 'var(--text-tertiary)' }}>
                    {s}
                  </div>
                  {s < 3 && <div className="w-8 h-0.5" style={{ background: step > s ? 'var(--brand)' : 'var(--bg-tertiary)' }} />}
                </div>
              ))}
              <span className="text-xs ml-2" style={{ color: 'var(--text-tertiary)' }}>
                {step === 1 ? 'Tipo y título' : step === 2 ? 'Detalles' : 'Sujetos'}
              </span>
            </div>
          </div>
          <button onClick={onClose}><X size={16} style={{ color: 'var(--text-tertiary)' }} /></button>
        </div>

        <div className="px-6 py-5 space-y-4" style={{ maxHeight: '60vh', overflowY: 'auto' }}>

          {/* Step 1 */}
          {step === 1 && (
            <>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                  Tipo de investigación *
                </label>
                <select className="input text-xs" value={form.tipo_investigacion}
                  onChange={e => setForm(f => ({ ...f, tipo_investigacion: e.target.value }))}>
                  <option value="">— Seleccionar tipo —</option>
                  {['Corporativo', 'Financiero', 'Inteligencia', 'Operacional'].map(grupo => (
                    <optgroup key={grupo} label={grupo}>
                      {TIPOS_INVESTIGACION.filter(t => t.grupo === grupo).map(t => (
                        <option key={t.valor} value={t.valor}>{t.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                  Título de la investigación *
                </label>
                <input className="input text-xs" placeholder="Ej: Due diligence — Empresa X para contrato Y"
                  value={form.titulo} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>Objetivo</label>
                <textarea className="input text-xs" rows={2} placeholder="¿Qué queremos determinar con esta investigación?"
                  value={form.objetivo} onChange={e => setForm(f => ({ ...f, objetivo: e.target.value }))} />
              </div>
            </>
          )}

          {/* Step 2 */}
          {step === 2 && (
            <>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>Descripción</label>
                <textarea className="input text-xs" rows={3}
                  value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                    Prioridad — {form.prioridad}/5
                  </label>
                  <div className="flex gap-1">
                    {[1,2,3,4,5].map(n => (
                      <button key={n} className="flex-1 py-1.5 text-xs rounded transition-all"
                        style={{ background: n <= form.prioridad ? (n >= 4 ? '#dc2626' : n >= 3 ? '#f59e0b' : 'var(--brand)') : 'var(--bg-secondary)', color: n <= form.prioridad ? '#fff' : 'var(--text-tertiary)' }}
                        onClick={() => setForm(f => ({ ...f, prioridad: n }))}>{n}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>Clasificación</label>
                  <select className="input text-xs" value={form.clasificacion}
                    onChange={e => setForm(f => ({ ...f, clasificacion: Number(e.target.value) }))}>
                    {[1,2,3,4,5].map(n => <option key={n} value={n}>Nivel {n}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>Fecha objetivo</label>
                <input type="date" className="input text-xs" value={form.fecha_objetivo}
                  onChange={e => setForm(f => ({ ...f, fecha_objetivo: e.target.value }))} />
              </div>
            </>
          )}

          {/* Step 3 */}
          {step === 3 && (
            <>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                  Buscar y añadir sujetos
                </label>
                <div className="relative">
                  <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
                  <input className="input pl-8 text-xs" placeholder="Buscar persona o institución..."
                    value={buscarQ} onChange={e => buscar(e.target.value)} />
                </div>
                {buscarResults.length > 0 && (
                  <div className="mt-1 rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                    {buscarResults.map((e: any) => (
                      <button key={e.id} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:opacity-80"
                        style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-primary)' }}
                        onClick={() => addSujeto(e)}>
                        <span className="text-xs" style={{ color: e.tipo === 'persona' ? '#3b82f6' : '#f59e0b' }}>
                          {e.tipo === 'persona' ? '👤' : '🏢'}
                        </span>
                        <div>
                          <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{e.nombre}</div>
                          <div className="text-xs capitalize" style={{ color: 'var(--text-tertiary)' }}>{e.tipo}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {sujetos.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                    Sujetos añadidos ({sujetos.length})
                  </div>
                  {sujetos.map((s, i) => (
                    <div key={s.id} className="flex items-center gap-2 p-2 rounded-lg"
                      style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
                      <span className="text-xs">{s.tipo === 'persona' ? '👤' : '🏢'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{s.nombre}</div>
                      </div>
                      <select className="input text-xs py-0.5 px-2 w-40"
                        value={s.rol} onChange={e => setSujetos(prev => prev.map((x, j) => j === i ? { ...x, rol: e.target.value } : x))}>
                        {ROLES_ENTIDAD.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                      <button onClick={() => setSujetos(prev => prev.filter((_, j) => j !== i))}>
                        <X size={12} style={{ color: 'var(--text-tertiary)' }} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4" style={{ borderTop: '1px solid var(--border)' }}>
          <button className="btn text-xs py-2 px-4" onClick={step === 1 ? onClose : () => setStep(s => s - 1)}>
            {step === 1 ? 'Cancelar' : '← Anterior'}
          </button>
          <div className="flex gap-2">
            {step < 3 ? (
              <button className="btn-primary text-xs py-2 px-5"
                disabled={step === 1 && (!form.tipo_investigacion || !form.titulo)}
                onClick={() => setStep(s => s + 1)}>
                Siguiente →
              </button>
            ) : (
              <button className="btn-primary text-xs py-2 px-5"
                disabled={crearMut.isPending}
                onClick={() => crearMut.mutate()}>
                {crearMut.isPending ? 'Creando...' : '✓ Crear investigación'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── PÁGINA PRINCIPAL ───────────────────────────────────────────
export function Investigaciones() {
  const navigate    = useNavigate()
  const [showModal, setShowModal] = useState(false)
  const [searchQ, setSearchQ]     = useState('')
  const [filtroEstado, setFiltroEstado] = useState('')
  const [filtroTipo, setFiltroTipo]     = useState('')

  const { data: kpisData } = useQuery({
    queryKey: ['investigaciones-kpis'],
    queryFn: () => api.get('/investigaciones/kpis').then((r: any) => r.data).catch(() => null),
  })

  const { data, isLoading } = useQuery({
    queryKey: ['investigaciones', filtroEstado, filtroTipo, searchQ],
    queryFn: () => api.get('/investigaciones', {
      params: {
        estado: filtroEstado || undefined,
        tipo: filtroTipo || undefined,
        buscar: searchQ || undefined,
        page_size: 50,
      }
    }).then((r: any) => r.data).catch(() => ({ items: [], total: 0 })),
  })

  const kpis = kpisData?.kpis

  return (
    <div className="space-y-8 max-w-7xl mx-auto animate-in">
      {showModal && <ModalNuevaInvestigacion onClose={() => setShowModal(false)} />}

      {/* FILA 1 — KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total investigaciones', value: kpis?.total ?? '—', icon: '🔍', color: undefined },
          { label: 'Abiertas', value: kpis?.abiertas ?? '—', icon: '📂', color: kpis?.abiertas ? '#166534' : undefined },
          { label: 'En curso', value: kpis?.en_curso ?? '—', icon: '⚡', color: kpis?.en_curso ? '#1e40af' : undefined },
          { label: 'Cerradas', value: kpis?.cerradas ?? '—', icon: '✅', color: undefined },
        ].map(k => (
          <div key={k.label} className="card p-4">
            <div className="flex items-start justify-between">
              <div className="text-xs mb-1" style={{ color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{k.label}</div>
              <span style={{ fontSize: '18px', opacity: 0.4 }}>{k.icon}</span>
            </div>
            <div className="text-2xl font-semibold" style={{ color: k.color || 'var(--text-primary)' }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* FILA 2 — Toolbar + Tabla */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-shrink-0">
            <h1 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Investigaciones</h1>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{data?.total ?? '…'} registros</p>
          </div>
          <div className="flex-1" />
          <div className="relative" style={{ width: '180px', flexShrink: 0 }}>
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
            <input className="input pl-8 py-1.5 text-xs w-full" placeholder="Buscar..."
              value={searchQ} onChange={e => setSearchQ(e.target.value)} />
          </div>
          <select className="input text-xs py-1.5" style={{ width: '130px', flexShrink: 0 }} value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}>
            <option value="">Estado</option>
            <option value="abierta">Abierta</option>
            <option value="en_curso">En curso</option>
            <option value="cerrada">Cerrada</option>
            <option value="archivada">Archivada</option>
          </select>
          <select className="input text-xs py-1.5" style={{ width: '150px', flexShrink: 0 }} value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}>
            <option value="">Tipo</option>
            {TIPOS_INVESTIGACION.map(t => <option key={t.valor} value={t.valor}>{t.label}</option>)}
          </select>
          {(filtroEstado || filtroTipo || searchQ) && (
            <button className="text-xs flex items-center gap-1 flex-shrink-0" style={{ color: 'var(--text-tertiary)' }}
              onClick={() => { setFiltroEstado(''); setFiltroTipo(''); setSearchQ('') }}>
              <X size={11} /> Limpiar
            </button>
          )}
          <button className="btn-primary text-xs py-1.5 px-4 flex items-center gap-1.5 flex-shrink-0"
            onClick={() => setShowModal(true)}>
            <Plus size={13} /> Nueva investigación
          </button>
        </div>

        <div className="card overflow-hidden">
          <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                {['Código', 'Título', 'Tipo', 'Estado', 'Prioridad', 'Fecha apertura'].map(h => (
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
              {!isLoading && data?.items?.map((inv: any) => (
                <tr key={inv.id} className="cursor-pointer hover:opacity-80"
                  style={{ borderBottom: '1px solid var(--border)' }}
                  onClick={() => navigate(`/investigaciones/${inv.id}`)}>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs font-semibold" style={{ color: 'var(--brand)' }}>{inv.codigo}</span>
                  </td>
                  <td className="px-4 py-3 font-medium" style={{ color: 'var(--text-primary)', maxWidth: '280px' }}>
                    <div className="truncate">{inv.titulo}</div>
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>
                    {TIPOS_INVESTIGACION.find(t => t.valor === inv.tipo_investigacion)?.label || inv.tipo_investigacion || '—'}
                  </td>
                  <td className="px-4 py-3"><EstadoBadge estado={inv.estado} /></td>
                  <td className="px-4 py-3"><PrioridadDots nivel={inv.prioridad} /></td>
                  <td className="px-4 py-3" style={{ color: 'var(--text-tertiary)' }}>
                    {inv.fecha_apertura ? new Date(inv.fecha_apertura).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                  </td>
                </tr>
              ))}
              {!isLoading && !data?.items?.length && (
                <tr><td colSpan={6} className="px-4 py-10 text-center" style={{ color: 'var(--text-tertiary)' }}>
                  No hay investigaciones que coincidan
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* FILA 3 — Rankings */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Recientes */}
        <div className="card overflow-hidden" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>🕐 Más recientes</span>
          </div>
          {(kpisData?.recientes || []).map((inv: any) => (
            <button key={inv.id} className="w-full flex items-center gap-3 px-3 py-2 text-left hover:opacity-80"
              style={{ borderBottom: '1px solid var(--border)' }} onClick={() => navigate(`/investigaciones/${inv.id}`)}>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{inv.titulo}</div>
                <div className="text-xs" style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>
                  {inv.codigo} · {new Date(inv.fecha_apertura).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                </div>
              </div>
              <EstadoBadge estado={inv.estado} />
            </button>
          ))}
          {!kpisData?.recientes?.length && <p className="px-4 py-4 text-xs" style={{ color: 'var(--text-tertiary)' }}>Sin datos</p>}
        </div>

        {/* Por tipo */}
        <div className="card overflow-hidden" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>📊 Por tipo</span>
          </div>
          {(kpisData?.por_tipo || []).map((t: any) => {
            const tipo = TIPOS_INVESTIGACION.find(x => x.valor === t.tipo_investigacion)
            const pct = Math.round((t.total / (kpis?.total || 1)) * 100)
            return (
              <div key={t.tipo_investigacion} className="px-4 py-2.5" style={{ borderBottom: '1px solid var(--border)' }}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs truncate" style={{ color: 'var(--text-primary)' }}>{tipo?.label || t.tipo_investigacion}</span>
                  <span className="text-xs font-semibold ml-2 flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>{t.total}</span>
                </div>
                <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--bg-tertiary)' }}>
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--brand)' }} />
                </div>
              </div>
            )
          })}
          {!kpisData?.por_tipo?.length && <p className="px-4 py-4 text-xs" style={{ color: 'var(--text-tertiary)' }}>Sin datos</p>}
        </div>

        {/* Por prioridad */}
        <div className="card overflow-hidden" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>🔥 Alta prioridad</span>
          </div>
          {(data?.items || []).filter((inv: any) => inv.prioridad >= 4).slice(0, 5).map((inv: any) => (
            <button key={inv.id} className="w-full flex items-center gap-3 px-3 py-2 text-left hover:opacity-80"
              style={{ borderBottom: '1px solid var(--border)' }} onClick={() => navigate(`/investigaciones/${inv.id}`)}>
              <div className="flex-shrink-0">
                <PrioridadDots nivel={inv.prioridad} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{inv.titulo}</div>
                <div className="text-xs" style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>{inv.codigo}</div>
              </div>
            </button>
          ))}
          {!(data?.items || []).filter((inv: any) => inv.prioridad >= 4).length && (
            <p className="px-4 py-4 text-xs" style={{ color: 'var(--text-tertiary)' }}>Sin investigaciones de alta prioridad</p>
          )}
        </div>

      </div>
    </div>
  )
}
