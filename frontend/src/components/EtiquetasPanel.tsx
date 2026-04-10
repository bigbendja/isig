// src/components/EtiquetasPanel.tsx
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import toast from 'react-hot-toast'
import { X, Plus, Tag } from 'lucide-react'

interface Props {
  entidadTipo: 'persona' | 'institucion'
  entidadId: string
  readonly?: boolean
}

const CAT_COLORS: Record<string, string> = {
  riesgo: '#ef4444',
  categoría: '#3b82f6',
  gestión: '#10b981',
  personalizado: '#6b7280',
}

export function EtiquetasPanel({ entidadTipo, entidadId, readonly = false }: Props) {
  const queryClient = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [filtrocat, setFiltrocat] = useState('todos')

  // Etiquetas asignadas a esta entidad
  const { data: asignadas = [], isLoading } = useQuery({
    queryKey: ['etiquetas-entidad', entidadTipo, entidadId],
    queryFn: () => api.get(`/etiquetas/entidad/${entidadTipo}/${entidadId}`).then(r => r.data),
    enabled: !!entidadId,
  })

  // Todas las etiquetas disponibles
  const { data: todas = [] } = useQuery({
    queryKey: ['etiquetas-todas'],
    queryFn: () => api.get('/etiquetas').then(r => r.data),
    enabled: showAdd,
  })

  const asignarMut = useMutation({
    mutationFn: (etiqueta_id: number) =>
      api.post(`/etiquetas/entidad/${entidadTipo}/${entidadId}`, { etiqueta_id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['etiquetas-entidad', entidadTipo, entidadId] })
      toast.success('Etiqueta añadida')
    },
    onError: () => toast.error('Error al añadir etiqueta'),
  })

  const quitarMut = useMutation({
    mutationFn: (etiqueta_id: number) =>
      api.delete(`/etiquetas/entidad/${entidadTipo}/${entidadId}/${etiqueta_id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['etiquetas-entidad', entidadTipo, entidadId] })
    },
    onError: () => toast.error('Error al quitar etiqueta'),
  })

  const asignadasIds = new Set(asignadas.map((e: any) => e.id))
  const disponibles = todas.filter((e: any) => !asignadasIds.has(e.id))
  const categorias: string[] = ['todos', ...(Array.from(new Set(disponibles.map((e: any) => e.categoria))) as string[])]
  const disponiblesFiltradas = filtrocat === 'todos'
    ? disponibles
    : disponibles.filter((e: any) => e.categoria === filtrocat)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Tag size={12} style={{ color: 'var(--text-tertiary)' }} />
          <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
            Etiquetas
          </span>
        </div>
        {!readonly && (
          <button
            className="text-xs px-2 py-0.5 rounded hover:opacity-80 flex items-center gap-1"
            style={{ background: showAdd ? 'var(--brand)' : 'var(--bg-secondary)', color: showAdd ? '#fff' : 'var(--text-secondary)' }}
            onClick={() => setShowAdd(s => !s)}
          >
            {showAdd ? <><X size={10} /> Cerrar</> : <><Plus size={10} /> Añadir</>}
          </button>
        )}
      </div>

      {/* Etiquetas asignadas */}
      <div className="flex flex-wrap gap-1.5 min-h-6">
        {isLoading && <div className="skeleton h-5 w-16 rounded-full" />}
        {!isLoading && asignadas.length === 0 && (
          <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Sin etiquetas</span>
        )}
        {asignadas.map((e: any) => (
          <span
            key={e.id}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
            style={{ background: `${e.color}22`, color: e.color, border: `1px solid ${e.color}44` }}
          >
            {e.nombre}
            {!readonly && !e.auto && (
              <button
                className="hover:opacity-70"
                onClick={() => quitarMut.mutate(e.id)}
              >
                <X size={10} />
              </button>
            )}
          </span>
        ))}
      </div>

      {/* Panel para añadir etiquetas */}
      {showAdd && (
        <div className="rounded-lg p-3 space-y-2"
          style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
          <div className="flex gap-1 flex-wrap">
            {categorias.map(cat => (
              <button
                key={cat}
                className="text-xs px-2 py-0.5 rounded-full capitalize transition-all"
                style={{
                  background: filtrocat === cat ? (CAT_COLORS[cat] || 'var(--brand)') : 'var(--bg-primary)',
                  color: filtrocat === cat ? '#fff' : 'var(--text-secondary)',
                }}
                onClick={() => setFiltrocat(cat)}
              >
                {cat}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {disponiblesFiltradas.length === 0 && (
              <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                Todas las etiquetas de esta categoría ya están asignadas
              </span>
            )}
            {disponiblesFiltradas.map((e: any) => (
              <button
                key={e.id}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium hover:opacity-80 transition-opacity"
                style={{ background: `${e.color}22`, color: e.color, border: `1px solid ${e.color}44` }}
                onClick={() => asignarMut.mutate(e.id)}
                disabled={asignarMut.isPending}
              >
                <Plus size={10} /> {e.nombre}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
