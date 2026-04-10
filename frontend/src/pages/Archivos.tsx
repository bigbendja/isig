// src/pages/Archivos.tsx
import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, X, Plus, Upload, Folder, FolderOpen, File, FileText, Trash2, ChevronRight, Home, Eye } from 'lucide-react'
import { api } from '@/services/api'
import toast from 'react-hot-toast'

const TIPOS_DOCUMENTO = [
  { valor: 'factura',             label: 'Factura',                 icon: '🧾' },
  { valor: 'contrato',            label: 'Contrato',                icon: '📝' },
  { valor: 'informe',             label: 'Informe',                 icon: '📊' },
  { valor: 'noticia',             label: 'Noticia / Artículo',      icon: '📰' },
  { valor: 'acta_minuta',         label: 'Acta / Minuta',           icon: '📋' },
  { valor: 'resolucion_oficial',  label: 'Resolución oficial',      icon: '🏛️' },
  { valor: 'extracto_bancario',   label: 'Extracto bancario',       icon: '🏦' },
  { valor: 'documento_identidad', label: 'Documento de identidad',  icon: '🪪' },
  { valor: 'expediente',          label: 'Expediente',              icon: '🗂️' },
  { valor: 'comunicacion_interna',label: 'Comunicación interna',    icon: '📨' },
  { valor: 'presupuesto',         label: 'Presupuesto',             icon: '💰' },
  { valor: 'escritura_notarial',  label: 'Escritura notarial',      icon: '⚖️' },
  { valor: 'sentencia_judicial',  label: 'Sentencia judicial',      icon: '🔨' },
  { valor: 'licencia_permiso',    label: 'Licencia / Permiso',      icon: '✅' },
  { valor: 'otro',                label: 'Otro',                    icon: '📄' },
]

const ESTADO_CFG: Record<string, { label: string; bg: string; text: string }> = {
  sin_procesar:   { label: 'Sin procesar',    bg: '#f1f5f9', text: '#475569' },
  texto_extraido: { label: 'Texto extraído',  bg: '#dbeafe', text: '#1e40af' },
  procesado:      { label: 'Procesado ✓',     bg: '#dcfce7', text: '#166534' },
  procesando:     { label: 'Procesando...',   bg: '#fef9c3', text: '#854d0e' },
  error:          { label: 'Error',           bg: '#fee2e2', text: '#dc2626' },
}

