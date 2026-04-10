// src/pages/InvestigacionDetalle.tsx — v2 enriquecido
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Edit2, User, Building2, Plus, X, Search, AlertTriangle, Clock, Users, Link, Activity } from 'lucide-react'
import { api } from '@/services/api'
import { getRiskColor } from '@/types'
import { VinculosGrafo } from '@/components/VinculosGrafo'
import toast from 'react-hot-toast'

const TIPOS_INVESTIGACION: Record<string, string> = {
  due_diligence: 'Due Diligence', kyc_kyb: 'KYC / KYB',
  fraude_siniestros: 'Fraude en Siniestros', riesgo_contraparte: 'Riesgo de Contraparte',
  blanqueo_capitales: 'Blanqueo de Capitales', financ_terrorismo: 'Financiación del Terrorismo',
  evasion_fiscal: 'Evasión Fiscal', corrupcion_soborno: 'Corrupción y Soborno',
  analisis_red: 'Análisis de Red', perfilado_pep: 'Perfilado de PEP',
  vigilancia_persona: 'Vigilancia de Persona', analisis_competitivo: 'Análisis Competitivo',
  investigacion_interna: 'Investigación Interna', fuga_informacion: 'Fuga de Información',
  conflicto_interes: 'Conflicto de Interés',
}

const ROLES_ENTIDAD = [
  'Sujeto principal', 'Persona de interés', 'Testigo', 'Cómplice',
  'Empresa vinculada', 'Beneficiario', 'Víctima', 'Informante',
]

const ESTADO_COLORS: Record<string, { bg: string; text: string }> = {
  abierta:    { bg: '#dcfce7', text: '#166534' },
  en_curso:   { bg: '#dbeafe', text: '#1e40af' },
  cerrada:    { bg: '#f1f5f9', text: '#475569' },
  archivada:  { bg: '#fef3c7', text: '#92400e' },
  suspendida: { bg: '#fee2e2', text: '#dc2626' },
}

const ROL_COLORS: Record<string, string> = {
  'Sujeto principal': '#dc2626', 'Persona de interés': '#f59e0b',
  'Testigo': '#3b82f6', 'Cómplice': '#8b5cf6',
  'Empresa vinculada': '#0ea5e9', 'Beneficiario': '#10b981',
  'Víctima': '#6b7280', 'Informante': '#ec4899',
}

type Tab = 'resumen' | 'sujetos' | 'vinculos' | 'osint' | 'actividad'

