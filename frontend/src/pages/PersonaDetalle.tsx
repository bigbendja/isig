// src/pages/PersonaDetalle.tsx
import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, RefreshCw, MapPin, AlertTriangle, Shield, Star, Edit2 , Pencil, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { personasService, api } from '@/services/api'
import { getRiskColor, getRiskLevel } from '@/types'
import { useAuthStore } from '@/stores'
import { VinculoForm } from '@/components/VinculoForm'
import { VinculosGrafo } from '@/components/VinculosGrafo'
import { EtiquetasPanel } from '@/components/EtiquetasPanel'

const TABS = ['general', 'contacto', 'laboral', 'financiero', 'digital', 'vínculos', 'eventos', 'IA']

function FieldRow({ label, value, locked }: { label: string; value?: string | number | null; locked?: boolean }) {
  if (locked) return (
    <div className="flex items-center justify-between py-2" style={{ borderBottom: '1px solid var(--border)' }}>
      <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <span className="text-xs flex items-center gap-1" style={{ color: 'var(--text-tertiary)' }}>
        <Shield size={10} /> Clasificado
      </span>
    </div>
  )
  if (!value && value !== 0) return null
  return (
    <div className="flex items-start justify-between py-2 gap-4" style={{ borderBottom: '1px solid var(--border)' }}>
      <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-secondary)', minWidth: '120px' }}>{label}</span>
      <span className="text-xs text-right font-medium" style={{ color: 'var(--text-primary)' }}>{value}</span>
    </div>
  )
}

function RiskBar({ score }: { score: number }) {
  const pct = Math.round(score * 100)
  const color = getRiskColor(score)
  const level = getRiskLevel(score)
  const labels: Record<string, string> = {
    none: 'Sin riesgo', low: 'Bajo', medium: 'Medio', high: 'Alto', critical: 'Crítico'
  }
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Score de riesgo</span>
        <span className="text-xs font-semibold" style={{ color }}>{pct}% — {labels[level]}</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-tertiary)' }}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}

