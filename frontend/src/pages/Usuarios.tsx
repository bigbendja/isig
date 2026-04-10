// src/pages/Usuarios.tsx
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, X, Plus, Edit2, Lock, UserX, CheckCircle, Shield } from 'lucide-react'
import { api } from '@/services/api'
import toast from 'react-hot-toast'

// ── PERMISOS DEFINICIÓN ───────────────────────────────────────
const PERMISOS_MATRIZ = [
  { key: 'entidades.read',            label: 'Ver personas e instituciones',  grupo: 'Entidades' },
  { key: 'entidades.write',           label: 'Editar personas e instituciones', grupo: 'Entidades' },
  { key: 'entidades.delete',          label: 'Eliminar entidades',            grupo: 'Entidades' },
  { key: 'investigaciones.read',      label: 'Ver investigaciones',           grupo: 'Investigaciones' },
  { key: 'investigaciones.write',     label: 'Crear/editar investigaciones',  grupo: 'Investigaciones' },
  { key: 'investigaciones.close',     label: 'Cerrar investigaciones',        grupo: 'Investigaciones' },
  { key: 'alertas.read',              label: 'Ver alertas',                   grupo: 'Alertas' },
  { key: 'alertas.write',             label: 'Gestionar alertas',             grupo: 'Alertas' },
  { key: 'osint.read',                label: 'Ver fuentes OSINT',             grupo: 'OSINT' },
  { key: 'osint.trigger',             label: 'Ejecutar búsquedas OSINT',      grupo: 'OSINT' },
  { key: 'osint.config',              label: 'Configurar fuentes OSINT',      grupo: 'OSINT' },
  { key: 'archivos.read',             label: 'Ver archivos',                  grupo: 'Archivos' },
  { key: 'archivos.write',            label: 'Subir archivos',                grupo: 'Archivos' },
  { key: 'export',                    label: 'Exportar datos',                grupo: 'Sistema' },
  { key: 'admin',                     label: 'Gestionar usuarios',            grupo: 'Sistema' },
  { key: 'auditoria',                 label: 'Ver auditoría',                 grupo: 'Sistema' },
  { key: 'ia.use',                    label: 'Usar asistente IA',             grupo: 'IA' },
  { key: 'system',                    label: 'Configuración de sistema',      grupo: 'Sistema' },
]

const GRUPOS_PERMISO = [...new Set(PERMISOS_MATRIZ.map(p => p.grupo))]

// Get nested value from permissions object: 'entidades.read' → permisos.entidades.read
function getPermiso(permisos: any, key: string): boolean {
  const parts = key.split('.')
  let current = permisos
  for (const part of parts) {
    if (current === null || current === undefined) return false
    current = current[part]
  }
  return Boolean(current)
}

function setPermiso(permisos: any, key: string, value: boolean): any {
  const parts = key.split('.')
  const result = { ...permisos }
  if (parts.length === 1) {
    result[parts[0]] = value
  } else {
    result[parts[0]] = { ...(result[parts[0]] || {}), [parts[1]]: value }
  }
  return result
}

function NivelBadge({ nivel }: { nivel: number }) {
  const colors = ['', '#6b7280', '#3b82f6', '#f59e0b', '#ef4444', '#7c3aed']
  return (
    <span className="text-xs px-2 py-0.5 rounded-full font-medium"
      style={{ background: `${colors[nivel]}22`, color: colors[nivel], border: `1px solid ${colors[nivel]}44`, fontSize: '10px' }}>
      Nivel {nivel}
    </span>
  )
}

