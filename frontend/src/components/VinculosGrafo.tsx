// src/components/VinculosGrafo.tsx
// Grafo de red de vínculos para la ficha de una entidad
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ZoomIn, ZoomOut, Maximize2, RotateCcw, GitBranch, List, Eye, EyeOff } from 'lucide-react'
import { api } from '@/services/api'
import { getRiskColor } from '@/types'

const PERSONA_COLOR     = '#3b82f6'
const INSTITUCION_COLOR = '#f59e0b'
const SELF_COLOR        = '#8b5cf6'

type ViewMode = 'graph' | 'list'
type Layout   = 'cose' | 'circle' | 'breadthfirst'

interface Props {
  entidadId: string
  entidadTipo: 'persona' | 'institucion'
  entidadNombre: string
  nivel: number
}

export function VinculosGrafo({ entidadId, entidadTipo, entidadNombre, nivel }: Props) {
  const navigate    = useNavigate()
  const cyRef       = useRef<any>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [cyReady, setCyReady]         = useState(false)
  const [viewMode, setViewMode]       = useState<ViewMode>('list')
  const [layout, setLayout]           = useState<Layout>('cose')
  const [mostrarEtiquetas, setMostrarEtiquetas] = useState(true)
  const [profundidad, setProfundidad] = useState(1)
  const [filtroTipo, setFiltroTipo]   = useState<'todos' | 'persona' | 'institucion'>('todos')

  const { data: vecindad, isLoading } = useQuery({
    queryKey: ['vecindad-ficha', entidadId, profundidad],
    queryFn: () => api.get(`/grafo/vecindad/${entidadTipo}/${entidadId}?profundidad=${profundidad}`)
      .then((r: any) => r.data)
      .catch(() => ({ nodos: [], aristas: [] })),
    enabled: !!entidadId,
  })

  // Normalise API response (nodos/aristas or nodes/edges)
  const nodos  = vecindad?.nodos  || vecindad?.nodes  || []
  const aristas = vecindad?.aristas || vecindad?.edges || []

  const nodosFiltrados = filtroTipo === 'todos'
    ? nodos
    : nodos.filter((n: any) => n.tipo === filtroTipo || n.id === entidadId)

  const aristasFiltradas = aristas.filter((e: any) => {
    const src = e.source || e.origen_id
    const tgt = e.target || e.destino_id
    const nodosIds = new Set(nodosFiltrados.map((n: any) => n.id))
    return nodosIds.has(src) && nodosIds.has(tgt)
  })

  // Init Cytoscape
  useEffect(() => {
    if (!containerRef.current || cyRef.current || viewMode !== 'graph') return
    import('cytoscape').then(mod => {
      const cy = mod.default({
        container: containerRef.current!,
        elements: [],
        style: [
          {
            selector: 'node',
            style: {
              'background-color': (ele: any) => ele.data('esSelf') ? SELF_COLOR : ele.data('tipo') === 'persona' ? PERSONA_COLOR : INSTITUCION_COLOR,
              'label': (ele: any) => mostrarEtiquetas ? ele.data('label') : '',
              'color': '#fff',
              'text-valign': 'center',
              'text-halign': 'center',
              'font-size': 9,
              'font-weight': 600,
              'text-wrap': 'wrap',
              'text-max-width': '55px',
              'width': (ele: any) => ele.data('size') || 32,
              'height': (ele: any) => ele.data('size') || 32,
              'border-width': (ele: any) => ele.data('esSelf') ? 3 : 1.5,
              'border-color': '#ffffff44',
              'text-outline-width': 1,
              'text-outline-color': '#00000066',
            },
          },
          {
            selector: 'node:selected',
            style: { 'border-width': 3, 'border-color': '#fff' },
          },
          {
            selector: 'edge',
            style: {
              'width': (ele: any) => Math.max(1, (ele.data('intensidad') || 0.3) * 3),
              'line-color': '#6b7280',
              'opacity': 0.6,
              'curve-style': 'bezier',
              'target-arrow-shape': 'triangle',
              'target-arrow-color': '#6b7280',
              'arrow-scale': 0.7,
              'label': (ele: any) => mostrarEtiquetas ? (ele.data('label') || '') : '',
              'font-size': 8,
              'color': '#9ca3af',
              'text-rotation': 'autorotate',
              'text-outline-width': 1,
              'text-outline-color': '#ffffff',
            },
          },
        ],
        layout: { name: 'preset' },
        wheelSensitivity: 0.3,
        minZoom: 0.2,
        maxZoom: 4,
      })
      cy.on('tap', 'node', (evt: any) => {
        const id   = evt.target.id()
        const tipo = evt.target.data('tipo')
        if (id !== entidadId) {
          navigate(`/${tipo === 'persona' ? 'personas' : 'instituciones'}/${id}`)
        }
      })
      cyRef.current = cy
      setCyReady(true)
    })
    return () => { if (cyRef.current) { cyRef.current.destroy(); cyRef.current = null; setCyReady(false) } }
  }, [viewMode])

  // Render graph
  useEffect(() => {
    if (!cyReady || !cyRef.current || viewMode !== 'graph') return
    const cy = cyRef.current
    cy.elements().remove()

    const nodeEls = nodosFiltrados.map((n: any) => {
      const isSelf    = n.id === entidadId
      const connCount = aristasFiltradas.filter((e: any) => (e.source || e.origen_id) === n.id || (e.target || e.destino_id) === n.id).length
      const size      = isSelf ? 50 : Math.max(28, Math.min(55, 28 + connCount * 5))
      return {
        group: 'nodes' as const,
        data: {
          id: n.id,
          label: n.nombre?.length > 14 ? n.nombre.slice(0, 14) + '…' : (n.nombre || '?'),
          nombre: n.nombre,
          tipo: n.tipo,
          score: n.score_riesgo,
          esSelf: isSelf,
          size,
        },
      }
    })

    const edgeEls = aristasFiltradas.map((e: any) => ({
      group: 'edges' as const,
      data: {
        id: e.id,
        source: e.source || e.origen_id,
        target: e.target || e.destino_id,
        label: e.tipo || e.tipo_vinculo || '',
        intensidad: e.intensidad || 0.5,
      },
    }))

    cy.add([...nodeEls, ...edgeEls])

    const layoutOpts: Record<Layout, any> = {
      cose:         { name: 'cose', animate: true, animationDuration: 500, nodeRepulsion: 6000, padding: 40 },
      circle:       { name: 'circle', animate: true, padding: 40 },
      breadthfirst: { name: 'breadthfirst', animate: true, padding: 40, roots: `#${entidadId}` },
    }
    cy.layout(layoutOpts[layout]).run()
  }, [cyReady, nodosFiltrados, aristasFiltradas, layout, viewMode])

  // Update labels when toggle changes
  useEffect(() => {
    if (!cyRef.current) return
    cyRef.current.style()
      .selector('node').style('label', (ele: any) => mostrarEtiquetas ? ele.data('label') : '')
      .selector('edge').style('label', (ele: any) => mostrarEtiquetas ? (ele.data('label') || '') : '')
      .update()
  }, [mostrarEtiquetas])

  const zoom = (f: number) => cyRef.current?.zoom({ level: cyRef.current.zoom() * f, renderedPosition: { x: containerRef.current!.offsetWidth / 2, y: containerRef.current!.offsetHeight / 2 } })

  const personaCount    = nodos.filter((n: any) => n.tipo === 'persona'     && n.id !== entidadId).length
  const institucionCount = nodos.filter((n: any) => n.tipo === 'institucion' && n.id !== entidadId).length

  if (isLoading) return (
    <div className="flex items-center justify-center py-12">
      <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Cargando red de vínculos…</div>
    </div>
  )

  if (nodos.length <= 1) return (
    <div className="flex flex-col items-center justify-center py-12 gap-2">
      <GitBranch size={28} style={{ color: 'var(--text-tertiary)', opacity: 0.4 }} />
      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Sin vínculos registrados para esta entidad</p>
    </div>
  )

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* View toggle */}
        <div className="flex rounded-md overflow-hidden" style={{ border: '1px solid var(--border)' }}>
          <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs transition-all"
            style={{ background: viewMode === 'graph' ? 'var(--brand)' : 'var(--bg-secondary)', color: viewMode === 'graph' ? '#fff' : 'var(--text-secondary)' }}
            onClick={() => setViewMode('graph')}>
            <GitBranch size={11} /> Grafo
          </button>
          <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs transition-all"
            style={{ background: viewMode === 'list' ? 'var(--brand)' : 'var(--bg-secondary)', color: viewMode === 'list' ? '#fff' : 'var(--text-secondary)' }}
            onClick={() => setViewMode('list')}>
            <List size={11} /> Lista
          </button>
        </div>

        {/* Depth */}
        <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
          <span>Profundidad:</span>
          {[1, 2, 3].map(d => (
            <button key={d} className="w-6 h-6 rounded text-xs font-medium transition-all"
              style={{ background: profundidad === d ? 'var(--brand)' : 'var(--bg-secondary)', color: profundidad === d ? '#fff' : 'var(--text-secondary)', border: '1px solid var(--border)' }}
              onClick={() => setProfundidad(d)}>{d}</button>
          ))}
        </div>

        {/* Type filter */}
        <div className="flex rounded-md overflow-hidden" style={{ border: '1px solid var(--border)' }}>
          {(['todos', 'persona', 'institucion'] as const).map(t => (
            <button key={t} className="px-2.5 py-1.5 text-xs capitalize transition-all"
              style={{ background: filtroTipo === t ? 'var(--bg-tertiary)' : 'var(--bg-secondary)', color: filtroTipo === t ? 'var(--text-primary)' : 'var(--text-tertiary)', fontWeight: filtroTipo === t ? 600 : 400 }}
              onClick={() => setFiltroTipo(t)}>
              {t === 'todos' ? 'Todos' : t === 'persona' ? `Personas (${personaCount})` : `Instituciones (${institucionCount})`}
            </button>
          ))}
        </div>

        {viewMode === 'graph' && (
          <>
            {/* Layout */}
            <select className="input text-xs py-1 px-2" value={layout} onChange={e => setLayout(e.target.value as Layout)}>
              <option value="cose">Orgánico</option>
              <option value="circle">Circular</option>
              <option value="breadthfirst">Árbol</option>
            </select>

            {/* Labels toggle */}
            <button className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md"
              style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
              onClick={() => setMostrarEtiquetas(v => !v)}>
              {mostrarEtiquetas ? <Eye size={11} /> : <EyeOff size={11} />}
              Etiquetas
            </button>

            {/* Zoom */}
            <div className="flex gap-1 ml-auto">
              <button className="btn p-1.5" onClick={() => zoom(1.3)}><ZoomIn size={12} /></button>
              <button className="btn p-1.5" onClick={() => zoom(0.77)}><ZoomOut size={12} /></button>
              <button className="btn p-1.5" onClick={() => cyRef.current?.fit(undefined, 40)}><Maximize2 size={12} /></button>
              <button className="btn p-1.5" onClick={() => cyRef.current?.reset()}><RotateCcw size={12} /></button>
            </div>
          </>
        )}
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--text-tertiary)' }}>
        <span><span className="font-semibold" style={{ color: PERSONA_COLOR }}>●</span> {personaCount} personas</span>
        <span><span className="font-semibold" style={{ color: INSTITUCION_COLOR }}>●</span> {institucionCount} instituciones</span>
        <span>🔗 {aristasFiltradas.length} vínculos</span>
      </div>

      {/* Graph view */}
      {viewMode === 'graph' && (
        <div style={{ height: '360px', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
          <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
        </div>
      )}

      {/* List view */}
      {viewMode === 'list' && (
        <div className="space-y-1.5">
          {aristasFiltradas.map((e: any) => {
            const srcId  = e.source || e.origen_id
            const tgtId  = e.target || e.destino_id
            const otherId = srcId === entidadId ? tgtId : srcId
            const otro   = nodos.find((n: any) => n.id === otherId)
            if (!otro) return null
            return (
              <button key={e.id} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:opacity-80 transition-opacity"
                style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
                onClick={() => navigate(`/${otro.tipo === 'persona' ? 'personas' : 'instituciones'}/${otro.id}`)}>
                <div className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: otro.tipo === 'persona' ? PERSONA_COLOR : INSTITUCION_COLOR }} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{otro.nombre}</div>
                  <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    {e.tipo || e.tipo_vinculo || '—'} · Intensidad {Math.round((e.intensidad || 0.5) * 100)}%
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div className="w-12 h-1 rounded-full overflow-hidden" style={{ background: 'var(--bg-tertiary)' }}>
                    <div className="h-full rounded-full" style={{ width: `${(e.intensidad || 0.5) * 100}%`, background: getRiskColor(otro.score_riesgo || 0) }} />
                  </div>
                  <span className="text-xs capitalize" style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>
                    {otro.tipo}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* Legend */}
      {viewMode === 'graph' && (
        <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--text-tertiary)' }}>
          <span className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-full" style={{ background: SELF_COLOR }} /> Esta entidad</span>
          <span className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-full" style={{ background: PERSONA_COLOR }} /> Persona</span>
          <span className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-full" style={{ background: INSTITUCION_COLOR }} /> Institución</span>
          <span className="text-xs">Click en nodo → ir al expediente</span>
        </div>
      )}
    </div>
  )
}
