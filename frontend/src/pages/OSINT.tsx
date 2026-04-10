// src/pages/OSINT.tsx — v2
import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, X, Plus, Play, Pause, Trash2, Download, Upload, RefreshCw, Globe, Rss, Youtube, Twitter, AlertTriangle, Database } from 'lucide-react'
import { api } from '@/services/api'
import toast from 'react-hot-toast'

const TIPOS_FUENTE = [
  { valor: 'rss',           label: 'RSS / Blog',              icon: '📡', desc: 'Feed RSS o Atom de blogs y medios' },
  { valor: 'web_scraper',   label: 'Web / Noticias',          icon: '🌐', desc: 'Página web o portal de noticias' },
  { valor: 'twitter',       label: 'Twitter / X',             icon: '🐦', desc: 'Perfil o búsqueda en Twitter' },
  { valor: 'youtube',       label: 'YouTube',                 icon: '▶️', desc: 'Canal o playlist de YouTube' },
  { valor: 'telegram',      label: 'Telegram',                icon: '✈️', desc: 'Canal público de Telegram' },
  { valor: 'linkedin',      label: 'LinkedIn',                icon: '💼', desc: 'Perfil o empresa en LinkedIn' },
  { valor: 'google_alerts', label: 'Google Alerts',           icon: '🔔', desc: 'Alerta de Google para términos clave' },
  { valor: 'sanciones',     label: 'Lista de sanciones',      icon: '🚫', desc: 'OFAC, UE, ONU u otra lista oficial' },
  { valor: 'registro_mercantil', label: 'Registro mercantil', icon: '📋', desc: 'Registros de empresas y sociedades' },
  { valor: 'boletin_oficial', label: 'Boletín oficial',       icon: '📰', desc: 'BOE, BOGE u otros boletines oficiales' },
  { valor: 'api_externa',   label: 'API externa',             icon: '🔌', desc: 'API REST con autenticación' },
  { valor: 'manual',        label: 'Manual / CSV',            icon: '📁', desc: 'Ingesta manual de datos' },
]

const FRECUENCIAS = [
  { valor: '* * * * *',    label: 'Cada minuto (pruebas)' },
  { valor: '*/5 * * * *',  label: 'Cada 5 minutos' },
  { valor: '*/15 * * * *', label: 'Cada 15 minutos' },
  { valor: '*/30 * * * *', label: 'Cada 30 minutos' },
  { valor: '0 * * * *',    label: 'Cada hora' },
  { valor: '0 */6 * * *',  label: 'Cada 6 horas' },
  { valor: '0 0 * * *',    label: 'Diario (medianoche)' },
  { valor: '0 8 * * *',    label: 'Diario (8:00)' },
  { valor: '0 0 * * 1',    label: 'Semanal (lunes)' },
]

// CSV samples por tipo
const CSV_SAMPLES: Record<string, { headers: string[]; rows: string[][] }> = {
  rss: {
    headers: ['nombre', 'url_base', 'descripcion', 'frecuencia_cron', 'nivel_confianza'],
    rows: [
      ['BBC Mundo', 'https://feeds.bbci.co.uk/mundo/rss.xml', 'Noticias BBC en español', '0 */6 * * *', '4'],
      ['El País', 'https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada', 'Portada El País', '0 */4 * * *', '4'],
    ]
  },
  sanciones: {
    headers: ['nombre', 'url_base', 'descripcion', 'tipo_lista', 'frecuencia_cron', 'nivel_confianza'],
    rows: [
      ['OFAC SDN', 'https://www.treasury.gov/ofac/downloads/sdn.xml', 'Lista OFAC SDN USA', 'OFAC', '0 0 * * *', '5'],
      ['UE Sanciones', 'https://eeas.europa.eu/sanctions/docs/...', 'Lista sanciones UE', 'EU', '0 0 * * *', '5'],
    ]
  },
  web_scraper: {
    headers: ['nombre', 'url_base', 'descripcion', 'selector_css', 'frecuencia_cron', 'nivel_confianza'],
    rows: [
      ['BOGE Guinea', 'https://boge.guinea.gob.gq', 'Boletín Oficial Guinea Ecuatorial', '.articulo', '0 8 * * *', '5'],
    ]
  },
}