// ── MODAL NUEVO/EDITAR USUARIO ────────────────────────────────
function ModalUsuario({ usuario, roles, onClose }: { usuario?: any; roles: any[]; onClose: () => void }) {
  const queryClient = useQueryClient()
  const esNuevo = !usuario
  const [form, setForm] = useState({
    username:        usuario?.username || '',
    email:           usuario?.email || '',
    nombre_completo: usuario?.nombre_completo || '',
    rol_id:          usuario?.rol_id || roles[0]?.id || '',
    password:        '',
    activo:          usuario?.activo ?? true,
  })
  const [resetPwd, setResetPwd] = useState(false)
  const [nuevaPwd, setNuevaPwd] = useState('')

  const guardarMut = useMutation({
    mutationFn: () => esNuevo
      ? api.post('/usuarios', form).then(r => r.data)
      : api.patch(`/usuarios/${usuario.id}`, {
          nombre_completo: form.nombre_completo,
          email: form.email,
          rol_id: form.rol_id,
          activo: form.activo,
        }).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['usuarios'] })
      queryClient.invalidateQueries({ queryKey: ['usuarios-kpis'] })
      toast.success(esNuevo ? 'Usuario creado' : 'Usuario actualizado')
      onClose()
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail || 'Error'),
  })

  const resetMut = useMutation({
    mutationFn: () => api.post(`/usuarios/${usuario?.id}/reset-password`, { nueva_password: nuevaPwd }).then(r => r.data),
    onSuccess: () => { toast.success('Contraseña actualizada'); setResetPwd(false); setNuevaPwd('') },
    onError: () => toast.error('Error al cambiar contraseña'),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.65)' }}>
      <div className="w-full max-w-md rounded-xl shadow-2xl overflow-hidden" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {esNuevo ? 'Nuevo usuario' : `Editar — ${usuario.nombre_completo}`}
          </h2>
          <button onClick={onClose}><X size={15} style={{ color: 'var(--text-tertiary)' }} /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Nombre completo *</label>
              <input className="input text-xs" value={form.nombre_completo} onChange={e => setForm(f => ({ ...f, nombre_completo: e.target.value }))} />
            </div>
            {esNuevo && (
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Username *</label>
                <input className="input text-xs" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} />
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Email *</label>
            <input className="input text-xs" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          </div>
          {esNuevo && (
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Contraseña *</label>
              <input className="input text-xs" type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Rol *</label>
              <select className="input text-xs" value={form.rol_id} onChange={e => setForm(f => ({ ...f, rol_id: Number(e.target.value) }))}>
                {roles.map(r => <option key={r.id} value={r.id}>{r.nombre} (N{r.nivel_acceso})</option>)}
              </select>
            </div>
            {!esNuevo && (
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <div className="w-8 h-4 rounded-full transition-all relative"
                    style={{ background: form.activo ? 'var(--brand)' : 'var(--bg-tertiary)' }}
                    onClick={() => setForm(f => ({ ...f, activo: !f.activo }))}>
                    <div className="w-3 h-3 bg-white rounded-full absolute top-0.5 transition-all"
                      style={{ left: form.activo ? '17px' : '2px' }} />
                  </div>
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {form.activo ? 'Activo' : 'Inactivo'}
                  </span>
                </label>
              </div>
            )}
          </div>

          {/* Reset password */}
          {!esNuevo && (
            <div className="pt-1" style={{ borderTop: '1px solid var(--border)' }}>
              {resetPwd ? (
                <div className="flex gap-2">
                  <input className="input text-xs flex-1" type="password" placeholder="Nueva contraseña..."
                    value={nuevaPwd} onChange={e => setNuevaPwd(e.target.value)} />
                  <button className="btn-primary text-xs py-1.5 px-3" disabled={nuevaPwd.length < 8 || resetMut.isPending}
                    onClick={() => resetMut.mutate()}>Guardar</button>
                  <button className="btn text-xs py-1.5 px-2" onClick={() => { setResetPwd(false); setNuevaPwd('') }}>✕</button>
                </div>
              ) : (
                <button className="flex items-center gap-1.5 text-xs hover:opacity-80"
                  style={{ color: 'var(--text-secondary)' }} onClick={() => setResetPwd(true)}>
                  <Lock size={11} /> Cambiar contraseña
                </button>
              )}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4" style={{ borderTop: '1px solid var(--border)' }}>
          <button className="btn text-xs py-2 px-4" onClick={onClose}>Cancelar</button>
          <button className="btn-primary text-xs py-2 px-5" disabled={guardarMut.isPending}
            onClick={() => guardarMut.mutate()}>
            {guardarMut.isPending ? 'Guardando...' : esNuevo ? 'Crear usuario' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── PÁGINA PRINCIPAL ──────────────────────────────────────────
export function Usuarios() {
  const queryClient = useQueryClient()
  const [buscarQ, setBuscarQ] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editUsuario, setEditUsuario] = useState<any>(null)
  const [seccion, setSeccion] = useState<'usuarios' | 'roles'>('usuarios')
  const [pendingPermisos, setPendingPermisos] = useState<Record<number, any>>({})

  const { data: kpis } = useQuery({
    queryKey: ['usuarios-kpis'],
    queryFn: () => api.get('/usuarios/kpis').then((r: any) => r.data).catch(() => ({})),
  })

  const { data: usuariosData } = useQuery({
    queryKey: ['usuarios', buscarQ],
    queryFn: () => api.get('/usuarios', { params: { page_size: 50 } }).then((r: any) => r.data).catch(() => ({ items: [] })),
  })

  const { data: roles = [] } = useQuery({
    queryKey: ['roles'],
    queryFn: () => api.get('/usuarios/roles').then((r: any) => r.data).catch(() => []),
  })

  const { data: rolesDetalle = [] } = useQuery({
    queryKey: ['roles-detalle'],
    queryFn: () => api.get('/usuarios/roles/detalle').then((r: any) => r.data).catch(() => []),
  })

  const desactivarMut = useMutation({
    mutationFn: (id: string) => api.delete(`/usuarios/${id}`).then(r => r.data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['usuarios'] }); toast.success('Usuario desactivado') },
    onError: (e: any) => toast.error(e?.response?.data?.detail || 'Error'),
  })

  const actualizarPermisosMut = useMutation({
    mutationFn: ({ rolId, permisos }: { rolId: number; permisos: any }) =>
      api.patch(`/usuarios/roles/${rolId}/permisos`, { permisos }).then(r => r.data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['roles-detalle'] }); toast.success('Permisos guardados') },
    onError: () => toast.error('Error al guardar permisos'),
  })

  const usuarios = (usuariosData?.items || []).filter((u: any) => {
    if (!buscarQ) return true
    const q = buscarQ.toLowerCase()
    return u.nombre_completo?.toLowerCase().includes(q) || u.username?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q)
  })

  const k = kpis || {}

  // Merged roles with pending changes
  const getRolPermisos = (rol: any) => pendingPermisos[rol.id] ?? rol.permisos ?? {}

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-in">
      {(showModal || editUsuario) && (
        <ModalUsuario usuario={editUsuario} roles={roles}
          onClose={() => { setShowModal(false); setEditUsuario(null) }} />
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total usuarios',    value: k.total          ?? '—', icon: '👥' },
          { label: 'Activos',           value: k.activos         ?? '—', icon: '✅', color: k.activos ? '#166534' : undefined },
          { label: 'Administradores',   value: k.admins          ?? '—', icon: '🛡️', color: k.admins ? '#7c3aed' : undefined },
          { label: 'Conectados hoy',    value: k.conectados_hoy  ?? '—', icon: '🟢' },
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

      {/* Tabs */}
      <div style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex gap-1">
          {[
            { key: 'usuarios', label: '👥 Usuarios' },
            { key: 'roles',    label: '🛡️ Roles y permisos' },
          ].map(t => (
            <button key={t.key} className="px-4 py-2 text-xs font-medium transition-all"
              style={{
                borderBottom: seccion === t.key ? '2px solid var(--brand)' : '2px solid transparent',
                color: seccion === t.key ? 'var(--brand)' : 'var(--text-secondary)',
                marginBottom: '-1px',
              }}
              onClick={() => setSeccion(t.key as any)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── SECCIÓN USUARIOS ── */}
      {seccion === 'usuarios' && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <div className="flex-shrink-0">
              <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Usuarios del sistema</h2>
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{usuariosData?.total ?? '…'} registros</p>
            </div>
            <div className="flex-1" />
            <div className="relative" style={{ width: '200px' }}>
              <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
              <input className="input pl-8 py-1.5 text-xs w-full" placeholder="Buscar usuario..."
                value={buscarQ} onChange={e => setBuscarQ(e.target.value)} />
            </div>
            {buscarQ && <button onClick={() => setBuscarQ('')}><X size={13} style={{ color: 'var(--text-tertiary)' }} /></button>}
            <div className="flex-1" />
            <button className="btn-primary text-xs py-1.5 px-4 flex items-center gap-1.5"
              onClick={() => setShowModal(true)}>
              <Plus size={13} /> Nuevo usuario
            </button>
          </div>

          <div className="card overflow-hidden">
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                  {['Usuario', 'Email', 'Rol', 'Nivel', 'Estado', 'Último acceso', 'Acciones'].map(h => (
                    <th key={h} className="text-left px-4 py-2.5 font-medium uppercase tracking-wider"
                      style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {usuarios.map((u: any) => {
                  const iniciales = (u.nombre_completo || u.username || '?').split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
                  return (
                    <tr key={u.id} style={{ borderBottom: '1px solid var(--border)', opacity: u.activo ? 1 : 0.5 }}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold"
                            style={{ background: 'var(--brand-light)', color: 'var(--brand-dark)' }}>
                            {iniciales}
                          </div>
                          <div>
                            <div className="font-medium" style={{ color: 'var(--text-primary)' }}>{u.nombre_completo}</div>
                            <div style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>@{u.username}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{u.email}</td>
                      <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{u.rol_nombre}</td>
                      <td className="px-4 py-3"><NivelBadge nivel={u.nivel_acceso} /></td>
                      <td className="px-4 py-3">
                        {u.bloqueado
                          ? <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: '#fee2e2', color: '#dc2626', fontSize: '10px' }}>Bloqueado</span>
                          : u.activo
                            ? <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: '#dcfce7', color: '#166534', fontSize: '10px' }}>Activo</span>
                            : <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: '#f1f5f9', color: '#475569', fontSize: '10px' }}>Inactivo</span>}
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
                        {u.ultimo_login ? new Date(u.ultimo_login).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Nunca'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button className="btn p-1" title="Editar" onClick={() => setEditUsuario(u)}>
                            <Edit2 size={11} />
                          </button>
                          {u.activo && (
                            <button className="btn p-1" title="Desactivar" style={{ color: '#dc2626' }}
                              onClick={() => { if (confirm(`¿Desactivar a ${u.nombre_completo}?`)) desactivarMut.mutate(u.id) }}>
                              <UserX size={11} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {!usuarios.length && (
                  <tr><td colSpan={7} className="px-4 py-10 text-center" style={{ color: 'var(--text-tertiary)' }}>
                    No se encontraron usuarios
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── SECCIÓN ROLES Y PERMISOS ── */}
      {seccion === 'roles' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Roles y permisos</h2>
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                Marca o desmarca permisos para cada rol. Los cambios se guardan por rol.
              </p>
            </div>
          </div>

          {GRUPOS_PERMISO.map(grupo => (
            <div key={grupo} className="card overflow-hidden">
              <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                  {grupo}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <th className="text-left px-4 py-2.5 font-medium" style={{ color: 'var(--text-tertiary)', fontSize: '10px', minWidth: '200px' }}>
                        Permiso
                      </th>
                      {(rolesDetalle as any[]).map((rol: any) => (
                        <th key={rol.id} className="px-4 py-2.5 text-center" style={{ minWidth: '120px' }}>
                          <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>{rol.nombre}</div>
                          <NivelBadge nivel={rol.nivel_acceso} />
                          <div style={{ color: 'var(--text-tertiary)', fontSize: '10px', marginTop: '2px' }}>
                            {rol.total_usuarios} usuarios
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {PERMISOS_MATRIZ.filter(p => p.grupo === grupo).map(permiso => (
                      <tr key={permiso.key} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td className="px-4 py-2.5" style={{ color: 'var(--text-primary)' }}>
                          {permiso.label}
                        </td>
                        {(rolesDetalle as any[]).map((rol: any) => {
                          const permisos = getRolPermisos(rol)
                          const activo = getPermiso(permisos, permiso.key)
                          const hasPending = pendingPermisos[rol.id] !== undefined
                          return (
                            <td key={rol.id} className="px-4 py-2.5 text-center">
                              <button
                                className="w-5 h-5 rounded flex items-center justify-center mx-auto transition-all hover:opacity-80"
                                style={{
                                  background: activo ? 'var(--brand)' : 'var(--bg-secondary)',
                                  border: `2px solid ${activo ? 'var(--brand)' : 'var(--border)'}`,
                                }}
                                onClick={() => {
                                  const current = getRolPermisos(rol)
                                  const updated = setPermiso(current, permiso.key, !activo)
                                  setPendingPermisos(prev => ({ ...prev, [rol.id]: updated }))
                                }}>
                                {activo && <CheckCircle size={12} style={{ color: '#fff' }} />}
                              </button>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Save buttons per rol with pending changes */}
              {(rolesDetalle as any[]).some((r: any) => pendingPermisos[r.id] !== undefined) && (
                <div className="px-4 py-3 flex items-center gap-2 flex-wrap" style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Cambios pendientes:</span>
                  {(rolesDetalle as any[]).filter((r: any) => pendingPermisos[r.id] !== undefined).map((rol: any) => (
                    <button key={rol.id} className="btn-primary text-xs py-1 px-3"
                      disabled={actualizarPermisosMut.isPending}
                      onClick={() => {
                        actualizarPermisosMut.mutate({ rolId: rol.id, permisos: pendingPermisos[rol.id] }, {
                          onSuccess: () => setPendingPermisos(prev => { const n = { ...prev }; delete n[rol.id]; return n })
                        })
                      }}>
                      Guardar {rol.nombre}
                    </button>
                  ))}
                  <button className="btn text-xs py-1 px-3"
                    onClick={() => setPendingPermisos({})}>
                    Descartar cambios
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
