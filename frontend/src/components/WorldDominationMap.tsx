// src/components/WorldDominationMap.tsx
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/services/api'
import { Search, X } from 'lucide-react'

// Comprehensive mapping: DB country name/code → ISO_A3 used in GeoJSON
const TO_ISO3: Record<string, string> = {
  // Guinea Ecuatorial variants
  'Guinea Ecuatorial': 'GNQ', 'Equatorial Guinea': 'GNQ', 'GQ': 'GNQ', 'GNQ': 'GNQ',
  // Spain
  'España': 'ESP', 'Spain': 'ESP', 'ES': 'ESP', 'ESP': 'ESP',
  // France
  'France': 'FRA', 'Francia': 'FRA', 'FR': 'FRA', 'FRA': 'FRA',
  // Africa
  'Camerún': 'CMR', 'Cameroon': 'CMR', 'CM': 'CMR',
  'Nigeria': 'NGA', 'NG': 'NGA',
  'Gabon': 'GAB', 'Gabón': 'GAB', 'GA': 'GAB',
  'Congo': 'COG', 'República del Congo': 'COG', 'CG': 'COG',
  'RD Congo': 'COD', 'Democratic Republic of Congo': 'COD', 'CD': 'COD',
  'Angola': 'AGO', 'AO': 'AGO',
  'Morocco': 'MAR', 'Marruecos': 'MAR', 'MA': 'MAR',
  'Egypt': 'EGY', 'Egipto': 'EGY', 'EG': 'EGY',
  'South Africa': 'ZAF', 'Sudáfrica': 'ZAF', 'ZA': 'ZAF',
  'Kenya': 'KEN', 'KE': 'KEN',
  'Ethiopia': 'ETH', 'Etiopía': 'ETH', 'ET': 'ETH',
  // Europe
  'Germany': 'DEU', 'Alemania': 'DEU', 'DE': 'DEU',
  'United Kingdom': 'GBR', 'UK': 'GBR', 'GB': 'GBR',
  'Italy': 'ITA', 'Italia': 'ITA', 'IT': 'ITA',
  'Portugal': 'PRT', 'PT': 'PRT',
  'Netherlands': 'NLD', 'Países Bajos': 'NLD', 'NL': 'NLD',
  'Switzerland': 'CHE', 'Suiza': 'CHE', 'CH': 'CHE',
  'Russia': 'RUS', 'Rusia': 'RUS', 'RU': 'RUS',
  // Americas
  'United States': 'USA', 'USA': 'USA', 'US': 'USA',
  'Brazil': 'BRA', 'Brasil': 'BRA', 'BR': 'BRA',
  'Mexico': 'MEX', 'México': 'MEX', 'MX': 'MEX',
  'Argentina': 'ARG', 'AR': 'ARG',
  'Colombia': 'COL', 'CO': 'COL',
  'Venezuela': 'VEN', 'VE': 'VEN',
  'Chile': 'CHL', 'CL': 'CHL',
  // Asia
  'China': 'CHN', 'CN': 'CHN',
  'Japan': 'JPN', 'Japón': 'JPN', 'JP': 'JPN',
  'India': 'IND', 'IN': 'IND',
  'Saudi Arabia': 'SAU', 'Arabia Saudí': 'SAU', 'SA': 'SAU',
  'Turkey': 'TUR', 'Turquía': 'TUR', 'TR': 'TUR',
  'Israel': 'ISR', 'IL': 'ISR',
  'UAE': 'ARE', 'Emiratos Árabes': 'ARE', 'AE': 'ARE',
  // Oceania
  'Australia': 'AUS', 'AU': 'AUS',
}

// ISO 3166-1 numeric → alpha-3 for world-atlas
const NUMERIC_TO_ISO3: Record<string, string> = {
  '032':'ARG','036':'AUS','040':'AUT','056':'BEL','076':'BRA','124':'CAN',
  '152':'CHL','156':'CHN','170':'COL','178':'COG','180':'COD','204':'BEN',
  '218':'ECU','818':'EGY','231':'ETH','250':'FRA','276':'DEU','288':'GHA',
  '226':'GNQ','320':'GTM','324':'GIN','368':'IRQ','364':'IRN','380':'ITA',
  '388':'JAM','392':'JPN','404':'KEN','410':'KOR','504':'MAR','484':'MEX',
  '528':'NLD','566':'NGA','578':'NOR','604':'PER','608':'PHL','616':'POL',
  '620':'PRT','630':'PRI','643':'RUS','682':'SAU','710':'ZAF','724':'ESP',
  '752':'SWE','756':'CHE','764':'THA','792':'TUR','800':'UGA','804':'UKR',
  '784':'ARE','826':'GBR','840':'USA','862':'VEN','704':'VNM',
  '024':'AGO','072':'BWA','266':'GAB','508':'MOZ','516':'NAM','716':'ZWE',
}