export function InvestigacionDetalle() {
  const { id } = useParams<{ id: string }>()
  const navigate  = useNavigate()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<Tab>('resumen')
  const [editando, setEditando] = useState(false)
  const [buscarQ, setBuscarQ]   = useState('')
  const [buscarResults, setBuscarResults] = useState<any[]>([])
  const [pendiente, setPendiente] = useState<any>(null) // entidad pendiente de asignar rol
  const [rolPendiente, setRolPendiente] = useState('Sujeto principal')
  const [editEstado, setEditEstado] = useState('')
  const [osintTerminos, setOsintTerminos] = useState('')
  const [osintFuentes, setOsintFuentes] = useState<number[]>([])
  const [osintResultados, setOsintResultados] = useState<any[]>([])
  const [osintLoading, setOsintLoading] = useState(false)

  const { data: inv, isLoading } = useQuery({
    queryKey: ['investigacion', id],
    queryFn: () => api.get(`/investigaciones/${id}`).then((r: any) => r.data),
    enabled: !!id,
  })

  // Load entity details for sujetos
  const entidades: any[] = inv?.entidades || []

  const { data: sujetos } = useQuery({
    queryKey: ['inv-sujetos', id, entidades.length],
    queryFn: async () => {
      const details = await Promise.all(
        entidades.map(async (e: any) => {
          try {
            const path = e.entidad_tipo === 'persona' ? `/personas/${e.entidad_id}` : `/instituciones/${e.entidad_id}`
            const d = await api.get(path).then((r: any) => r.data)
            return { ...e, nombre: e.entidad_tipo === 'persona' ? d.nombre_completo : d.nombre, score_riesgo: d.score_riesgo, es_pep: d.es_pep }
          } catch { return { ...e, nombre: e.entidad_id?.slice(0, 8), score_riesgo: 0 } }
        })
      )
      return details
    },
    enabled: !!id && entidades.length > 0,
  })

  const actualizarMut = useMutation({
    mutationFn: (datos: any) => api.patch(`/investigaciones/${id}`, datos).then(r => r.data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['investigacion', id] }); toast.success('Actualizado'); setEditando(false) },
    onError: () => toast.error('Error al actualizar'),
  })

  const añadirSujetoMut = useMutation({
    mutationFn: (body: any) => api.post(`/investigaciones/${id}/entidades`, body).then(r => r.data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['investigacion', id] }); toast.success('Sujeto añadido') },
    onError: () => toast.error('Error al añadir'),
  })

  const eliminarSujetoMut = useMutation({
    mutationFn: (eid: string) => api.delete(`/investigaciones/${id}/entidades/${eid}`).then(r => r.data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['investigacion', id] }); toast.success('Sujeto eliminado') },
    onError: () => toast.error('Error al eliminar'),
  })

  const buscar = async (q: string) => {
    setBuscarQ(q)
    if (q.length < 2) { setBuscarResults([]); return }
    const r = await api.get(`/search?q=${encodeURIComponent(q)}&limite=6`).catch(() => ({ data: { resultados: [] } }))
    setBuscarResults((r.data as any).resultados || [])
  }

  if (isLoading) return <div className="flex items-center justify-center py-20 text-xs" style={{ color: 'var(--text-tertiary)' }}>Cargando...</div>
  if (!inv) return <div className="text-center py-20 text-xs" style={{ color: 'var(--text-tertiary)' }}>Investigación no encontrada</div>

  const diasActiva = Math.floor((Date.now() - new Date(inv.fecha_apertura).getTime()) / 86400000)
  const estadoCfg  = ESTADO_COLORS[inv.estado] || ESTADO_COLORS.abierta

  return (
    <div className="space-y-6 max-w-6xl mx-auto animate-in">

      {/* Header */}
      <div>
        <button className="btn-ghost text-xs flex items-center gap-1.5 mb-3" onClick={() => navigate('/investigaciones')}>
          <ArrowLeft size={13} /> Investigaciones
        </button>

        <div className="card p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="font-mono text-sm font-bold" style={{ color: 'var(--brand)' }}>{inv.codigo}</span>
                <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                  style={{ background: estadoCfg.bg, color: estadoCfg.text, fontSize: '10px' }}>
                  {inv.estado?.replace('_', ' ')}
                </span>
                {inv.tipo_investigacion && (
                  <span className="text-xs px-2 py-0.5 rounded-full"
                    style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border)', fontSize: '10px' }}>
                    {TIPOS_INVESTIGACION[inv.tipo_investigacion] || inv.tipo_investigacion}
                  </span>
                )}
              </div>
              <h1 className="text-lg font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>{inv.titulo}</h1>
              {inv.objetivo && <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{inv.objetivo}</p>}
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              {/* Estado selector */}
              <select className="input text-xs py-1" value={editEstado || inv.estado}
                onChange={e => { setEditEstado(e.target.value); actualizarMut.mutate({ estado: e.target.value }) }}>
                <option value="abierta">Abierta</option>
                <option value="en_curso">En curso</option>
                <option value="cerrada">Cerrada</option>
                <option value="archivada">Archivada</option>
                <option value="suspendida">Suspendida</option>
              </select>
            </div>
          </div>

          {/* Meta row */}
          <div className="flex items-center gap-6 mt-4 pt-4 flex-wrap" style={{ borderTop: '1px solid var(--border)' }}>
            <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              📅 Abierta: <span style={{ color: 'var(--text-secondary)' }}>{new Date(inv.fecha_apertura).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
            </div>
            {inv.fecha_objetivo && (
              <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                🎯 Objetivo: <span style={{ color: 'var(--text-secondary)' }}>{new Date(inv.fecha_objetivo).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
              </div>
            )}
            <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              🔒 Clasificación: <span style={{ color: 'var(--text-secondary)' }}>Nivel {inv.clasificacion}</span>
            </div>
            {inv.prioridad >= 4 && (
              <div className="flex items-center gap-1 text-xs" style={{ color: '#dc2626' }}>
                <AlertTriangle size={11} /> Prioridad alta
              </div>
            )}
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Sujetos', value: entidades.length, icon: <Users size={16} />, color: 'var(--brand)' },
          { label: 'Vínculos', value: (sujetos || []).length, icon: <Link size={16} />, color: '#0ea5e9' },
          { label: 'Días activa', value: diasActiva, icon: <Clock size={16} />, color: diasActiva > 30 ? '#dc2626' : 'var(--text-primary)' },
          { label: 'Score medio', value: sujetos?.length ? `${Math.round((sujetos.reduce((a: number, s: any) => a + (s.score_riesgo || 0), 0) / sujetos.length) * 100)}%` : '—', icon: <Activity size={16} />, color: undefined },
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

      {/* Tabs */}
      <div>
        <div className="flex gap-1 mb-4" style={{ borderBottom: '1px solid var(--border)' }}>
          {(['resumen', 'sujetos', 'vinculos', 'osint', 'actividad'] as Tab[]).map(t => (
            <button key={t} className="px-4 py-2 text-xs font-medium capitalize transition-all"
              style={{
                borderBottom: activeTab === t ? '2px solid var(--brand)' : '2px solid transparent',
                color: activeTab === t ? 'var(--brand)' : 'var(--text-secondary)',
                marginBottom: '-1px',
              }}
              onClick={() => setActiveTab(t)}>
              {t === 'vinculos' ? 'Vínculos' : t === 'osint' ? 'OSINT' : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {/* RESUMEN */}
        {activeTab === 'resumen' && (
          <div className="space-y-4">
            {inv.descripcion && (
              <div className="card p-4">
                <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>Descripción</div>
                <p className="text-xs" style={{ color: 'var(--text-primary)', lineHeight: '1.6' }}>{inv.descripcion}</p>
              </div>
            )}
            {/* Sujetos preview */}
            {(sujetos || []).length > 0 && (
              <div className="card overflow-hidden">
                <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Sujetos de la investigación</span>
                  <button className="text-xs hover:underline" style={{ color: 'var(--brand)' }} onClick={() => setActiveTab('sujetos')}>Ver todos</button>
                </div>
                {(sujetos || []).slice(0, 4).map((s: any) => (
                  <button key={s.entidad_id} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:opacity-80"
                    style={{ borderBottom: '1px solid var(--border)' }}
                    onClick={() => navigate(`/${s.entidad_tipo === 'persona' ? 'personas' : 'instituciones'}/${s.entidad_id}`)}>
                    <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{ background: s.entidad_tipo === 'persona' ? '#dbeafe' : '#fef3c7', color: s.entidad_tipo === 'persona' ? '#1e40af' : '#92400e' }}>
                      {s.entidad_tipo === 'persona' ? <User size={14} /> : <Building2 size={14} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{s.nombre}</div>
                      <div className="text-xs" style={{ color: ROL_COLORS[s.rol_en_caso] || 'var(--text-tertiary)', fontSize: '10px' }}>{s.rol_en_caso}</div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="w-12 h-1 rounded-full overflow-hidden" style={{ background: 'var(--bg-secondary)' }}>
                        <div className="h-full rounded-full" style={{ width: `${(s.score_riesgo || 0) * 100}%`, background: getRiskColor(s.score_riesgo || 0) }} />
                      </div>
                      <span className="text-xs" style={{ color: getRiskColor(s.score_riesgo || 0), fontSize: '10px' }}>
                        {Math.round((s.score_riesgo || 0) * 100)}%
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* SUJETOS */}
        {activeTab === 'sujetos' && (
          <div className="space-y-4">
            {/* Add sujeto */}
            <div className="card p-4">
              <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>Añadir sujeto</div>
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
                      onClick={() => { setPendiente(e); setRolPendiente('Sujeto principal'); setBuscarQ(''); setBuscarResults([]) }}>
                      {e.tipo === 'persona' ? <User size={13} style={{ color: '#3b82f6' }} /> : <Building2 size={13} style={{ color: '#f59e0b' }} />}
                      <div>
                        <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{e.nombre}</div>
                        <div className="text-xs capitalize" style={{ color: 'var(--text-tertiary)' }}>{e.tipo}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {pendiente && (
                <div className="mt-2 p-3 rounded-lg flex items-center gap-3"
                  style={{ background: 'var(--bg-secondary)', border: '1px solid var(--brand)' }}>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium mb-1.5" style={{ color: 'var(--text-primary)' }}>
                      {pendiente.nombre} — ¿En calidad de?
                    </div>
                    <select className="input text-xs py-1" value={rolPendiente}
                      onChange={e => setRolPendiente(e.target.value)}>
                      {['Sujeto principal','Persona de interés','Testigo','Cómplice','Empresa vinculada','Beneficiario','Víctima','Informante'].map(r => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button className="btn-primary text-xs py-1.5 px-3"
                      onClick={() => { añadirSujetoMut.mutate({ entidad_tipo: pendiente.tipo, entidad_id: pendiente.id, rol_en_caso: rolPendiente }); setPendiente(null) }}>
                      Añadir
                    </button>
                    <button className="btn text-xs py-1.5 px-2" onClick={() => setPendiente(null)}>
                      <X size={12} />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* List */}
            <div className="space-y-2">
              {(sujetos || []).map((s: any) => (
                <div key={s.entidad_id} className="card p-4 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: s.entidad_tipo === 'persona' ? '#dbeafe' : '#fef3c7', color: s.entidad_tipo === 'persona' ? '#1e40af' : '#92400e' }}>
                    {s.entidad_tipo === 'persona' ? <User size={18} /> : <Building2 size={18} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <button className="text-xs font-semibold hover:underline text-left"
                      style={{ color: 'var(--brand)' }}
                      onClick={() => navigate(`/${s.entidad_tipo === 'persona' ? 'personas' : 'instituciones'}/${s.entidad_id}`)}>
                      {s.nombre}
                    </button>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs px-2 py-0.5 rounded-full"
                        style={{ background: `${ROL_COLORS[s.rol_en_caso] || '#6b7280'}22`, color: ROL_COLORS[s.rol_en_caso] || '#6b7280', fontSize: '10px' }}>
                        {s.rol_en_caso}
                      </span>
                      <span className="text-xs capitalize" style={{ color: 'var(--text-tertiary)' }}>{s.entidad_tipo}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div>
                      <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-secondary)' }}>
                        <div className="h-full rounded-full" style={{ width: `${(s.score_riesgo || 0) * 100}%`, background: getRiskColor(s.score_riesgo || 0) }} />
                      </div>
                      <div className="text-xs mt-0.5 text-center" style={{ color: getRiskColor(s.score_riesgo || 0), fontSize: '10px' }}>
                        {Math.round((s.score_riesgo || 0) * 100)}%
                      </div>
                    </div>
                    {s.es_pep && <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: '#fef3c7', color: '#92400e', fontSize: '10px' }}>PEP</span>}
                    <button className="text-xs px-2 py-1 rounded hover:opacity-70"
                      style={{ background: '#fee2e2', color: '#dc2626' }}
                      onClick={() => { if (confirm('¿Eliminar este sujeto?')) eliminarSujetoMut.mutate(s.entidad_id) }}>
                      <X size={11} />
                    </button>
                  </div>
                </div>
              ))}
              {!sujetos?.length && (
                <div className="text-center py-10 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  No hay sujetos en esta investigación. Usa el buscador para añadir.
                </div>
              )}
            </div>
          </div>
        )}

        {/* VÍNCULOS */}
        {activeTab === 'vinculos' && (
          <div className="space-y-4">
            {(sujetos || []).length === 0 ? (
              <div className="text-center py-10 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                Añade sujetos a la investigación para ver sus vínculos
              </div>
            ) : (
              <div className="space-y-6">
                {(sujetos || []).map((s: any) => (
                  <div key={s.entidad_id}>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center"
                        style={{ background: s.entidad_tipo === 'persona' ? '#dbeafe' : '#fef3c7', color: s.entidad_tipo === 'persona' ? '#1e40af' : '#92400e' }}>
                        {s.entidad_tipo === 'persona' ? <User size={12} /> : <Building2 size={12} />}
                      </div>
                      <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{s.nombre}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded-full"
                        style={{ background: `${ROL_COLORS[s.rol_en_caso] || '#6b7280'}22`, color: ROL_COLORS[s.rol_en_caso] || '#6b7280', fontSize: '10px' }}>
                        {s.rol_en_caso}
                      </span>
                    </div>
                    <VinculosGrafo
                      entidadId={s.entidad_id}
                      entidadTipo={s.entidad_tipo}
                      entidadNombre={s.nombre}
                      nivel={3}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* OSINT */}
        {activeTab === 'osint' && (
          <div className="space-y-4">
            <div className="card p-4">
              <div className="text-xs font-semibold mb-3" style={{ color: 'var(--text-secondary)' }}>
                🔍 Buscar en fuentes OSINT
              </div>
              <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)', lineHeight: '1.6' }}>
                Busca información sobre los sujetos de esta investigación en las fuentes OSINT configuradas.
                Los resultados relevantes se guardarán vinculados a esta investigación.
              </p>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                    Términos de búsqueda (nombres, términos clave)
                  </label>
                  <textarea className="input text-xs" rows={3}
                    placeholder={`Ej: ${(sujetos || []).slice(0,2).map((s:any) => s.nombre).join(', ') || 'nombre del sujeto, empresa...'}`}
                    value={osintTerminos}
                    onChange={e => setOsintTerminos(e.target.value)} />
                  {(sujetos || []).length > 0 && (
                    <button className="text-xs mt-1 hover:underline" style={{ color: 'var(--brand)' }}
                      onClick={() => setOsintTerminos((sujetos || []).map((s:any) => s.nombre).join('\n'))}>
                      ↑ Usar nombres de los sujetos
                    </button>
                  )}
                </div>
                <button className="btn-primary text-xs py-2 px-5 flex items-center gap-2"
                  disabled={!osintTerminos.trim() || osintLoading}
                  onClick={async () => {
                    const terminos = osintTerminos.split(/[\n,]/).map(t => t.trim()).filter(Boolean)
                    if (!terminos.length) return
                    setOsintLoading(true)
                    setOsintResultados([])
                    try {
                      const r = await api.post('/osint/crawler/buscar', {
                        terminos,
                        fuente_ids: osintFuentes,
                        max_por_fuente: 8,
                        investigacion_id: id,
                      })
                      setOsintResultados((r.data as any).resultados || [])
                      if (!(r.data as any).resultados?.length) toast.error('Sin resultados para esos términos')
                    } catch (e: any) {
                      toast.error(e?.response?.data?.detail || 'Error al buscar')
                    } finally {
                      setOsintLoading(false)
                    }
                  }}>
                  {osintLoading ? '⏳ Buscando...' : '🔍 Buscar en fuentes OSINT'}
                </button>
              </div>
            </div>

            {osintResultados.length > 0 && (
              <div className="card overflow-hidden">
                <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
                  <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                    {osintResultados.length} resultados encontrados
                  </span>
                  <button className="text-xs" style={{ color: 'var(--text-tertiary)' }}
                    onClick={() => setOsintResultados([])}>Limpiar</button>
                </div>
                {osintResultados.map((r: any, i: number) => (
                  <div key={i} className="px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <a href={r.url} target="_blank" rel="noopener noreferrer"
                          className="text-xs font-semibold hover:underline"
                          style={{ color: 'var(--brand)' }}>{r.titulo}</a>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs" style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>{r.fuente_nombre}</span>
                          {r.fecha && <span style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>· {new Date(r.fecha).toLocaleDateString('es-ES')}</span>}
                          <span className="px-1.5 py-0.5 rounded text-xs" style={{ background: 'var(--brand-light)', color: 'var(--brand-dark)', fontSize: '10px' }}>
                            {Math.round(r.relevancia * 100)}% relevante
                          </span>
                        </div>
                        <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)', lineHeight: '1.5' }}>{r.resumen}</p>
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {r.terminos_encontrados.map((t: string) => (
                            <span key={t} className="text-xs px-1.5 py-0.5 rounded"
                              style={{ background: '#fef9c3', color: '#854d0e', fontSize: '10px' }}>{t}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ACTIVIDAD */}
        {activeTab === 'actividad' && (
          <div className="card p-6 text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>
            <Activity size={28} style={{ margin: '0 auto 8px', opacity: 0.3 }} />
            <p>Registro de actividad disponible próximamente</p>
          </div>
        )}
      </div>
    </div>
  )
}
