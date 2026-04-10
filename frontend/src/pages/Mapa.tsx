// src/pages/Mapa.tsx
import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapPin, Search, Layers, Filter } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { mapaService } from '@/services/api'
import { getRiskColor } from '@/types'

// Tipos de marcador según riesgo
function getMarkerColor(score: number, tipo: string): string {
  if (score >= 0.75) return '#ef4444'   // crítico — rojo
  if (score >= 0.5)  return '#f97316'   // alto — naranja
  if (tipo === 'institucion') return '#f59e0b'  // empresa — ámbar
  return '#3b82f6'                               // persona — azul
}

export function Mapa() {
  const navigate = useNavigate()
  const mapRef = useRef<any>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const markersRef = useRef<any[]>([])
  const [mapLoaded, setMapLoaded] = useState(false)
  const [filtroTipo, setFiltroTipo] = useState<string | undefined>()
  const [cityQuery, setCityQuery] = useState('')
  const [selectedEntity, setSelectedEntity] = useState<any>(null)
  const [bounds, setBounds] = useState<any>(null)

  const { data: entidades } = useQuery({
    queryKey: ['mapa-entidades', bounds, filtroTipo],
    queryFn: () => mapaService.entidades(bounds, filtroTipo),
    enabled: mapLoaded,
    staleTime: 60_000,
  })

  // Inicializar mapa Leaflet
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    // Importar Leaflet dinámicamente
    import('leaflet').then((L) => {
      const map = L.map(containerRef.current!, {
        center: [3.75, 8.78],   // Malabo, Guinea Ecuatorial
        zoom: 6,
        zoomControl: false,
      })

      // Añadir control de zoom en posición custom
      L.control.zoom({ position: 'bottomright' }).addTo(map)

      // Tile layer — OpenStreetMap
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19,
      }).addTo(map)

      // Actualizar bounds al mover el mapa
      map.on('moveend', () => {
        const b = map.getBounds()
        setBounds({
          norte: b.getNorth(),
          sur:   b.getSouth(),
          este:  b.getEast(),
          oeste: b.getWest(),
        })
      })

      mapRef.current = map
      setMapLoaded(true)

      // Trigger inicial de bounds
      const b = map.getBounds()
      setBounds({
        norte: b.getNorth(), sur: b.getSouth(),
        este: b.getEast(), oeste: b.getWest(),
      })
    })

    return () => {
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, [])

  // Actualizar marcadores cuando cambian los datos
  useEffect(() => {
    if (!mapRef.current || !entidades) return

    import('leaflet').then((L) => {
      // Limpiar marcadores anteriores
      markersRef.current.forEach(m => m.remove())
      markersRef.current = []

      entidades.forEach((entidad: any) => {
        if (!entidad.lat || !entidad.lng) return

        const color = getMarkerColor(entidad.score_riesgo, entidad.tipo)
        const isHighRisk = entidad.score_riesgo >= 0.75

        // Icono personalizado
        const icon = L.divIcon({
          className: '',
          html: `<div class="entity-marker ${entidad.tipo} ${isHighRisk ? 'high-risk' : ''}"
                      style="background:${color}; width:12px; height:12px; border-radius:50%;
                             border:2px solid white; box-shadow:0 0 0 1px rgba(0,0,0,0.2),0 2px 4px rgba(0,0,0,0.3);
                             ${isHighRisk ? `animation:pulse 2s infinite` : ''}">
                 </div>`,
          iconSize: [12, 12],
          iconAnchor: [6, 6],
        })

        const marker = L.marker([entidad.lat, entidad.lng], { icon })

        // Popup
        marker.bindPopup(`
          <div style="min-width:180px;font-family:inherit">
            <div style="font-weight:600;font-size:13px;margin-bottom:4px">${entidad.nombre}</div>
            <div style="font-size:11px;color:#666;margin-bottom:6px">
              ${entidad.tipo === 'persona' ? '◉ Persona' : '◈ Institución'}
            </div>
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
              <div style="flex:1;height:4px;background:#eee;border-radius:2px">
                <div style="height:100%;width:${Math.round(entidad.score_riesgo * 100)}%;
                            background:${color};border-radius:2px"></div>
              </div>
              <span style="font-size:11px;font-weight:500">${Math.round(entidad.score_riesgo * 100)}%</span>
            </div>
            <button
              onclick="window.__sigint_navigate('/${entidad.tipo}s/${entidad.id}')"
              style="width:100%;padding:4px 8px;background:var(--brand,#1D9E75);color:white;
                     border:none;border-radius:4px;font-size:11px;cursor:pointer"
            >
              Ver expediente →
            </button>
          </div>
        `, { maxWidth: 220 })

        marker.on('click', () => setSelectedEntity(entidad))
        marker.addTo(mapRef.current!)
        markersRef.current.push(marker)
      })
    })
  }, [entidades])

  // Exponer función de navegación al popup
  useEffect(() => {
    (window as any).__sigint_navigate = (path: string) => navigate(path)
    return () => { delete (window as any).__sigint_navigate }
  }, [navigate])

  // Búsqueda de ciudad
  const searchCity = useCallback(async () => {
    if (!cityQuery.trim() || !mapRef.current) return

    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cityQuery)}&format=json&limit=1`
      )
      const data = await res.json()
      if (data.length > 0) {
        const { lat, lon, display_name } = data[0]
        mapRef.current.setView([parseFloat(lat), parseFloat(lon)], 12)
      }
    } catch {
      // silently fail
    }
  }, [cityQuery])

  // Estadísticas rápidas del mapa
  const totalPersonas = entidades?.filter((e: any) => e.tipo === 'persona').length ?? 0
  const totalInst     = entidades?.filter((e: any) => e.tipo === 'institucion').length ?? 0
  const highRisk      = entidades?.filter((e: any) => e.score_riesgo >= 0.75).length ?? 0

  return (
    <div className="flex flex-col h-full" style={{ height: 'calc(100vh - var(--topbar-h) - 32px)' }}>

      {/* Toolbar */}
      <div
        className="flex items-center gap-3 px-4 py-2 flex-shrink-0"
        style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', marginBottom: '12px' }}
      >
        {/* City search */}
        <div className="flex items-center gap-2 flex-1 max-w-sm">
          <Search size={14} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
          <input
            className="input border-0 bg-transparent p-0 h-auto text-xs flex-1 outline-none"
            placeholder="Buscar ciudad o lugar..."
            value={cityQuery}
            onChange={(e) => setCityQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && searchCity()}
          />
          {cityQuery && (
            <button className="btn text-xs py-0.5 px-2" onClick={searchCity}>Ir</button>
          )}
        </div>

        <div className="h-4 w-px" style={{ background: 'var(--border)' }} />

        {/* Filtros de tipo */}
        <div className="flex items-center gap-1">
          <Filter size={12} style={{ color: 'var(--text-tertiary)' }} />
          {(['todos', 'persona', 'institucion'] as const).map((t) => (
            <button
              key={t}
              className="text-xs px-2 py-1 rounded transition-all"
              style={{
                background: (filtroTipo ?? 'todos') === t ? 'var(--brand)' : 'var(--bg-secondary)',
                color: (filtroTipo ?? 'todos') === t ? 'white' : 'var(--text-secondary)',
                border: '1px solid var(--border)',
              }}
              onClick={() => setFiltroTipo(t === 'todos' ? undefined : t)}
            >
              {t === 'todos' ? 'Todos' : t === 'persona' ? 'Personas' : 'Empresas'}
            </button>
          ))}
        </div>

        {/* Stats */}
        <div className="ml-auto flex items-center gap-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
          <span>
            <span className="font-medium" style={{ color: 'var(--accent-blue)' }}>{totalPersonas}</span> personas
          </span>
          <span>
            <span className="font-medium" style={{ color: 'var(--accent-amber)' }}>{totalInst}</span> empresas
          </span>
          {highRisk > 0 && (
            <span>
              <span className="font-medium" style={{ color: 'var(--accent-red)' }}>{highRisk}</span> alto riesgo
            </span>
          )}
        </div>
      </div>

      {/* Map container */}
      <div className="relative flex-1 rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

        {/* Legend */}
        <div
          className="absolute bottom-4 left-4 z-10 p-3 rounded-lg text-xs"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)' }}
        >
          <div className="font-medium mb-2" style={{ color: 'var(--text-primary)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            Leyenda
          </div>
          {[
            { color: '#3b82f6', label: 'Persona' },
            { color: '#f59e0b', label: 'Institución' },
            { color: '#f97316', label: 'Riesgo alto' },
            { color: '#ef4444', label: 'Riesgo crítico' },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-2 mb-1">
              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: color, border: '1.5px solid white', boxShadow: '0 0 0 1px rgba(0,0,0,0.15)' }} />
              <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
            </div>
          ))}
        </div>

        {/* Entity quick-view panel */}
        {selectedEntity && (
          <div
            className="absolute top-4 right-4 z-10 p-4 rounded-lg w-64 animate-in"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)' }}
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {selectedEntity.nombre}
                </div>
                <div className="text-xs" style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>
                  {selectedEntity.tipo === 'persona' ? 'Persona' : 'Institución'}
                </div>
              </div>
              <button
                className="text-xs"
                style={{ color: 'var(--text-tertiary)' }}
                onClick={() => setSelectedEntity(null)}
              >
                ✕
              </button>
            </div>

            <div className="mb-3">
              <div className="flex justify-between mb-1">
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Riesgo</span>
                <span className="text-xs font-medium" style={{ color: getRiskColor(selectedEntity.score_riesgo) }}>
                  {Math.round(selectedEntity.score_riesgo * 100)}%
                </span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-tertiary)' }}>
                <div
                  className="h-full rounded-full"
                  style={{ width: `${selectedEntity.score_riesgo * 100}%`, background: getRiskColor(selectedEntity.score_riesgo) }}
                />
              </div>
            </div>

            <button
              className="btn-primary w-full justify-center text-xs py-1.5"
              onClick={() => navigate(`/${selectedEntity.tipo}s/${selectedEntity.id}`)}
            >
              Ver expediente completo →
            </button>
          </div>
        )}

        {/* Loading overlay */}
        {!mapLoaded && (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ background: 'var(--bg-secondary)', zIndex: 10 }}
          >
            <div className="text-center">
              <div
                className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-3"
                style={{ borderColor: 'var(--brand)' }}
              />
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Cargando mapa...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