function getIso(feature: any): string {
  // geo-countries GeoJSON uses "ISO3166-1-Alpha-3"
  const iso = feature.properties?.['ISO3166-1-Alpha-3'] ||
    feature.properties?.ISO_A3 ||
    feature.properties?.iso_a3 ||
    feature.properties?.ADM0_A3 ||
    feature.properties?.ISO3
  if (iso && iso !== '-99') return iso
  const numId = feature.id?.toString().padStart(3, '0')
  return NUMERIC_TO_ISO3[numId] || numId || ''
}


function MapLegend({ paises }: { paises: any[] }) {
  if (!paises.length) return null
  const realMax = Math.max(...paises.map((p: any) => Number(p.total)), 1)

  // Generate 4 dynamic ranges based on real max
  const r1 = 1
  const r2 = Math.max(Math.round(realMax * 0.1), 2)
  const r3 = Math.max(Math.round(realMax * 0.4), r2 + 1)
  const r4 = Math.max(Math.round(realMax * 0.75), r3 + 1)

  return (
    <div className="absolute bottom-8 left-4 z-40 px-3 py-2 rounded-lg text-xs"
      style={{ background: 'rgba(255,255,255,0.92)', border: '1px solid #e5e7eb', color: '#374151', lineHeight: '1.9' }}>
      <div style={{ fontSize: '9px', fontWeight: 700, color: '#9ca3af', letterSpacing: '0.08em', marginBottom: '2px' }}>ENTIDADES POR PAÍS</div>
      <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm" style={{ background: '#fff', border: '1px solid #d1d5db' }} /> 0</div>
      <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm" style={{ background: '#d4d4d4' }} /> {r1} – {r2}</div>
      <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm" style={{ background: '#a3a3a3' }} /> {r2 + 1} – {r3}</div>
      <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm" style={{ background: '#737373' }} /> {r3 + 1} – {r4}</div>
      <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm" style={{ background: '#3c3c3c' }} /> + {r4}</div>
    </div>
  )
}