function downloadCSV(tipo: string) {
  const sample = CSV_SAMPLES[tipo] || CSV_SAMPLES.rss
  const rows = [sample.headers, ...sample.rows]
  const content = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n')
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = `sigint_fuentes_${tipo}_sample.csv`
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function TipoIcon({ tipo }: { tipo: string }) {
  const t = TIPOS_FUENTE.find(t => t.valor === tipo)
  return <span style={{ fontSize: '16px' }}>{t?.icon || '🌐'}</span>
}

function ModalNuevaFuente({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    nombre: '', tipo: 'rss', url_base: '', descripcion: '',
    frecuencia_cron: '0 */6 * * *', nivel_confianza: 3,
  })

  const crearMut = useMutation({
    mutationFn: () => api.post('/osint/fuentes', null, { params: form }).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['osint-fuentes'] })
      queryClient.invalidateQueries({ queryKey: ['osint-stats'] })
      toast.success('Fuente creada')
      onClose()
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail || 'Error al crear'),
  })

  const tipoInfo = TIPOS_FUENTE.find(t => t.valor === form.tipo)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div className="w-full max-w-lg rounded-xl shadow-xl overflow-hidden" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Nueva fuente OSINT</h2>
          <button onClick={onClose}><X size={15} style={{ color: 'var(--text-tertiary)' }} /></button>
        </div>
        <div className="px-5 py-4 space-y-3" style={{ maxHeight: '65vh', overflowY: 'auto' }}>

          {/* Tipo */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>Tipo de fuente *</label>
            <div className="grid grid-cols-3 gap-1.5">
              {TIPOS_FUENTE.map(t => (
                <button key={t.valor} type="button"
                  className="flex items-center gap-1.5 px-2 py-2 rounded-lg text-left transition-all hover:opacity-80"
                  style={{ background: form.tipo === t.valor ? 'var(--brand-light)' : 'var(--bg-secondary)', border: `1px solid ${form.tipo === t.valor ? 'var(--brand)' : 'var(--border)'}`, color: form.tipo === t.valor ? 'var(--brand-dark)' : 'var(--text-secondary)' }}
                  onClick={() => setForm(f => ({ ...f, tipo: t.valor }))}>
                  <span style={{ fontSize: '14px' }}>{t.icon}</span>
                  <span className="text-xs font-medium truncate">{t.label}</span>
                </button>
              ))}
            </div>
            {tipoInfo && <p className="text-xs mt-1.5" style={{ color: 'var(--text-tertiary)' }}>{tipoInfo.desc}</p>}
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Nombre *</label>
            <input className="input text-xs" value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Nombre descriptivo de la fuente" />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>URL / Endpoint</label>
            <input className="input text-xs" value={form.url_base} onChange={e => setForm(f => ({ ...f, url_base: e.target.value }))} placeholder="https://..." />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Descripción</label>
            <textarea className="input text-xs" rows={2} value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Frecuencia</label>
              <select className="input text-xs" value={form.frecuencia_cron} onChange={e => setForm(f => ({ ...f, frecuencia_cron: e.target.value }))}>
                {FRECUENCIAS.map(f => <option key={f.valor} value={f.valor}>{f.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Confianza (1-5)</label>
              <div className="flex gap-1">
                {[1,2,3,4,5].map(n => (
                  <button key={n} type="button" className="flex-1 py-1.5 text-xs rounded transition-all"
                    style={{ background: n <= form.nivel_confianza ? 'var(--brand)' : 'var(--bg-secondary)', color: n <= form.nivel_confianza ? '#fff' : 'var(--text-tertiary)' }}
                    onClick={() => setForm(f => ({ ...f, nivel_confianza: n }))}>{n}</button>
                ))}
              </div>
            </div>
          </div>

          {/* Download sample */}
          <div className="flex items-center gap-2 pt-1" style={{ borderTop: '1px solid var(--border)' }}>
            <button type="button" className="text-xs flex items-center gap-1.5 hover:opacity-80"
              style={{ color: 'var(--brand)' }} onClick={() => downloadCSV(form.tipo)}>
              <Download size={12} /> Descargar CSV de ejemplo para este tipo
            </button>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4" style={{ borderTop: '1px solid var(--border)' }}>
          <button className="btn text-xs py-2 px-4" onClick={onClose}>Cancelar</button>
          <button className="btn-primary text-xs py-2 px-5" disabled={!form.nombre || crearMut.isPending}
            onClick={() => crearMut.mutate()}>
            {crearMut.isPending ? 'Creando...' : 'Crear fuente'}
          </button>
        </div>
      </div>
    </div>
  )
}


function ModalEditarFuente({ fuente, onClose }: { fuente: any; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    nombre: fuente.nombre || '',
    url_base: fuente.url_base || '',
    descripcion: fuente.descripcion || '',
    frecuencia_cron: fuente.frecuencia_cron || '0 */6 * * *',
    nivel_confianza: fuente.nivel_confianza || 3,
  })

  const actualizarMut = useMutation({
    mutationFn: () => api.patch(`/osint/fuentes/${fuente.id}`, form).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['osint-fuentes'] })
      toast.success('Fuente actualizada')
      onClose()
    },
    onError: () => toast.error('Error al actualizar'),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div className="w-full max-w-md rounded-xl shadow-xl overflow-hidden" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Editar fuente</h2>
            <div className="flex items-center gap-1.5 mt-0.5">
              <TipoIcon tipo={fuente.tipo} />
              <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{TIPOS_FUENTE.find(t => t.valor === fuente.tipo)?.label || fuente.tipo}</span>
            </div>
          </div>
          <button onClick={onClose}><X size={15} style={{ color: 'var(--text-tertiary)' }} /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Nombre</label>
            <input className="input text-xs" value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>URL</label>
            <input className="input text-xs" value={form.url_base} onChange={e => setForm(f => ({ ...f, url_base: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Descripción</label>
            <input className="input text-xs" value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Frecuencia</label>
              <select className="input text-xs" value={form.frecuencia_cron} onChange={e => setForm(f => ({ ...f, frecuencia_cron: e.target.value }))}>
                {FRECUENCIAS.map(f => <option key={f.valor} value={f.valor}>{f.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Confianza (1-5)</label>
              <div className="flex gap-1">
                {[1,2,3,4,5].map(n => (
                  <button key={n} type="button" className="flex-1 py-1.5 text-xs rounded"
                    style={{ background: n <= form.nivel_confianza ? 'var(--brand)' : 'var(--bg-secondary)', color: n <= form.nivel_confianza ? '#fff' : 'var(--text-tertiary)' }}
                    onClick={() => setForm(f => ({ ...f, nivel_confianza: n }))}>{n}</button>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4" style={{ borderTop: '1px solid var(--border)' }}>
          <button className="btn text-xs py-2 px-4" onClick={onClose}>Cancelar</button>
          <button className="btn-primary text-xs py-2 px-5" disabled={actualizarMut.isPending}
            onClick={() => actualizarMut.mutate()}>
            {actualizarMut.isPending ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function OSINT() {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [showModal, setShowModal] = useState(false)
  const [editFuente, setEditFuente] = useState<any>(null)
  const [buscarQ, setBuscarQ]     = useState('')
  const [filtroTipo, setFiltroTipo] = useState('')

  const { data: stats } = useQuery({
    queryKey: ['osint-stats'],
    queryFn: () => api.get('/osint/stats').then((r: any) => r.data).catch(() => ({})),
    refetchInterval: 30_000,
  })

  const { data: fuentes = [], isLoading } = useQuery({
    queryKey: ['osint-fuentes'],
    queryFn: () => api.get('/osint/fuentes').then((r: any) => r.data).catch(() => []),
    refetchInterval: 30_000,
  })

  const toggleMut = useMutation({
    mutationFn: (id: number) => api.patch(`/osint/fuentes/${id}/toggle`).then(r => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['osint-fuentes'] }),
    onError: () => toast.error('Error al cambiar estado'),
  })

  const eliminarMut = useMutation({
    mutationFn: (id: number) => api.delete(`/osint/fuentes/${id}`).then(r => r.data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['osint-fuentes'] }); toast.success('Fuente eliminada') },
    onError: () => toast.error('Error al eliminar'),
  })

  const ejecutarMut = useMutation({
    mutationFn: (id: number) => api.post(`/osint/fuentes/${id}/ejecutar`).then(r => r.data),
    onSuccess: (d: any) => toast.success(d.message || 'Ejecución iniciada'),
    onError: () => toast.error('Error al ejecutar'),
  })

  const importarMut = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('archivo', file)
      formData.append('tipo_entidad', 'persona')
      formData.append('mapeo_columnas', JSON.stringify({ nombre: 'nombre_completo' }))
      return api.post('/osint/importar-csv', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data)
    },
    onSuccess: (d: any) => {
      queryClient.invalidateQueries({ queryKey: ['osint-stats'] })
      toast.success(`Importados: ${d.entidades_creadas} creadas, ${d.ignoradas} ignoradas`)
    },
    onError: () => toast.error('Error al importar'),
  })

  const fuentesFiltradas = fuentes.filter((f: any) => {
    const q = buscarQ.toLowerCase()
    const matchQ = !q || f.nombre?.toLowerCase().includes(q) || f.url_base?.toLowerCase().includes(q)
    const matchT = !filtroTipo || f.tipo === filtroTipo
    return matchQ && matchT
  })

  const s = stats || {}

  return (
    <div className="space-y-8 max-w-7xl mx-auto animate-in">
      {showModal && <ModalNuevaFuente onClose={() => setShowModal(false)} />}
      {editFuente && <ModalEditarFuente fuente={editFuente} onClose={() => setEditFuente(null)} />}
      <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
        onChange={e => { if (e.target.files?.[0]) importarMut.mutate(e.target.files[0]) }} />

      {/* FILA 1 — KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Fuentes activas',    value: s.fuentes_activas    ?? '—', icon: '📡', color: undefined },
          { label: 'Fuentes pausadas',   value: s.fuentes_pausadas   ?? '—', icon: '⏸️', color: undefined },
          { label: 'Datos pendientes',   value: s.datos_pendientes   ?? '—', icon: '📥', color: s.datos_pendientes ? '#f59e0b' : undefined },
          { label: 'Procesados hoy',     value: s.procesados_hoy     ?? '—', icon: '✅', color: undefined },
        ].map(k => (
          <div key={k.label} className="card p-4">
            <div className="flex items-start justify-between mb-2">
              <div className="text-xs" style={{ color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{k.label}</div>
              <span style={{ fontSize: '18px', opacity: 0.4 }}>{k.icon}</span>
            </div>
            <div className="text-2xl font-semibold" style={{ color: k.color || 'var(--text-primary)' }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* FILA 2+3 — Toolbar + Tabla */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-shrink-0">
            <h1 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Fuentes OSINT</h1>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{fuentes.length} configuradas</p>
          </div>
          <div className="flex-1" />
          <div className="relative" style={{ width: '180px' }}>
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
            <input className="input pl-8 py-1.5 text-xs w-full" placeholder="Buscar fuente..."
              value={buscarQ} onChange={e => setBuscarQ(e.target.value)} />
          </div>
          <select className="input text-xs py-1.5" style={{ width: '150px' }}
            value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}>
            <option value="">Todos los tipos</option>
            {TIPOS_FUENTE.map(t => <option key={t.valor} value={t.valor}>{t.label}</option>)}
          </select>
          {(buscarQ || filtroTipo) && (
            <button className="text-xs flex items-center gap-1" style={{ color: 'var(--text-tertiary)' }}
              onClick={() => { setBuscarQ(''); setFiltroTipo('') }}>
              <X size={11} /> Limpiar
            </button>
          )}
          <div className="flex-1" />
          <button className="btn text-xs py-1.5 px-3 flex items-center gap-1.5 flex-shrink-0"
            onClick={() => fileRef.current?.click()} disabled={importarMut.isPending}>
            <Upload size={13} /> {importarMut.isPending ? 'Importando...' : 'Importar CSV'}
          </button>
          <button className="btn text-xs py-1.5 px-3 flex items-center gap-1.5 flex-shrink-0"
            onClick={() => downloadCSV('rss')}>
            <Download size={13} /> CSV ejemplo
          </button>
          <button className="btn-primary text-xs py-1.5 px-4 flex items-center gap-1.5 flex-shrink-0"
            onClick={() => setShowModal(true)}>
            <Plus size={13} /> Nueva fuente
          </button>
        </div>

        <div className="card overflow-hidden">
          <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                {['Tipo', 'Nombre', 'URL', 'Frecuencia', 'Confianza', 'Ejecuciones', 'Pendientes', 'Estado', 'Acciones'].map(h => (
                  <th key={h} className="text-left px-3 py-2.5 font-medium uppercase tracking-wider"
                    style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && Array.from({ length: 3 }).map((_, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  {Array.from({ length: 9 }).map((_, j) => (
                    <td key={j} className="px-3 py-3"><div className="skeleton h-3 rounded w-3/4" /></td>
                  ))}
                </tr>
              ))}
              {!isLoading && fuentesFiltradas.map((f: any) => (
                <tr key={f.id} style={{ borderBottom: '1px solid var(--border)', opacity: f.activa ? 1 : 0.6 }}>
                  <td className="px-3 py-3"><TipoIcon tipo={f.tipo} /></td>
                  <td className="px-3 py-3 font-medium" style={{ color: 'var(--text-primary)' }}>{f.nombre}</td>
                  <td className="px-3 py-3" style={{ maxWidth: '200px' }}>
                    <div className="truncate text-xs" style={{ color: 'var(--text-tertiary)' }}>{f.url_base || '—'}</div>
                  </td>
                  <td className="px-3 py-3" style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    {FRECUENCIAS.find(fr => fr.valor === f.frecuencia_cron)?.label || f.frecuencia_cron || '—'}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex gap-0.5">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <div key={i} className="w-1.5 h-1.5 rounded-full"
                          style={{ background: i < (f.nivel_confianza || 0) ? 'var(--brand)' : 'var(--bg-tertiary)' }} />
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-3" style={{ color: 'var(--text-secondary)' }}>{f.total_ejecuciones || 0}</td>
                  <td className="px-3 py-3">
                    {f.pendientes > 0
                      ? <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: '#fef9c3', color: '#854d0e', fontSize: '10px' }}>{f.pendientes}</span>
                      : <span style={{ color: 'var(--text-tertiary)' }}>0</span>}
                  </td>
                  <td className="px-3 py-3">
                    <span className="text-xs px-2 py-0.5 rounded-full"
                      style={{ background: f.activa ? '#dcfce7' : '#f1f5f9', color: f.activa ? '#166534' : '#475569', fontSize: '10px' }}>
                      {f.activa ? '● Activa' : '○ Pausada'}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex gap-1">
                      <button className="btn p-1" title="Ejecutar ahora"
                        onClick={() => ejecutarMut.mutate(f.id)}>
                        <Play size={11} />
                      </button>
                      <button className="btn p-1" title={f.activa ? 'Pausar' : 'Activar'}
                        onClick={() => toggleMut.mutate(f.id)}>
                        {f.activa ? <Pause size={11} /> : <Play size={11} style={{ color: 'var(--brand)' }} />}
                      </button>
                      <button className="btn p-1" title="Editar"
                        onClick={() => setEditFuente(f)}>
                        <span style={{ fontSize: '11px' }}>✏️</span>
                      </button>
                      <button className="btn p-1" title="Eliminar"
                        style={{ color: '#dc2626' }}
                        onClick={() => { if (confirm(`¿Eliminar fuente "${f.nombre}"?`)) eliminarMut.mutate(f.id) }}>
                        <span style={{ fontSize: '11px' }}>🗑️</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!isLoading && fuentesFiltradas.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-10 text-center" style={{ color: 'var(--text-tertiary)' }}>
                  {fuentes.length === 0 ? 'No hay fuentes configuradas. Añade tu primera fuente OSINT.' : 'No hay fuentes que coincidan con los filtros'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* FILA 4 — Info CSV y tipos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-4">
          <div className="text-xs font-semibold mb-3 uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>📥 Importación masiva CSV</div>
          <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)', lineHeight: '1.6' }}>
            Puedes importar fuentes en masa usando un archivo CSV. Descarga el archivo de ejemplo para el tipo que necesites, rellena los datos y súbelo.
          </p>
          <div className="space-y-2">
            {TIPOS_FUENTE.filter(t => CSV_SAMPLES[t.valor]).map(t => (
              <button key={t.valor} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left hover:opacity-80 transition-all"
                style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
                onClick={() => downloadCSV(t.valor)}>
                <span>{t.icon}</span>
                <span className="text-xs flex-1" style={{ color: 'var(--text-primary)' }}>{t.label}</span>
                <Download size={12} style={{ color: 'var(--brand)' }} />
              </button>
            ))}
          </div>
        </div>

        <div className="card p-4">
          <div className="text-xs font-semibold mb-3 uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>📊 Tipos de fuentes disponibles</div>
          <div className="grid grid-cols-2 gap-2">
            {TIPOS_FUENTE.map(t => (
              <div key={t.valor} className="flex items-start gap-2 p-2 rounded-lg"
                style={{ background: 'var(--bg-secondary)' }}>
                <span style={{ fontSize: '14px', flexShrink: 0 }}>{t.icon}</span>
                <div>
                  <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{t.label}</div>
                  <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{t.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