export function PersonaDetalle() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { usuario } = useAuthStore()
  const [activeTab, setActiveTab] = useState('general')
  const queryClient = useQueryClient()
  const [showVinculoForm, setShowVinculoForm] = useState(false)
  const [editVinculo, setEditVinculo] = useState<any>(null)

  const { data: persona, isLoading, error } = useQuery({
    queryKey: ['persona', id],
    queryFn: () => personasService.obtener(id!),
    enabled: !!id,
  })

  const eliminarVinculoMut = useMutation({
    mutationFn: (vid: string) => api.delete(`/vinculos/${vid}`).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['persona-vinculos', id] })
      queryClient.refetchQueries({ queryKey: ['persona-vinculos', id] })
      queryClient.invalidateQueries({ queryKey: ['grafo'] })
      toast.success('Vínculo eliminado')
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail || 'Error al eliminar'),
  })

  const { data: vinculos } = useQuery({
    queryKey: ['persona-vinculos', id],
    queryFn: () => personasService.vinculos(id!),
    enabled: !!id && activeTab === 'vínculos',
  })

  const { data: eventos } = useQuery({
    queryKey: ['persona-eventos', id],
    queryFn: () => personasService.eventos(id!).catch(() => []),
    enabled: !!id && activeTab === 'eventos',
  })

  const recalcularMut = useMutation({
    mutationFn: () => personasService.recalcularScore(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['persona', id] })
      toast.success('Score recalculado')
    },
  })

  if (isLoading) return (
    <div className="space-y-4 max-w-5xl mx-auto animate-in">
      <div className="skeleton h-8 w-48 rounded" />
      <div className="grid grid-cols-3 gap-4">
        {[1,2,3].map(i => <div key={i} className="skeleton h-32 rounded-xl" />)}
      </div>
    </div>
  )

  if (error || !persona) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <AlertTriangle size={32} style={{ color: 'var(--text-tertiary)' }} />
      <p style={{ color: 'var(--text-secondary)' }}>Persona no encontrada o sin acceso</p>
      <button className="btn" onClick={() => navigate('/personas')}>← Volver</button>
    </div>
  )

  const nivel = usuario?.nivel_acceso ?? 1
  const initials = persona.nombre_completo.split(' ').map((w: string) => w[0]).filter((_: string, i: number) => i < 2).join('')

  return (
    <div className="space-y-4 max-w-5xl mx-auto animate-in">

      {/* Back + actions */}
      <div className="flex items-center justify-between">
        <button className="btn-ghost text-xs flex items-center gap-1.5" onClick={() => navigate('/personas')}>
          <ArrowLeft size={13} /> Personas
        </button>
        <div className="flex items-center gap-2">
          <button
            className="btn text-xs py-1"
            onClick={() => recalcularMut.mutate()}
            disabled={recalcularMut.isPending}
          >
            <RefreshCw size={12} className={recalcularMut.isPending ? 'animate-spin' : ''} />
            Recalcular score
          </button>
          {nivel >= 2 && (
            <button className="btn-primary text-xs py-1" onClick={() => navigate(`/personas/${id}/editar`)}>
              <Edit2 size={12} /> Editar
            </button>
          )}
        </div>
      </div>

      {/* Hero card */}
      <div className="card p-5">
        <div className="flex items-start gap-4">
          {/* Avatar */}
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-semibold flex-shrink-0"
            style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '2px solid var(--border)' }}
          >
            {initials}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-3 flex-wrap">
              <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                {persona.nombre_completo}
              </h1>
              {persona.es_pep && (
                <span className="badge" style={{ background: '#fef3c7', color: '#92400e', fontSize: '10px' }}>
                  PEP{persona.nivel_pep ? ` N${persona.nivel_pep}` : ''}
                </span>
              )}
              {persona.en_lista_vigilancia && (
                <span className="badge" style={{ background: '#fee2e2', color: '#991b1b', fontSize: '10px' }}>
                  ◆ En vigilancia
                </span>
              )}
              <span
                className="badge"
                style={{
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-secondary)',
                  fontSize: '10px',
                  border: '1px solid var(--border)',
                }}
              >
                N{persona.nivel_acceso_requerido}
              </span>
            </div>
            <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              {[persona.cargo_actual, persona.empresa_nombre].filter(Boolean).join(' · ')}
            </p>
            {(persona.ciudad_residencia || persona.pais_residencia) && (
              <p className="text-xs mt-1 flex items-center gap-1" style={{ color: 'var(--text-tertiary)' }}>
                <MapPin size={11} />
                {[persona.ciudad_residencia, persona.pais_residencia].filter(Boolean).join(', ')}
              </p>
            )}
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs font-mono px-2 py-0.5 rounded select-all"
                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-tertiary)', fontSize: '10px' }}>
                ID: {persona.id}
              </span>
              <button
                className="text-xs px-2 py-0.5 rounded hover:opacity-70 transition-opacity"
                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-tertiary)', fontSize: '10px' }}
                onClick={() => { navigator.clipboard.writeText(persona.id); toast.success('ID copiado') }}
              >
                Copiar ID
              </button>
            </div>
          </div>

          {/* Score + priority */}
          <div className="flex-shrink-0 w-40 space-y-3">
            <RiskBar score={persona.score_riesgo} />
            <div>
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Prioridad</span>
                <div className="flex gap-0.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      size={10}
                      fill={i < persona.nivel_prioridad ? 'var(--brand)' : 'none'}
                      style={{ color: i < persona.nivel_prioridad ? 'var(--brand)' : 'var(--border)' }}
                    />
                  ))}
                </div>
              </div>
              <div>
                <div className="flex justify-between mb-0.5">
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Completitud</span>
                  <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{Math.round(persona.completitud)}%</span>
                </div>
                <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--bg-tertiary)' }}>
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${persona.completitud}%`, background: 'var(--brand)' }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {TABS.map(tab => (
          <button
            key={tab}
            className="px-3 py-1.5 rounded-md text-xs font-medium flex-shrink-0 transition-all"
            style={{
              background: activeTab === tab ? 'var(--brand)' : 'var(--bg-primary)',
              color: activeTab === tab ? 'white' : 'var(--text-secondary)',
              border: `1px solid ${activeTab === tab ? 'var(--brand)' : 'var(--border)'}`,
            }}
            onClick={() => setActiveTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Etiquetas - always visible */}
      <div className="card p-4">
        <EtiquetasPanel entidadTipo="persona" entidadId={persona.id} />
      </div>

      {/* Tab content */}
      <div className="card p-4">

        {/* GENERAL */}
        {activeTab === 'general' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-tertiary)' }}>
                Identificación
              </h3>
              <FieldRow label="Nombre completo" value={persona.nombre_completo} />
              <FieldRow label="Nombres" value={persona.nombres} />
              <FieldRow label="Apellidos" value={persona.apellidos} />
              <FieldRow label="Alias" value={persona.alias?.join(', ')} />
              <FieldRow label="Género" value={persona.genero} />
              <FieldRow label="Fecha nacimiento" value={persona.fecha_nacimiento
                ? new Date(persona.fecha_nacimiento).toLocaleDateString('es-ES') : null} />
              <FieldRow label="Lugar nacimiento" value={persona.lugar_nacimiento} />
              <FieldRow label="Nacionalidad" value={persona.nacionalidad} />
              <FieldRow label="Otras nac." value={persona.otras_nacs?.join(', ')} />
              <FieldRow label="Estado civil" value={persona.estado_civil} />
              <FieldRow label="Idiomas" value={persona.idiomas?.join(', ')} />
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-tertiary)' }}>
                Inteligencia
              </h3>
              <FieldRow label="Score riesgo" value={`${Math.round(persona.score_riesgo * 100)}%`} />
              <FieldRow label="Score influencia" value={`${Math.round(persona.score_influencia * 100)}%`} />
              <FieldRow label="Versión score" value={persona.score_version} />
              <FieldRow label="Fuente primaria" value={persona.fuente_primaria} />
              {nivel >= 4 && (
                <FieldRow label="Listas externas" value={persona.listas_externas?.join(', ')} />
              )}
              {nivel < 4 && persona.en_lista_vigilancia && (
                <FieldRow label="Listas externas" locked />
              )}

              {/* Campos extendidos */}
              {persona.perfil_extendido && Object.keys(persona.perfil_extendido).length > 0 && (
                <>
                  <h3 className="text-xs font-semibold uppercase tracking-wider mt-4 mb-3" style={{ color: 'var(--text-tertiary)' }}>
                    Datos adicionales
                  </h3>
                  {Object.entries(persona.perfil_extendido).map(([key, field]: [string, any]) => (
                    <div key={key} className="py-2" style={{ borderBottom: '1px solid var(--border)' }}>
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                          {key.replace(/_/g, ' ')}
                        </span>
                        <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                          {String(field?.valor ?? '')}
                        </span>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        )}

        {/* CONTACTO */}

        {activeTab === 'contacto' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-tertiary)' }}>
                Contacto
              </h3>
              <FieldRow label="Email principal" value={persona.email_principal} />
              <FieldRow label="Teléfono" value={persona.telefono_principal} />
              <FieldRow label="País residencia" value={persona.pais_residencia} />
              <FieldRow label="Ciudad" value={persona.ciudad_residencia} />
              <FieldRow label="Dirección" value={persona.direccion_principal} />
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-tertiary)' }}>
                Ubicación
              </h3>
              {persona.ubicacion_actual ? (
                <div
                  className="h-40 rounded-lg flex items-center justify-center text-xs"
                  style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-tertiary)' }}
                >
                  <div className="text-center">
                    <MapPin size={20} className="mx-auto mb-2" style={{ color: 'var(--brand)' }} />
                    <div>{persona.ciudad_residencia}, {persona.pais_residencia}</div>
                    <button
                      className="mt-2 text-xs hover:underline"
                      style={{ color: 'var(--brand)' }}
                      onClick={() => {/* navegar al mapa con esta entidad */}}
                    >
                      Ver en mapa →
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  className="h-40 rounded-lg flex items-center justify-center text-xs"
                  style={{ background: 'var(--bg-secondary)', border: '1px dashed var(--border)', color: 'var(--text-tertiary)' }}
                >
                  Sin geolocalización registrada
                </div>
              )}
            </div>
          </div>
        )}

        {/* LABORAL */}
        {activeTab === 'laboral' && (
          <div>
            <FieldRow label="Cargo actual" value={persona.cargo_actual} />
            <FieldRow label="Empresa" value={persona.empresa_nombre} />
            <FieldRow label="Sector" value={persona.sector_principal} />
            <FieldRow label="Es PEP" value={persona.es_pep ? `Sí — Nivel ${persona.nivel_pep || '—'}` : 'No'} />
          </div>
        )}

        {/* FINANCIERO */}
        {activeTab === 'financiero' && (
          <div>
            {nivel >= 3 ? (
              <>
                <FieldRow label="Nivel de riqueza" value={persona.nivel_riqueza} />
                <FieldRow label="Patrimonio estimado"
                  value={persona.patrimonio_est
                    ? `${persona.patrimonio_est.toLocaleString('es-ES')}`
                    : null}
                />
                <FieldRow label="Ingresos anuales est."
                  value={persona.ingresos_anuales_est
                    ? persona.ingresos_anuales_est.toLocaleString('es-ES')
                    : null}
                />
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 gap-2">
                <Shield size={24} style={{ color: 'var(--text-tertiary)' }} />
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  Los datos financieros requieren nivel 3 (Confidencial)
                </p>
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  Tu nivel actual: {nivel}
                </p>
              </div>
            )}
          </div>
        )}

        {/* VÍNCULOS */}
        {showVinculoForm && persona && (
          <VinculoForm
            origenTipo="persona"
            origenId={persona.id}
            origenNombre={persona.nombre_completo}
            onClose={() => setShowVinculoForm(false)}
          />
        )}
        {editVinculo && persona && (
          <VinculoForm
            origenTipo="persona"
            origenId={persona.id}
            origenNombre={persona.nombre_completo}
            onClose={() => setEditVinculo(null)}
            vinculoExistente={editVinculo}
          />
        )}

        {activeTab === 'vínculos' && (
          <div className="space-y-4">
            {/* Grafo de red */}
            {persona && (
              <VinculosGrafo
                entidadId={persona.id}
                entidadTipo="persona"
                entidadNombre={persona.nombre_completo}
                nivel={nivel}
              />
            )}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
            <div className="flex justify-end">
              {nivel >= 2 && (
                <button className="btn-primary text-xs py-1" onClick={() => setShowVinculoForm(true)}>
                  + Añadir vínculo
                </button>
              )}
            </div>
            {vinculos?.items?.length === 0 && (
              <p className="text-xs text-center py-8" style={{ color: 'var(--text-tertiary)' }}>
                Sin vínculos registrados
              </p>
            )}
            {vinculos?.items?.map((v: any) => (
              <div
                key={v.id}
                className="flex items-center gap-3 p-3 rounded-lg"
                style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
              >
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: 'var(--brand)', opacity: v.intensidad }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                    {v.destino_id === id ? v.origen_nombre : v.destino_nombre}
                  </div>
                  <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    {v.tipo_vinculo_nombre} · Intensidad {Math.round(v.intensidad * 100)}%
                  </div>
                </div>
                <span
                  className="text-xs px-1.5 py-0.5 rounded"
                  style={{
                    background: v.destino_tipo === 'persona' ? '#dbeafe' : '#fef3c7',
                    color: v.destino_tipo === 'persona' ? '#1e40af' : '#92400e',
                    fontSize: '10px',
                  }}
                >
                  {v.destino_id === id ? v.origen_tipo : v.destino_tipo}
                </span>
                {nivel >= 2 && (
                  <div className="flex gap-1 flex-shrink-0">
                    <button className="flex items-center gap-1 text-xs px-2 py-1 rounded hover:opacity-70"
                      style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
                      onClick={() => setEditVinculo({
                        id: v.id,
                        tipo_vinculo_id: v.tipo_vinculo_id,
                        intensidad: v.intensidad,
                        confianza: v.confianza,
                        descripcion: v.descripcion,
                        bidireccional: v.bidireccional,
                        destino_id: v.destino_id === id ? v.origen_id : v.destino_id,
                        destino_tipo: v.destino_id === id ? v.origen_tipo : v.destino_tipo,
                        destino_nombre: v.destino_id === id ? v.origen_nombre : v.destino_nombre,
                      })}>✏️</button>
                    <button className="text-xs px-2 py-1 rounded hover:opacity-70"
                      style={{ background: '#fee2e2', color: '#dc2626' }}
                      onClick={() => { if (confirm('¿Eliminar este vínculo?')) eliminarVinculoMut.mutate(v.id) }}>🗑️</button>
                  </div>
                )}
              </div>
            ))}
          </div>
            </div>
        )}

        {/* EVENTOS */}
        {activeTab === 'eventos' && (
          <div className="space-y-0">
            {(!eventos || eventos.length === 0) && (
              <p className="text-xs text-center py-8" style={{ color: 'var(--text-tertiary)' }}>
                Sin eventos registrados
              </p>
            )}
            {eventos?.map((e: any, i: number) => (
              <div key={e.id} className="flex gap-3 pb-4">
                <div className="flex flex-col items-center">
                  <div className="w-2 h-2 rounded-full flex-shrink-0 mt-1" style={{ background: 'var(--brand)' }} />
                  {i < (eventos?.length ?? 0) - 1 && (
                    <div className="w-px flex-1 mt-1" style={{ background: 'var(--border)' }} />
                  )}
                </div>
                <div className="flex-1 pb-2">
                  <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                    {e.titulo}
                  </div>
                  {e.descripcion && (
                    <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                      {e.descripcion}
                    </div>
                  )}
                  <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>
                    {e.fecha_evento
                      ? new Date(e.fecha_evento).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })
                      : 'Sin fecha'}
                    {e.fuente ? ` · ${e.fuente}` : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* IA */}
        {activeTab === 'IA' && (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{ background: 'var(--brand-light)' }}
            >
              <span style={{ color: 'var(--brand-dark)', fontSize: '20px' }}>◉</span>
            </div>
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              Análisis con IA
            </p>
            <p className="text-xs text-center max-w-sm" style={{ color: 'var(--text-secondary)' }}>
              El asistente analizará el expediente completo de esta persona y generará un informe
              de riesgo, patrones detectados y recomendaciones de seguimiento.
            </p>
            <button
              className="btn-primary text-xs py-2 px-4"
              onClick={() => {/* navegar al módulo IA con contexto de esta persona */}}
            >
              Analizar con IA →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