function formatBytes(b: number) {
  if (!b) return '—'
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

function fileIcon(ext: string, tipo: string) {
  const t = TIPOS_DOCUMENTO.find(t => t.valor === tipo)
  if (t && t.valor !== 'otro') return t.icon
  if (ext === 'pdf') return '📕'
  if (['doc','docx'].includes(ext)) return '📘'
  if (['xls','xlsx'].includes(ext)) return '📗'
  if (['jpg','jpeg','png','gif'].includes(ext)) return '🖼️'
  if (['mp4','avi','mov'].includes(ext)) return '🎬'
  return '📄'
}

// ── MODAL SUBIR ARCHIVO ───────────────────────────────────────
function ModalSubirArchivo({ carpetaId, onClose }: { carpetaId: string | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [archivo, setArchivo] = useState<File | null>(null)
  const [form, setForm] = useState({
    tipo_documento: 'otro',
    descripcion: '',
    nivel_acceso: 1,
    procesar_automatico: true,
  })
  const [buscarQ, setBuscarQ] = useState('')
  const [buscarResults, setBuscarResults] = useState<any[]>([])
  const [entidadSel, setEntidadSel] = useState<any>(null)

  const subirMut = useMutation({
    mutationFn: async () => {
      if (!archivo) throw new Error('Sin archivo')
      const fd = new FormData()
      fd.append('archivo', archivo)
      if (carpetaId) fd.append('carpeta_id', carpetaId)
      fd.append('tipo_documento', form.tipo_documento)
      fd.append('descripcion', form.descripcion)
      fd.append('nivel_acceso', String(form.nivel_acceso))
      fd.append('procesar_automatico', String(form.procesar_automatico))
      if (entidadSel) {
        fd.append('entidad_tipo', entidadSel.tipo)
        fd.append('entidad_id', entidadSel.id)
      }
      return api.post('/archivos/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data)
    },
    onSuccess: (d: any) => {
      queryClient.invalidateQueries({ queryKey: ['archivos'] })
      queryClient.invalidateQueries({ queryKey: ['archivos-kpis'] })
      toast.success(`Archivo subido${d.texto_extraido ? ' — texto extraído ✓' : ''}`)
      onClose()
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail || 'Error al subir'),
  })

  const buscar = async (q: string) => {
    setBuscarQ(q)
    if (q.length < 2) { setBuscarResults([]); return }
    const r = await api.get(`/search?q=${encodeURIComponent(q)}&limite=5`).catch(() => ({ data: { resultados: [] } }))
    setBuscarResults((r.data as any).resultados || [])
  }

  const tipoSel = TIPOS_DOCUMENTO.find(t => t.valor === form.tipo_documento)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.65)' }}>
      <div className="w-full max-w-lg rounded-xl shadow-2xl overflow-hidden" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Subir archivo</h2>
          <button onClick={onClose}><X size={15} style={{ color: 'var(--text-tertiary)' }} /></button>
        </div>

        <div className="px-5 py-4 space-y-4" style={{ maxHeight: '70vh', overflowY: 'auto' }}>

          {/* Drop zone */}
          <div className="rounded-xl border-2 border-dashed flex flex-col items-center justify-center py-8 cursor-pointer hover:opacity-80 transition-all"
            style={{ borderColor: archivo ? 'var(--brand)' : 'var(--border)', background: archivo ? 'var(--brand-light)' : 'var(--bg-secondary)' }}
            onClick={() => fileRef.current?.click()}>
            <input ref={fileRef} type="file" className="hidden"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.jpg,.jpeg,.png,.md"
              onChange={e => { if (e.target.files?.[0]) setArchivo(e.target.files[0]) }} />
            {archivo ? (
              <div className="text-center">
                <div className="text-2xl mb-1">{fileIcon(archivo.name.split('.').pop() || '', form.tipo_documento)}</div>
                <div className="text-xs font-semibold" style={{ color: 'var(--brand)' }}>{archivo.name}</div>
                <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{formatBytes(archivo.size)}</div>
              </div>
            ) : (
              <div className="text-center">
                <Upload size={24} style={{ color: 'var(--text-tertiary)', margin: '0 auto 8px' }} />
                <div className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Haz click o arrastra un archivo</div>
                <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>PDF, Word, Excel, imágenes, texto — máx. 50MB</div>
              </div>
            )}
          </div>

          {/* Tipo de documento */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
              Tipo de documento *
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {TIPOS_DOCUMENTO.map(t => (
                <button key={t.valor} type="button"
                  className="flex items-center gap-1.5 px-2 py-2 rounded-lg text-left hover:opacity-80"
                  style={{ background: form.tipo_documento === t.valor ? 'var(--brand-light)' : 'var(--bg-secondary)', border: `1px solid ${form.tipo_documento === t.valor ? 'var(--brand)' : 'var(--border)'}`, color: form.tipo_documento === t.valor ? 'var(--brand-dark)' : 'var(--text-secondary)' }}
                  onClick={() => setForm(f => ({ ...f, tipo_documento: t.valor }))}>
                  <span style={{ fontSize: '14px' }}>{t.icon}</span>
                  <span className="text-xs truncate">{t.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Descripción */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Notas / Descripción</label>
            <textarea className="input text-xs" rows={2}
              placeholder="Contexto del documento, qué información contiene..."
              value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} />
          </div>

          {/* Clasificación + procesamiento */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Clasificación</label>
              <select className="input text-xs" value={form.nivel_acceso}
                onChange={e => setForm(f => ({ ...f, nivel_acceso: Number(e.target.value) }))}>
                {[1,2,3,4,5].map(n => <option key={n} value={n}>Nivel {n}</option>)}
              </select>
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <div className="w-8 h-4 rounded-full transition-all relative"
                  style={{ background: form.procesar_automatico ? 'var(--brand)' : 'var(--bg-tertiary)' }}
                  onClick={() => setForm(f => ({ ...f, procesar_automatico: !f.procesar_automatico }))}>
                  <div className="w-3 h-3 bg-white rounded-full absolute top-0.5 transition-all"
                    style={{ left: form.procesar_automatico ? '17px' : '2px' }} />
                </div>
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Extraer texto automáticamente</span>
              </label>
            </div>
          </div>

          {/* Vincular entidad */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Vincular a entidad (opcional)</label>
            {entidadSel ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg"
                style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
                <span className="text-xs flex-1" style={{ color: 'var(--text-primary)' }}>
                  {entidadSel.tipo === 'persona' ? '👤' : '🏢'} {entidadSel.nombre}
                </span>
                <button onClick={() => setEntidadSel(null)}><X size={11} /></button>
              </div>
            ) : (
              <div className="relative">
                <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
                <input className="input pl-8 text-xs" placeholder="Buscar persona o institución..."
                  value={buscarQ} onChange={e => buscar(e.target.value)} />
                {buscarResults.length > 0 && (
                  <div className="absolute top-full left-0 w-full mt-1 rounded-lg overflow-hidden z-10"
                    style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)' }}>
                    {buscarResults.map((e: any) => (
                      <button key={e.id} className="w-full flex items-center gap-2 px-3 py-2 hover:opacity-80"
                        style={{ borderBottom: '1px solid var(--border)' }}
                        onClick={() => { setEntidadSel(e); setBuscarQ(''); setBuscarResults([]) }}>
                        <span className="text-xs">{e.tipo === 'persona' ? '👤' : '🏢'}</span>
                        <span className="text-xs" style={{ color: 'var(--text-primary)' }}>{e.nombre}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4" style={{ borderTop: '1px solid var(--border)' }}>
          <button className="btn text-xs py-2 px-4" onClick={onClose}>Cancelar</button>
          <button className="btn-primary text-xs py-2 px-5"
            disabled={!archivo || subirMut.isPending}
            onClick={() => subirMut.mutate()}>
            {subirMut.isPending ? 'Subiendo...' : '↑ Subir archivo'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── MODAL VER TEXTO EXTRAÍDO ──────────────────────────────────
function ModalTexto({ archivo, onClose }: { archivo: any; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ['archivo-texto', archivo.id],
    queryFn: () => api.get(`/archivos/${archivo.id}/texto`).then((r: any) => r.data),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.65)' }}>
      <div className="w-full max-w-2xl rounded-xl shadow-2xl overflow-hidden" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{archivo.nombre}</h2>
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Texto extraído</span>
          </div>
          <button onClick={onClose}><X size={15} style={{ color: 'var(--text-tertiary)' }} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {!data ? (
            <div className="text-xs text-center py-8" style={{ color: 'var(--text-tertiary)' }}>Cargando...</div>
          ) : data.texto_extraido ? (
            <pre className="text-xs whitespace-pre-wrap" style={{ color: 'var(--text-primary)', lineHeight: '1.7', fontFamily: 'inherit' }}>
              {data.texto_extraido}
            </pre>
          ) : (
            <div className="text-xs text-center py-8" style={{ color: 'var(--text-tertiary)' }}>
              No hay texto extraído para este archivo
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── PÁGINA PRINCIPAL ──────────────────────────────────────────
export function Archivos() {
  const queryClient = useQueryClient()
  const [carpetaActual, setCarpetaActual] = useState<string | null>(null)
  const [breadcrumb, setBreadcrumb] = useState<Array<{ id: string; nombre: string }>>([])
  const [showSubir, setShowSubir] = useState(false)
  const [showNuevaCarpeta, setShowNuevaCarpeta] = useState(false)
  const [nombreCarpeta, setNombreCarpeta] = useState('')
  const [buscarQ, setBuscarQ] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('')
  const [verTexto, setVerTexto] = useState<any>(null)

  const { data: kpis } = useQuery({
    queryKey: ['archivos-kpis'],
    queryFn: () => api.get('/archivos/kpis').then((r: any) => r.data).catch(() => ({})),
  })

  const { data: carpetas = [] } = useQuery({
    queryKey: ['carpetas', carpetaActual],
    queryFn: () => api.get('/archivos/carpetas', { params: { parent_id: carpetaActual || undefined } }).then((r: any) => r.data).catch(() => []),
  })

  const { data: archivos = [], isLoading } = useQuery({
    queryKey: ['archivos', carpetaActual, buscarQ, filtroTipo],
    queryFn: () => api.get('/archivos', {
      params: {
        carpeta_id: buscarQ ? undefined : (carpetaActual || undefined),
        buscar: buscarQ || undefined,
        tipo_documento: filtroTipo || undefined,
      }
    }).then((r: any) => r.data).catch(() => []),
  })

  const crearCarpetaMut = useMutation({
    mutationFn: () => api.post('/archivos/carpetas', { nombre: nombreCarpeta, parent_id: carpetaActual }).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['carpetas'] })
      toast.success('Carpeta creada')
      setShowNuevaCarpeta(false)
      setNombreCarpeta('')
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail || 'Error al crear carpeta'),
  })

  const eliminarCarpetaMut = useMutation({
    mutationFn: (id: string) => api.delete(`/archivos/carpetas/${id}`).then(r => r.data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['carpetas'] }); toast.success('Carpeta eliminada') },
  })

  const eliminarArchivoMut = useMutation({
    mutationFn: (id: string) => api.delete(`/archivos/${id}`).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['archivos'] })
      queryClient.invalidateQueries({ queryKey: ['archivos-kpis'] })
      toast.success('Archivo eliminado')
    },
  })

  const navegar = (id: string | null, nombre?: string) => {
    if (id === null) {
      setCarpetaActual(null)
      setBreadcrumb([])
    } else {
      setCarpetaActual(id)
      setBreadcrumb(prev => {
        const idx = prev.findIndex(b => b.id === id)
        if (idx >= 0) return prev.slice(0, idx + 1)
        return [...prev, { id, nombre: nombre || 'Carpeta' }]
      })
    }
    setBuscarQ('')
  }

  const k = kpis || {}

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-in">
      {showSubir && <ModalSubirArchivo carpetaId={carpetaActual} onClose={() => { setShowSubir(false); queryClient.invalidateQueries({ queryKey: ['archivos'] }); queryClient.invalidateQueries({ queryKey: ['archivos-kpis'] }) }} />}
      {verTexto && <ModalTexto archivo={verTexto} onClose={() => setVerTexto(null)} />}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total archivos', value: k.total_archivos ?? '—', icon: '📄' },
          { label: 'Carpetas',       value: k.total_carpetas  ?? '—', icon: '📁' },
          { label: 'Con texto extraído', value: k.con_texto   ?? '—', icon: '✅', color: k.con_texto ? '#166534' : undefined },
          { label: 'Almacenamiento', value: k.total_mb ? `${k.total_mb} MB` : '—', icon: '💾' },
        ].map(kk => (
          <div key={kk.label} className="card p-4">
            <div className="flex items-start justify-between mb-2">
              <div className="text-xs" style={{ color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{kk.label}</div>
              <span style={{ fontSize: '18px', opacity: 0.4 }}>{kk.icon}</span>
            </div>
            <div className="text-2xl font-semibold" style={{ color: (kk as any).color || 'var(--text-primary)' }}>{kk.value}</div>
          </div>
        ))}
      </div>

      {/* Toolbar + navegador */}
      <div>
        {/* Breadcrumb */}
        <div className="flex items-center gap-1 mb-3 flex-wrap">
          <button className="flex items-center gap-1 text-xs hover:opacity-80"
            style={{ color: carpetaActual ? 'var(--brand)' : 'var(--text-primary)' }}
            onClick={() => navegar(null)}>
            <Home size={12} /> Archivos
          </button>
          {breadcrumb.map((b, i) => (
            <span key={b.id} className="flex items-center gap-1">
              <ChevronRight size={11} style={{ color: 'var(--text-tertiary)' }} />
              <button className="text-xs hover:opacity-80"
                style={{ color: i === breadcrumb.length - 1 ? 'var(--text-primary)' : 'var(--brand)' }}
                onClick={() => navegar(b.id, b.nombre)}>
                {b.nombre}
              </button>
            </span>
          ))}
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 mb-4">
          <div className="relative" style={{ width: '200px' }}>
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
            <input className="input pl-8 py-1.5 text-xs w-full" placeholder="Buscar archivos..."
              value={buscarQ} onChange={e => setBuscarQ(e.target.value)} />
          </div>
          <select className="input text-xs py-1.5" style={{ width: '160px' }}
            value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}>
            <option value="">Todos los tipos</option>
            {TIPOS_DOCUMENTO.map(t => <option key={t.valor} value={t.valor}>{t.icon} {t.label}</option>)}
          </select>
          {(buscarQ || filtroTipo) && (
            <button className="text-xs flex items-center gap-1" style={{ color: 'var(--text-tertiary)' }}
              onClick={() => { setBuscarQ(''); setFiltroTipo('') }}>
              <X size={11} /> Limpiar
            </button>
          )}
          <div className="flex-1" />
          {showNuevaCarpeta ? (
            <div className="flex items-center gap-2">
              <input className="input text-xs py-1.5" style={{ width: '160px' }} placeholder="Nombre carpeta..."
                value={nombreCarpeta} onChange={e => setNombreCarpeta(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') crearCarpetaMut.mutate() }} autoFocus />
              <button className="btn-primary text-xs py-1.5 px-3" onClick={() => crearCarpetaMut.mutate()} disabled={!nombreCarpeta}>✓</button>
              <button className="btn text-xs py-1.5 px-3" onClick={() => { setShowNuevaCarpeta(false); setNombreCarpeta('') }}>✕</button>
            </div>
          ) : (
            <button className="btn text-xs py-1.5 px-3 flex items-center gap-1.5" onClick={() => setShowNuevaCarpeta(true)}>
              <Folder size={13} /> Nueva carpeta
            </button>
          )}
          <button className="btn-primary text-xs py-1.5 px-4 flex items-center gap-1.5" onClick={() => setShowSubir(true)}>
            <Upload size={13} /> Subir archivo
          </button>
        </div>

        {/* Contenido */}
        <div className="card overflow-hidden">
          {/* Carpetas */}
          {!buscarQ && carpetas.length > 0 && (
            <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
              <div className="flex flex-wrap gap-2">
                {(carpetas as any[]).map((c: any) => (
                  <div key={c.id} className="group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer hover:opacity-80"
                    style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)' }}
                    onClick={() => navegar(c.id, c.nombre)}>
                    <FolderOpen size={16} style={{ color: '#f59e0b' }} />
                    <div>
                      <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{c.nombre}</div>
                      <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                        {c.subcarpetas > 0 ? `${c.subcarpetas} carpetas · ` : ''}{c.archivos} archivos
                      </div>
                    </div>
                    <button className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ color: '#dc2626' }}
                      onClick={e => { e.stopPropagation(); if (confirm(`¿Eliminar carpeta "${c.nombre}"?`)) eliminarCarpetaMut.mutate(c.id) }}>
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tabla archivos */}
          <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                {['Archivo', 'Tipo', 'Tamaño', 'Estado', 'Vinculado a', 'Fecha', 'Acciones'].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 font-medium uppercase tracking-wider"
                    style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && Array.from({ length: 3 }).map((_, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} className="px-4 py-3"><div className="skeleton h-3 rounded w-3/4" /></td>
                  ))}
                </tr>
              ))}
              {!isLoading && (archivos as any[]).map((a: any) => {
                const estadoCfg = ESTADO_CFG[a.estado_proceso] || ESTADO_CFG.sin_procesar
                const tipo = TIPOS_DOCUMENTO.find(t => t.valor === a.tipo_documento)
                return (
                  <tr key={a.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span style={{ fontSize: '16px' }}>{fileIcon(a.extension || '', a.tipo_documento)}</span>
                        <div className="min-w-0">
                          <div className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)', maxWidth: '200px' }}>{a.nombre}</div>
                          {a.descripcion && <div className="truncate" style={{ fontSize: '10px', color: 'var(--text-tertiary)', maxWidth: '200px' }}>{a.descripcion}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs">{tipo?.icon} {tipo?.label || a.tipo_documento}</span>
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>
                      {formatBytes(a.tamano_bytes)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-0.5 rounded-full"
                        style={{ background: estadoCfg.bg, color: estadoCfg.text, fontSize: '10px' }}>
                        {estadoCfg.label}
                      </span>
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>
                      {a.entidad_tipo ? `${a.entidad_tipo === 'persona' ? '👤' : '🏢'} vinculado` : '—'}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
                      {a.created_at ? new Date(a.created_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {a.texto_extraido && (
                          <button className="btn p-1" title="Ver texto extraído" onClick={() => setVerTexto(a)}>
                            <Eye size={11} />
                          </button>
                        )}
                        <button className="btn p-1" title="Eliminar" style={{ color: '#dc2626' }}
                          onClick={() => { if (confirm(`¿Eliminar "${a.nombre}"?`)) eliminarArchivoMut.mutate(a.id) }}>
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {!isLoading && (archivos as any[]).length === 0 && !carpetas.length && (
                <tr><td colSpan={7} className="px-4 py-12 text-center" style={{ color: 'var(--text-tertiary)' }}>
                  <Upload size={24} style={{ margin: '0 auto 8px', opacity: 0.3 }} />
                  <div>No hay archivos aquí</div>
                  <div style={{ fontSize: '10px', marginTop: '4px' }}>Sube tu primer archivo o crea una carpeta</div>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Distribución por tipo */}
      {k.por_tipo?.length > 0 && (
        <div className="card p-4">
          <div className="text-xs font-semibold mb-3 uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
            📊 Distribución por tipo de documento
          </div>
          <div className="flex flex-wrap gap-2">
            {(k.por_tipo || []).map((t: any) => {
              const tipo = TIPOS_DOCUMENTO.find(td => td.valor === t.tipo_documento)
              return (
                <div key={t.tipo_documento} className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer hover:opacity-80"
                  style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
                  onClick={() => setFiltroTipo(t.tipo_documento)}>
                  <span>{tipo?.icon || '📄'}</span>
                  <span className="text-xs" style={{ color: 'var(--text-primary)' }}>{tipo?.label || t.tipo_documento}</span>
                  <span className="text-xs font-semibold" style={{ color: 'var(--brand)' }}>{t.total}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
