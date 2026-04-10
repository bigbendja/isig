// src/pages/PaginasFaltantes.tsx
// Usuarios, OSINT/Ingesta, Archivos con diseño básico funcional
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import toast from 'react-hot-toast'

// ── USUARIOS ──────────────────────────────────────────────────

export function Usuarios() {
  const queryClient = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ username: '', email: '', password: '', nombre_completo: '', rol_id: 2 })

  const { data, isLoading } = useQuery({
    queryKey: ['usuarios'],
    queryFn: () => api.get('/usuarios').then(r => r.data).catch(() => ({ items: [], total: 0 })),
  })

  const { data: roles = [] } = useQuery({
    queryKey: ['roles'],
    queryFn: () => api.get('/usuarios/roles').then(r => r.data).catch(() => []),
  })

  const crearMut = useMutation({
    mutationFn: () => api.post('/usuarios', form).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['usuarios'] })
      toast.success('Usuario creado')
      setShowModal(false)
      setForm({ username: '', email: '', password: '', nombre_completo: '', rol_id: 2 })
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || 'Error al crear usuario'),
  })

  const niveles: Record<number, string> = {
    1: 'Viewer', 2: 'Analista', 3: 'Senior', 4: 'Supervisor', 5: 'Admin'
  }

  return (
    <div className="space-y-4 max-w-5xl mx-auto animate-in">
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="card p-6 w-full max-w-md space-y-4" style={{ background: 'var(--bg-primary)' }}>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Nuevo usuario</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Username *</label>
                <input className="input" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Nombre completo</label>
                <input className="input" value={form.nombre_completo} onChange={e => setForm(f => ({ ...f, nombre_completo: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Email *</label>
              <input className="input" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Contraseña * (mín. 12 caracteres)</label>
              <input className="input" type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Rol</label>
              <select className="input" value={form.rol_id} onChange={e => setForm(f => ({ ...f, rol_id: Number(e.target.value) }))}>
                {roles.map((r: any) => (
                  <option key={r.id} value={r.id}>{r.nombre} (N{r.nivel_acceso})</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2 justify-end">
              <button className="btn text-xs py-1.5 px-4" onClick={() => setShowModal(false)}>Cancelar</button>
              <button className="btn-primary text-xs py-1.5 px-4"
                onClick={() => crearMut.mutate()}
                disabled={!form.username || !form.email || form.password.length < 12 || crearMut.isPending}>
                {crearMut.isPending ? 'Creando...' : 'Crear usuario'}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
            Usuarios del sistema
          </h1>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            {data?.total ?? data?.length ?? 0} usuarios registrados
          </p>
        </div>
        <button className="btn-primary text-xs py-1" onClick={() => setShowModal(true)}>+ Nuevo usuario</button>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
              {['Usuario', 'Email', 'Nombre', 'Nivel', 'Estado', 'Último acceso'].map(h => (
                <th key={h} className="text-left px-4 py-2 font-medium" style={{ color: 'var(--text-secondary)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}>
                {Array.from({ length: 6 }).map((_, j) => (
                  <td key={j} className="px-4 py-3"><div className="skeleton h-3 rounded w-24" /></td>
                ))}
              </tr>
            ))}
            {!isLoading && (data?.items ?? data ?? []).map((u: any) => (
              <tr key={u.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td className="px-4 py-3 font-medium" style={{ color: 'var(--text-primary)' }}>{u.username}</td>
                <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{u.email}</td>
                <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{u.nombre_completo || '—'}</td>
                <td className="px-4 py-3">
                  <span className="badge" style={{ background: 'var(--brand-light)', color: 'var(--brand-dark)' }}>
                    N{u.nivel_acceso} — {niveles[u.nivel_acceso] || ''}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="badge" style={{
                    background: u.activo ? '#dcfce7' : '#fee2e2',
                    color: u.activo ? '#166534' : '#991b1b'
                  }}>
                    {u.activo ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
                <td className="px-4 py-3" style={{ color: 'var(--text-tertiary)' }}>
                  {u.ultimo_login ? new Date(u.ultimo_login).toLocaleDateString('es-ES') : 'Nunca'}
                </td>
              </tr>
            ))}
            {!isLoading && (data?.items ?? data ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center" style={{ color: 'var(--text-tertiary)' }}>
                  No hay usuarios registrados
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── OSINT / INGESTA ───────────────────────────────────────────

export function OSINTIngesta() {
  const [tab, setTab] = useState<'fuentes' | 'alertas' | 'importar'>('fuentes')
  const queryClient = useQueryClient()

  const { data: fuentes, isLoading: loadingFuentes } = useQuery({
    queryKey: ['osint-fuentes'],
    queryFn: () => api.get('/osint/fuentes').then(r => r.data).catch(() => []),
    enabled: tab === 'fuentes',
  })

  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [csvTipo, setCsvTipo] = useState('persona')

  const importarMut = useMutation({
    mutationFn: async () => {
      if (!csvFile) throw new Error('Selecciona un archivo')
      const fd = new FormData()
      fd.append('file', csvFile)
      fd.append('tipo_entidad', csvTipo)
      return api.post('/osint/importar-csv', fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data)
    },
    onSuccess: (data) => {
      toast.success(`Importado: ${data.entidades_creadas ?? 0} creadas, ${data.entidades_enriquecidas ?? 0} enriquecidas`)
      queryClient.invalidateQueries({ queryKey: ['personas'] })
      setCsvFile(null)
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || 'Error al importar'),
  })

  return (
    <div className="space-y-4 max-w-5xl mx-auto animate-in">
      <h1 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>OSINT / Ingesta de datos</h1>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'var(--bg-secondary)', width: 'fit-content' }}>
        {[{ k: 'fuentes', label: 'Fuentes' }, { k: 'importar', label: 'Importar CSV' }].map(t => (
          <button
            key={t.k}
            className="text-xs px-4 py-1.5 rounded-md transition-all"
            style={{
              background: tab === t.k ? 'var(--bg-primary)' : 'transparent',
              color: tab === t.k ? 'var(--text-primary)' : 'var(--text-tertiary)',
              boxShadow: tab === t.k ? 'var(--shadow-sm)' : 'none',
            }}
            onClick={() => setTab(t.k as any)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'fuentes' && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
              Fuentes OSINT configuradas
            </span>
          </div>
          {loadingFuentes ? (
            <div className="p-8 text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>Cargando...</div>
          ) : (fuentes ?? []).length === 0 ? (
            <div className="p-8 text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>
              No hay fuentes OSINT configuradas aún
            </div>
          ) : (
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                  {['Nombre', 'Tipo', 'Estado', 'Última ejecución'].map(h => (
                    <th key={h} className="text-left px-4 py-2 font-medium" style={{ color: 'var(--text-secondary)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(fuentes ?? []).map((f: any) => (
                  <tr key={f.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td className="px-4 py-3 font-medium" style={{ color: 'var(--text-primary)' }}>{f.nombre}</td>
                    <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{f.tipo}</td>
                    <td className="px-4 py-3">
                      <span className="badge" style={{ background: f.activa ? '#dcfce7' : '#fee2e2', color: f.activa ? '#166534' : '#991b1b' }}>
                        {f.activa ? 'Activa' : 'Inactiva'}
                      </span>
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--text-tertiary)' }}>
                      {f.ultima_ejecucion ? new Date(f.ultima_ejecucion).toLocaleDateString('es-ES') : 'Nunca'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'importar' && (
        <div className="card p-6 max-w-lg space-y-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
            Importar desde CSV
          </h2>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Sube un archivo CSV con datos de personas o instituciones para importarlos masivamente al sistema.
          </p>

          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Tipo de entidad</label>
            <select className="input" value={csvTipo} onChange={e => setCsvTipo(e.target.value)}>
              <option value="persona">Personas</option>
              <option value="institucion">Instituciones</option>
            </select>
          </div>

          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Archivo CSV</label>
            <input
              type="file"
              accept=".csv"
              className="input py-1.5"
              onChange={e => setCsvFile(e.target.files?.[0] ?? null)}
            />
          </div>

          {csvFile && (
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Archivo seleccionado: {csvFile.name} ({(csvFile.size / 1024).toFixed(1)} KB)
            </p>
          )}

          <button
            className="btn-primary text-xs py-2 px-4"
            onClick={() => importarMut.mutate()}
            disabled={!csvFile || importarMut.isPending}
          >
            {importarMut.isPending ? 'Importando...' : 'Importar'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── ARCHIVOS ──────────────────────────────────────────────────

export function Archivos() {
  const { data, isLoading } = useQuery({
    queryKey: ['archivos'],
    queryFn: () => api.get('/archivos').then(r => r.data).catch(() => ({ items: [], total: 0 })),
  })

  const tipoIcono: Record<string, string> = {
    pdf: '📄', imagen: '🖼️', documento: '📝', hoja_calculo: '📊', otro: '📎'
  }

  return (
    <div className="space-y-4 max-w-5xl mx-auto animate-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Archivos</h1>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Documentos adjuntos a expedientes
          </p>
        </div>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
              {['Archivo', 'Tipo', 'Entidad', 'Tamaño', 'Subido'].map(h => (
                <th key={h} className="text-left px-4 py-2 font-medium" style={{ color: 'var(--text-secondary)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}>{Array.from({ length: 5 }).map((_, j) => (
                <td key={j} className="px-4 py-3"><div className="skeleton h-3 rounded w-24" /></td>
              ))}</tr>
            ))}
            {!isLoading && (data?.items ?? []).map((f: any) => (
              <tr key={f.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td className="px-4 py-3">
                  <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                    {tipoIcono[f.tipo_archivo] || '📎'} {f.nombre_original}
                  </span>
                </td>
                <td className="px-4 py-3 capitalize" style={{ color: 'var(--text-secondary)' }}>{f.tipo_archivo}</td>
                <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{f.entidad_tipo} — {f.entidad_id?.slice(0,8)}...</td>
                <td className="px-4 py-3" style={{ color: 'var(--text-tertiary)' }}>
                  {f.tamaño_bytes ? `${(f.tamaño_bytes / 1024).toFixed(1)} KB` : '—'}
                </td>
                <td className="px-4 py-3" style={{ color: 'var(--text-tertiary)' }}>
                  {f.created_at ? new Date(f.created_at).toLocaleDateString('es-ES') : '—'}
                </td>
              </tr>
            ))}
            {!isLoading && (data?.items ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center" style={{ color: 'var(--text-tertiary)' }}>
                  No hay archivos subidos aún
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