export function WorldDominationMap() {
  const mapRef = useRef<any>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const geoLayerRef = useRef<any>(null)
  const markersRef = useRef<any[]>([])
  const [mapLoaded, setMapLoaded] = useState(false)
  const [searchQ, setSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])

  const { data: entidades = [] } = useQuery({
    queryKey: ['mapa-overview'],
    queryFn: () => api.get('/mapa/entidades?limite=500').then((r: any) => r.data).catch(() => []),
    enabled: mapLoaded,
  })

  const { data: paises = [] } = useQuery({
    queryKey: ['mapa-paises'],
    queryFn: () => api.get('/mapa/paises').then((r: any) => r.data).catch(() => []),
    enabled: mapLoaded,
  })

  // Init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    import('leaflet').then((L) => {
      const map = L.map(containerRef.current!, {
        center: [20, 10], zoom: 2,
        zoomControl: false, attributionControl: false,
        minZoom: 1, maxZoom: 10,
      })
      L.control.zoom({ position: 'bottomright' }).addTo(map)
      // Labels only overlay (transparent background)
      L.tileLayer(
        'https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png',
        { subdomains: 'abcd', maxZoom: 19, opacity: 0.6 }
      ).addTo(map)
      mapRef.current = map
      setMapLoaded(true)
    })
    return () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null } }
  }, [])

  // Draw choropleth
  useEffect(() => {
    if (!mapRef.current || !paises.length) return

    import('leaflet').then(async (L) => {
      if (geoLayerRef.current) { geoLayerRef.current.remove(); geoLayerRef.current = null }

      // Build ISO → count map
      const countByIso: Record<string, number> = {}
      const scoreByIso: Record<string, number> = {}
      console.log('[WorldMap] paises from API:', paises)
      paises.forEach((p: any) => {
        const iso = TO_ISO3[p.pais] || TO_ISO3[p.pais?.trim()] || TO_ISO3[p.pais?.toUpperCase()] || 
                    (p.pais?.length === 3 ? p.pais?.toUpperCase() : null)
        console.log('[WorldMap]', p.pais, '->', iso, 'count:', p.total)
        if (iso) {
          countByIso[iso] = (countByIso[iso] || 0) + Number(p.total)
          scoreByIso[iso] = p.score_medio || 0
        }
      })
      console.log('[WorldMap] countByIso:', countByIso)

      // Dynamic scale based on actual max, with minimum of 10 to avoid over-saturation
      const realMax = Math.max(...Object.values(countByIso), 1)
      const maxCount = Math.max(realMax, 10)

      // Load GeoJSON from local public folder
      let geojson: any
      try {
        const res = await fetch('/countries.geojson')
        geojson = await res.json()
        console.log('[WorldMap] GeoJSON loaded locally, features:', geojson.features?.length)
      } catch (e) {
        console.error('[WorldMap] Failed to load local GeoJSON:', e)
        return
      }

      const getFill = (iso: string) => {
        const count = countByIso[iso] || 0
        if (count === 0) return '#ffffff'
        const intensity = Math.min(count / maxCount, 1)
        // White → dark gray scale
        const gray = Math.round(220 - intensity * 160) // 220 (light) → 60 (dark)
        return `rgb(${gray},${gray},${gray})`
      }

      const layer = L.geoJSON(geojson, {
        style: (feature: any) => {
          const iso = getIso(feature)
          const count = countByIso[iso] || 0
          return {
            fillColor: getFill(iso),
            weight: count > 0 ? 1 : 0.5,
            color: '#9ca3af',
            fillOpacity: count > 0 ? 0.9 : 0.4,
          }
        },
        onEachFeature: (feature: any, lyr: any) => {
          const iso = getIso(feature)
          const count = countByIso[iso] || 0
          const name = feature.properties?.ADMIN || feature.properties?.name || iso
          const score = scoreByIso[iso]

          // Tooltip — plain text, no big box
          lyr.bindTooltip(
            `<b>${name}</b>${count > 0 ? `<br>${count} entidad${count !== 1 ? 'es' : ''}${score ? ` · score ${Math.round(score * 100)}%` : ''}` : '<br><span style="color:#9ca3af">Sin entidades</span>'}`,
            { className: 'sigint-map-tooltip', sticky: true, direction: 'top' }
          )

          lyr.on('mouseover', () => {
            // Only thicken the border — same fill, same shape, just bolder outline
            lyr.setStyle({ weight: 3, color: '#374151' })
            lyr.bringToFront()
          })
          lyr.on('mouseout', () => {
            layer.resetStyle(lyr)
          })
        },
      })

      layer.addTo(mapRef.current)
      geoLayerRef.current = layer
    })
  }, [paises])

  // Entity markers — only on search
  useEffect(() => {
    if (!mapRef.current) return
    import('leaflet').then((L) => {
      markersRef.current.forEach(m => m.remove())
      markersRef.current = []
      if (!searchQ) { setSearchResults([]); return }

      const q = searchQ.toLowerCase()
      const matches = entidades.filter((e: any) =>
        e.nombre.toLowerCase().includes(q) ||
        e.ciudad?.toLowerCase().includes(q) ||
        e.pais?.toLowerCase().includes(q)
      )
      setSearchResults(matches.slice(0, 8))

      matches.filter((e: any) => e.lat && e.lng).forEach((e: any) => {
        import('leaflet').then((L2) => {
          const icon = L2.divIcon({
            className: '',
            html: `<div style="width:12px;height:12px;border-radius:50%;background:#1d4ed8;border:2.5px solid #fff;box-shadow:0 0 0 2px #1d4ed8,0 2px 8px rgba(0,0,0,0.3)"></div>`,
            iconSize: [12, 12], iconAnchor: [6, 6],
          })
          const m = L2.marker([e.lat, e.lng], { icon })
          m.bindTooltip(`<b>${e.nombre}</b><br>${[e.subtitulo, e.ciudad].filter(Boolean).join(' · ')}`, { className: 'sigint-map-tooltip' })
          m.addTo(mapRef.current)
          markersRef.current.push(m)
        })
      })

      if (matches.length && matches[0].lat) {
        mapRef.current.flyTo([matches[0].lat, matches[0].lng], 6, { duration: 1.2 })
      }
    })
  }, [searchQ, entidades])

  const totalConCoordenadas = entidades.filter((e: any) => e.lat && e.lng).length

  return (
    <div className="card overflow-hidden relative">
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
            Mapa global de entidades
          </span>
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--bg-secondary)', color: 'var(--text-tertiary)' }}>
            {paises.length} países · {entidades.length} entidades
          </span>
        </div>
        <div className="relative">
          <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
          <input className="input pl-7 pr-7 py-1 text-xs w-52" placeholder="Buscar entidad, país..."
            value={searchQ} onChange={e => setSearchQ(e.target.value)} />
          {searchQ && (
            <button className="absolute right-2 top-1/2 -translate-y-1/2" onClick={() => setSearchQ('')}>
              <X size={11} style={{ color: 'var(--text-tertiary)' }} />
            </button>
          )}
        </div>
      </div>

      {searchResults.length > 0 && (
        <div className="absolute right-4 top-12 z-50 rounded-lg shadow-xl overflow-hidden w-64"
          style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)' }}>
          {searchResults.map((e: any) => (
            <button key={e.id} className="w-full text-left px-3 py-2 text-xs hover:opacity-80"
              style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-primary)' }}
              onClick={() => { if (e.lat && mapRef.current) mapRef.current.flyTo([e.lat, e.lng], 8) }}>
              <div className="font-medium">{e.nombre}</div>
              <div style={{ color: 'var(--text-tertiary)' }}>{[e.ciudad, e.pais].filter(Boolean).join(', ')}</div>
            </button>
          ))}
        </div>
      )}

      {/* Legend — rendered in React, needs maxCount from state */}
      <MapLegend paises={paises} />

      <div ref={containerRef} style={{ height: '440px', background: '#f0f4f8' }} />

      <style>{`
        .sigint-map-tooltip {
          background: rgba(17,24,39,0.9) !important;
          border: none !important;
          color: #f9fafb !important;
          border-radius: 6px !important;
          padding: 5px 10px !important;
          font-size: 12px !important;
          font-family: inherit !important;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3) !important;
          white-space: nowrap !important;
        }
        .sigint-map-tooltip::before { display: none !important; }
      `}</style>
    </div>
  )
}
