// src/components/VinculoForm.tsx
import { useState, useRef, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import toast from 'react-hot-toast'
import { X, Search, User, Building2 } from 'lucide-react'

interface Props {
  origenTipo: 'persona' | 'institucion'
  origenId: string
  origenNombre: string
  onClose: () => void
  vinculoExistente?: {
    id: string
    tipo_vinculo_id: number
    intensidad: number
    confianza?: number
    descripcion?: string
    bidireccional?: boolean
    destino_id: string
    destino_tipo: string
    destino_nombre: string
  }
}

const CAT_COLORS: Record<string, string> = {
  familiar: '#ec4899', laboral: '#3b82f6', comercial: '#f59e0b',
  politico: '#8b5cf6', social: '#10b981', corporativo: '#0ea5e9',
}

// ── Buscador de entidades ──────────────────────────────────────
function BuscadorEntidad({ onSelect, excluirId }: {
  onSelect: (e: { id: string; nombre: string; tipo: string }) => void
  excluirId: string
}) {
  const [q, setQ] = useState('')
  const [resultados, setResultados] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const timer = useRef<any>(null)

  useEffect(() => {
    if (q.length < 2) { setResultados([]); return }
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      setLoading(true)
      try {
        const r = await api.get(`/search?q=${encodeURIComponent(q)}&limite=8`)
        setResultados((r.data.resultados || r.data.items || []).filter((e: any) => e.id !== excluirId))
      } catch { setResultados([]) }
      setLoading(false)
    }, 300)
  }, [q])

  return (
    <div>
      <div className="relative">
        <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
        <input className="input pl-8 text-xs" placeholder="Buscar persona o institución..."
          value={q} onChange={e => setQ(e.target.value)} autoFocus />
      </div>
      {loading && <p className="text-xs mt-2" style={{ color: 'var(--text-tertiary)' }}>Buscando...</p>}
      {resultados.length > 0 && (
        <div className="mt-1 rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
          {resultados.map((e: any) => (
            <button key={e.id} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:opacity-80"
              style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-primary)' }}
              onClick={() => { onSelect({ id: e.id, nombre: e.nombre, tipo: e.tipo }); setQ(''); setResultados([]) }}>
              {e.tipo === 'persona' ? <User size={13} style={{ color: 'var(--brand)' }} /> : <Building2 size={13} style={{ color: 'var(--brand)' }} />}
              <div>
                <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{e.nombre}</div>
                <div className="text-xs capitalize" style={{ color: 'var(--text-tertiary)' }}>{e.tipo}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Formulario principal ───────────────────────────────────────
export function VinculoForm({ origenTipo, origenId, origenNombre, onClose, vinculoExistente }: Props) {
  const queryClient = useQueryClient()
  const isEdit = !!vinculoExistente

  const [destino, setDestino] = useState<{ id: string; nombre: string; tipo: string } | null>(
    vinculoExistente ? { id: vinculoExistente.destino_id, nombre: vinculoExistente.destino_nombre, tipo: vinculoExistente.destino_tipo } : null
  )
  const [tipoVinculoId, setTipoVinculoId] = useState<number>(vinculoExistente?.tipo_vinculo_id ?? 18)
  const [intensidad, setIntensidad] = useState(vinculoExistente?.intensidad ?? 0.5)
  const [descripcion, setDescripcion] = useState(vinculoExistente?.descripcion ?? '')
  const [confianza, setConfianza] = useState(vinculoExistente?.confianza ?? 3)
  const [bidireccional, setBidireccional] = useState(vinculoExistente?.bidireccional ?? false)
  const [catFiltro, setCatFiltro] = useState<string>('todos')

  // Load tipos from API
  const { data: tiposData = [] } = useQuery({
    queryKey: ['tipos-vinculo'],
    queryFn: () => api.get('/vinculos/tipos').then((r: any) => r.data).catch(() => []),
  })

  const categorias = ['todos', ...new Set<string>(tiposData.map((t: any) => t.categoria))]
  const tiposFiltrados = catFiltro === 'todos' ? tiposData : tiposData.filter((t: any) => t.categoria === catFiltro)
  const tipoSeleccionado = tiposData.find((t: any) => t.id === tipoVinculoId)

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ['persona-vinculos'] })
    queryClient.invalidateQueries({ queryKey: ['inst-vinculos'] })
    queryClient.invalidateQueries({ queryKey: ['grafo'] })
  }

  const crearMut = useMutation({
    mutationFn: () => api.post('/vinculos', {
      origen_tipo: origenTipo, origen_id: origenId,
      destino_tipo: destino!.tipo, destino_id: destino!.id,
      tipo_vinculo_id: tipoVinculoId, intensidad,
      descripcion: descripcion || undefined, confianza, bidireccional,
    }).then(r => r.data),
    onSuccess: () => { invalidar(); toast.success('Vínculo creado'); onClose() },
    onError: (e: any) => toast.error(e?.response?.data?.detail || 'Error al crear'),
  })

  const editarMut = useMutation({
    mutationFn: () => api.patch(`/vinculos/${vinculoExistente!.id}`, {
      tipo_vinculo_id: tipoVinculoId, intensidad,
      descripcion: descripcion || undefined, confianza, bidireccional,
    }).then(r => r.data),
    onSuccess: () => { invalidar(); toast.success('Vínculo actualizado'); onClose() },
    onError: (e: any) => toast.error(e?.response?.data?.detail || 'Error al actualizar'),
  })

  const isPending = crearMut.isPending || editarMut.isPending

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div className="w-full max-w-lg rounded-xl shadow-xl overflow-hidden" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              {isEdit ? 'Editar vínculo' : 'Crear vínculo'}
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
              Desde: <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>{origenNombre}</span>
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:opacity-70" style={{ background: 'var(--bg-secondary)' }}>
            <X size={14} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4" style={{ maxHeight: '70vh', overflowY: 'auto' }}>

          {/* Destino */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
              Entidad destino
            </label>
            {destino ? (
              <div className="flex items-center justify-between px-3 py-2 rounded-lg" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
                <div className="flex items-center gap-2">
                  {destino.tipo === 'persona' ? <User size={13} style={{ color: 'var(--brand)' }} /> : <Building2 size={13} style={{ color: 'var(--brand)' }} />}
                  <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{destino.nombre}</span>
                  <span className="text-xs capitalize" style={{ color: 'var(--text-tertiary)' }}>· {destino.tipo}</span>
                </div>
                {!isEdit && (
                  <button onClick={() => setDestino(null)} className="text-xs hover:opacity-70" style={{ color: 'var(--text-tertiary)' }}>
                    <X size={12} />
                  </button>
                )}
              </div>
            ) : (
              <BuscadorEntidad onSelect={setDestino} excluirId={origenId} />
            )}
          </div>

          {/* Tipo de vínculo */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
              Tipo de vínculo
            </label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {categorias.map(cat => (
                <button key={cat} className="text-xs px-2.5 py-1 rounded-full capitalize transition-all"
                  style={{ background: catFiltro === cat ? (CAT_COLORS[cat] || 'var(--brand)') : 'var(--bg-secondary)', color: catFiltro === cat ? '#fff' : 'var(--text-secondary)' }}
                  onClick={() => setCatFiltro(cat)}>
                  {cat}
                </button>
              ))}
            </div>
            <select className="input" value={tipoVinculoId} onChange={e => setTipoVinculoId(Number(e.target.value))}>
              {tiposFiltrados.map((t: any) => (
                <option key={t.id} value={t.id}>{t.nombre}</option>
              ))}
            </select>
            {tipoSeleccionado && (
              <p className="text-xs mt-1 capitalize" style={{ color: CAT_COLORS[tipoSeleccionado.categoria] || 'var(--brand)' }}>
                Categoría: {tipoSeleccionado.categoria}
              </p>
            )}
          </div>

          {/* Intensidad y confianza */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                Intensidad — {Math.round(intensidad * 100)}%
              </label>
              <input type="range" min="0" max="1" step="0.1" value={intensidad}
                onChange={e => setIntensidad(Number(e.target.value))} className="w-full" />
              <div className="flex justify-between text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                <span>Débil</span><span>Fuerte</span>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>Confianza</label>
              <div className="flex gap-1">
                {[1,2,3,4,5].map(n => (
                  <button key={n} className="flex-1 py-1.5 text-xs rounded transition-all"
                    style={{ background: n <= confianza ? 'var(--brand)' : 'var(--bg-secondary)', color: n <= confianza ? '#fff' : 'var(--text-tertiary)' }}
                    onClick={() => setConfianza(n)}>{n}</button>
                ))}
              </div>
              <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                {['','No verificado','Baja','Media','Alta','Verificado'][confianza]}
              </p>
            </div>
          </div>

          {/* Descripción */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>Descripción / notas</label>
            <textarea className="input" rows={2} value={descripcion}
              onChange={e => setDescripcion(e.target.value)} placeholder="Contexto adicional..." />
          </div>

          {/* Bidireccional */}
          {!isEdit && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={bidireccional} onChange={e => setBidireccional(e.target.checked)} className="w-4 h-4" />
              <span className="text-xs" style={{ color: 'var(--text-primary)' }}>Vínculo bidireccional</span>
            </label>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4" style={{ borderTop: '1px solid var(--border)' }}>
          <button className="btn text-xs py-2 px-4" onClick={onClose}>Cancelar</button>
          <button className="btn-primary text-xs py-2 px-5"
            disabled={!destino || isPending}
            onClick={() => isEdit ? editarMut.mutate() : crearMut.mutate()}>
            {isPending ? (isEdit ? 'Guardando...' : 'Creando...') : (isEdit ? 'Guardar cambios' : 'Crear vínculo')}
          </button>
        </div>
      </div>
    </div>
  )
}
