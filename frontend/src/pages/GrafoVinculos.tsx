// src/pages/GrafoVinculos.tsx — v3: nodos por defecto, vínculos bajo demanda
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search, Eye, EyeOff, ZoomIn, ZoomOut, Maximize2, RotateCcw, X, User, Building2, ExternalLink, GitBranch } from 'lucide-react'
import { api } from '@/services/api'
import { getRiskColor } from '@/types'

const PERSONA_COLOR     = '#3b82f6'
const INSTITUCION_COLOR = '#f59e0b'

export function GrafoVinculos() {
  const navigate  = useNavigate()
  const cyRef     = useRef<any>(null)
  const container = useRef<HTMLDivElement>(null)

  const [mostrarVinculos, setMostrarVinculos] = useState(false)
  const [selectedNode, setSelectedNode]       = useState<any>(null)
  const [mostrarVecindad, setMostrarVecindad] = useState(false)
  const [searchQ, setSearchQ]                 = useState('')
  const [searchResults, setSearchResults]     = useState<any[]>([])
  const [cyReady, setCyReady]                 = useState(false)

  // All nodes (no edges by default)
  const { data: grafoData, isLoading } = useQuery({
    queryKey: ['grafo-global'],
    queryFn: () => api.get('/grafo/global', { params: { limite: 500 } }).then(r => r.data),
    staleTime: 120_000,
  })

  // Neighborhood for selected node
  const { data: vecindadData } = useQuery({
    queryKey: ['vecindad', selectedNode?.id],
    queryFn: () => api.get(`/grafo/vecindad/${selectedNode.tipo}/${selectedNode.id}?profundidad=2`).then(r => r.data),
    enabled: !!selectedNode && mostrarVecindad,
    staleTime: 60_000,
  })

  // Init Cytoscape
  useEffect(() => {
    if (!container.current || cyRef.current) return
    import('cytoscape').then(mod => {
      const cy = mod.default({
        container: container.current!,
        elements: [],
        style: [
          {
            selector: 'node',
            style: {
              'background-color': (ele: any) => ele.data('tipo') === 'persona' ? PERSONA_COLOR : INSTITUCION_COLOR,
              'label': 'data(label)',
              'color': '#fff',
              'text-valign': 'center',
              'text-halign': 'center',
              'font-size': '9px',
              'font-weight': 600,
              'text-wrap': 'wrap',
              'text-max-width': '60px',
              'width': (ele: any) => ele.data('size') || 30,
              'height': (ele: any) => ele.data('size') || 30,
              'border-width': 2,
              'border-color': '#ffffff33',
              'text-outline-width': 1,
              'text-outline-color': '#00000066',
              'transition-property': 'background-color, border-color, border-width',
              'transition-duration': 200,
            },
          },
          {
            selector: 'node:selected',
            style: {
              'border-width': 4,
              'border-color': '#fff',
              'background-color': '#fff',
              'color': '#111',
            },
          },
          {
            selector: 'node.highlighted',
            style: { 'border-width': 3, 'border-color': '#facc15' },
          },
          {
            selector: 'edge',
            style: {
              'width': (ele: any) => Math.max(1, (ele.data('intensidad') || 0.3) * 4),
              'line-color': '#6b7280',
              'opacity': 0.5,
              'curve-style': 'bezier',
              'target-arrow-shape': 'triangle',
              'target-arrow-color': '#6b7280',
              'arrow-scale': 0.7,
              'label': '',
            },
          },
          {
            selector: 'edge.visible-label',
            style: {
              'label': 'data(label)',
              'font-size': '8px',
              'color': '#9ca3af',
              'text-rotation': 'autorotate',
            },
          },
        ],
        layout: { name: 'preset' },
        wheelSensitivity: 0.3,
        minZoom: 0.1,
        maxZoom: 4,
      })

      cy.on('tap', 'node', (evt: any) => {
        const node = evt.target
        setSelectedNode({ id: node.id(), tipo: node.data('tipo'), nombre: node.data('nombre'), score: node.data('score') })
      })
      cy.on('tap', (evt: any) => {
        if (evt.target === cy) { setSelectedNode(null); setMostrarVecindad(false) }
      })

      cyRef.current = cy
      setCyReady(true)
    })
    return () => { if (cyRef.current) { cyRef.current.destroy(); cyRef.current = null } }
  }, [])

  // Render nodes when data arrives
  useEffect(() => {
    if (!cyReady || !grafoData || !cyRef.current) return
    const cy = cyRef.current

    // Count connections per node
    const edgeCount: Record<string, number> = {}
    ;(grafoData.aristas || grafoData.edges || []).forEach((e: any) => {
      edgeCount[e.source] = (edgeCount[e.source] || 0) + 1
      edgeCount[e.target] = (edgeCount[e.target] || 0) + 1
    })

    // Remove old elements
    cy.elements().remove()

    // Add only nodes
    const nodeEls = (grafoData.nodos || grafoData.nodes || []).map((n: any) => {
      const connections = edgeCount[n.id] || 0
      const size = Math.max(28, Math.min(70, 28 + connections * 6))
      return {
        group: 'nodes' as const,
        data: {
          id: n.id,
          label: n.nombre?.length > 12 ? n.nombre.slice(0, 12) + '…' : (n.nombre || '?'),
          nombre: n.nombre,
          tipo: n.tipo,
          score: n.score_riesgo,
          connections,
          size,
        },
      }
    })

    cy.add(nodeEls)
    cy.layout({ name: 'cose', animate: true, animationDuration: 600, nodeRepulsion: 8000, padding: 40 }).run()

  }, [cyReady, grafoData])

  // Toggle all edges
  useEffect(() => {
    if (!cyReady || !cyRef.current || !grafoData) return
    const cy = cyRef.current

    if (!mostrarVinculos) {
      cy.edges().remove()
      return
    }

    // Add all edges
    cy.edges().remove()
    const edgeEls = (grafoData.aristas || grafoData.edges || []).map((e: any) => ({
      group: 'edges' as const,
      data: {
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.tipo_vinculo,
        intensidad: e.intensidad,
      },
    }))
    cy.add(edgeEls)
  }, [mostrarVinculos, cyReady, grafoData])

  // Show neighborhood
  useEffect(() => {
    if (!cyReady || !cyRef.current) return
    const cy = cyRef.current

    cy.nodes().removeClass('highlighted')

    if (!mostrarVecindad || !vecindadData) {
      cy.edges().remove()
      if (mostrarVinculos) {
        const edgeEls = (grafoData?.aristas || grafoData?.edges || []).map((e: any) => ({
          group: 'edges' as const,
          data: { id: e.id, source: e.source, target: e.target, label: e.tipo_vinculo, intensidad: e.intensidad },
        }))
        cy.add(edgeEls)
      }
      return
    }

    // Show only neighborhood edges
    cy.edges().remove()
    const vecNodes = new Set<string>()
    const vecEdges = vecindadData.aristas || vecindadData.edges || []
    vecEdges.forEach((e: any) => {
      vecNodes.add(e.source || e.origen_id); vecNodes.add(e.target || e.destino_id)
    })
    vecNodes.forEach(nid => { cy.$(`#${nid}`).addClass('highlighted') })

    const edgeEls = vecEdges.map((e: any) => ({
      group: 'edges' as const,
      data: { id: e.id, source: e.source || e.origen_id, target: e.target || e.destino_id, label: e.tipo || e.tipo_vinculo, intensidad: e.intensidad },
    }))
    cy.add(edgeEls)

    // Fit to neighborhood
    const neighborhood = cy.$(`#${selectedNode.id}`).closedNeighborhood()
    if (neighborhood.length > 1) cy.fit(neighborhood, 80)

  }, [mostrarVecindad, vecindadData, cyReady])

  // Search
  useEffect(() => {
    if (!searchQ || searchQ.length < 2) { setSearchResults([]); return }
    const timeout = setTimeout(async () => {
      try {
        const r = await api.get(`/entidades/search?q=${encodeURIComponent(searchQ)}&limite=8`)
        setSearchResults(r.data.items || [])
      } catch { setSearchResults([]) }
    }, 300)
    return () => clearTimeout(timeout)
  }, [searchQ])

  const focusNode = (id: string) => {
    if (!cyRef.current) return
    const node = cyRef.current.$(`#${id}`)
    if (node.length) {
      cyRef.current.animate({ fit: { eles: node, padding: 120 }, duration: 500 })
      node.select()
      setSelectedNode({ id: node.id(), tipo: node.data('tipo'), nombre: node.data('nombre'), score: node.data('score') })
    }
    setSearchQ(''); setSearchResults([])
  }

  const zoom = (factor: number) => cyRef.current?.zoom({ level: cyRef.current.zoom() * factor, renderedPosition: { x: container.current!.offsetWidth / 2, y: container.current!.offsetHeight / 2 } })
  const fit  = () => cyRef.current?.fit(undefined, 40)
  const reset = () => { cyRef.current?.reset(); setSelectedNode(null); setMostrarVecindad(false) }

  const nodeCount = (grafoData?.nodos || grafoData?.nodes)?.length || 0
  const edgeCount = (grafoData?.aristas || grafoData?.edges)?.length || 0

  return (
    <div style={{ height: 'calc(100vh - 120px)', display: 'flex', flexDirection: 'column', gap: '12px' }}>

      {/* Toolbar */}
      <div className="card px-4 py-3 flex items-center gap-3 flex-wrap">

        {/* Search */}
        <div className="relative" style={{ minWidth: '240px' }}>
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
          <input className="input pl-8 py-1.5 text-xs w-full" placeholder="Buscar entidad en el grafo..."
            value={searchQ} onChange={e => setSearchQ(e.target.value)} />
          {searchQ && (
            <button className="absolute right-2 top-1/2 -translate-y-1/2" onClick={() => { setSearchQ(''); setSearchResults([]) }}>
              <X size={11} style={{ color: 'var(--text-tertiary)' }} />
            </button>
          )}
          {searchResults.length > 0 && (
            <div className="absolute top-full left-0 mt-1 z-50 w-full rounded-lg shadow-xl overflow-hidden"
              style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)' }}>
              {searchResults.map((e: any) => (
                <button key={e.id} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:opacity-80"
                  style={{ borderBottom: '1px solid var(--border)' }} onClick={() => focusNode(e.id)}>
                  {e.tipo === 'persona' ? <User size={12} style={{ color: PERSONA_COLOR }} /> : <Building2 size={12} style={{ color: INSTITUCION_COLOR }} />}
                  <div>
                    <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{e.nombre}</div>
                    <div className="text-xs capitalize" style={{ color: 'var(--text-tertiary)' }}>{e.tipo}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Toggle edges */}
        <button className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-md transition-all"
          style={{ background: mostrarVinculos ? 'var(--brand)' : 'var(--bg-secondary)', color: mostrarVinculos ? '#fff' : 'var(--text-secondary)', border: `1px solid ${mostrarVinculos ? 'var(--brand)' : 'var(--border)'}` }}
          onClick={() => setMostrarVinculos(v => !v)}>
          {mostrarVinculos ? <Eye size={13} /> : <EyeOff size={13} />}
          {mostrarVinculos ? 'Ocultar vínculos' : 'Mostrar vínculos'}
        </button>

        {/* Stats */}
        <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
          <span><span className="font-semibold" style={{ color: PERSONA_COLOR }}>●</span> {(grafoData?.nodos || grafoData?.nodes || []).filter((n: any) => n.tipo === 'persona').length} personas</span>
          <span><span className="font-semibold" style={{ color: INSTITUCION_COLOR }}>●</span> {(grafoData?.nodos || grafoData?.nodes || []).filter((n: any) => n.tipo === 'institucion').length} instituciones</span>
          <span>🔗 {edgeCount} vínculos</span>
        </div>

        <div className="flex-1" />

        {/* Zoom controls */}
        <div className="flex items-center gap-1">
          <button className="btn p-1.5" onClick={() => zoom(1.3)}><ZoomIn size={13} /></button>
          <button className="btn p-1.5" onClick={() => zoom(0.77)}><ZoomOut size={13} /></button>
          <button className="btn p-1.5" onClick={fit}><Maximize2 size={13} /></button>
          <button className="btn p-1.5" onClick={reset}><RotateCcw size={13} /></button>
        </div>
      </div>

      {/* Graph canvas + node panel */}
      <div style={{ flex: 1, display: 'flex', gap: '12px', minHeight: 0 }}>

        {/* Canvas */}
        <div className="card overflow-hidden flex-1 relative">
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center z-10" style={{ background: 'var(--bg-primary)' }}>
              <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Cargando grafo…</div>
            </div>
          )}
          {!isLoading && nodeCount === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <GitBranch size={32} style={{ color: 'var(--text-tertiary)', opacity: 0.4 }} />
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Sin entidades ni vínculos. Crea personas o instituciones y añade vínculos.</p>
            </div>
          )}
          <div ref={container} style={{ width: '100%', height: '100%' }} />

          {/* Legend */}
          <div className="absolute bottom-4 left-4 text-xs px-3 py-2 rounded-lg"
            style={{ background: 'rgba(0,0,0,0.6)', color: '#fff', lineHeight: '1.8' }}>
            <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full" style={{ background: PERSONA_COLOR }} /> Persona</div>
            <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full" style={{ background: INSTITUCION_COLOR }} /> Institución</div>
            <div className="text-xs mt-1" style={{ color: '#9ca3af' }}>Tamaño = nº vínculos</div>
          </div>
        </div>

        {/* Node detail panel */}
        {selectedNode && (
          <div className="card overflow-hidden" style={{ width: '260px', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
            <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Entidad seleccionada</span>
              <button onClick={() => { setSelectedNode(null); setMostrarVecindad(false) }}>
                <X size={13} style={{ color: 'var(--text-tertiary)' }} />
              </button>
            </div>

            <div className="px-4 py-4 space-y-4 flex-1">
              {/* Identity */}
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                  style={{ background: selectedNode.tipo === 'persona' ? `${PERSONA_COLOR}22` : `${INSTITUCION_COLOR}22`, color: selectedNode.tipo === 'persona' ? PERSONA_COLOR : INSTITUCION_COLOR }}>
                  {selectedNode.tipo === 'persona' ? <User size={18} /> : <Building2 size={18} />}
                </div>
                <div>
                  <div className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{selectedNode.nombre}</div>
                  <div className="text-xs capitalize" style={{ color: 'var(--text-tertiary)' }}>{selectedNode.tipo}</div>
                </div>
              </div>

              {/* Risk score */}
              <div>
                <div className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>Score de riesgo</div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-secondary)' }}>
                    <div className="h-full rounded-full" style={{ width: `${(selectedNode.score || 0) * 100}%`, background: getRiskColor(selectedNode.score || 0) }} />
                  </div>
                  <span className="text-xs font-semibold" style={{ color: getRiskColor(selectedNode.score || 0) }}>
                    {Math.round((selectedNode.score || 0) * 100)}%
                  </span>
                </div>
              </div>

              {/* Connections */}
              <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                {cyRef.current?.$(`#${selectedNode.id}`).data('connections') || 0} vínculos directos
              </div>

              {/* Actions */}
              <div className="space-y-2">
                <button className="w-full flex items-center gap-2 text-xs px-3 py-2 rounded-lg transition-all hover:opacity-80"
                  style={{ background: mostrarVecindad ? 'var(--brand)' : 'var(--bg-secondary)', color: mostrarVecindad ? '#fff' : 'var(--text-primary)', border: `1px solid ${mostrarVecindad ? 'var(--brand)' : 'var(--border)'}` }}
                  onClick={() => setMostrarVecindad(v => !v)}>
                  <GitBranch size={13} />
                  {mostrarVecindad ? 'Ocultar red de vínculos' : 'Ver red de vínculos'}
                </button>

                <button className="w-full flex items-center gap-2 text-xs px-3 py-2 rounded-lg transition-all hover:opacity-80"
                  style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                  onClick={() => navigate(`/${selectedNode.tipo === 'persona' ? 'personas' : 'instituciones'}/${selectedNode.id}`)}>
                  <ExternalLink size={13} />
                  Ver expediente
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
