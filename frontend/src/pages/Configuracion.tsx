// src/pages/Configuracion.tsx
import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Building2, Palette, Mail, Shield, Globe, Brain, Bell, Upload, Save, RefreshCw, CheckCircle } from 'lucide-react'
import { api } from '@/services/api'
import toast from 'react-hot-toast'

const SECCIONES = [
  { key: 'general',        label: 'General / Empresa',    icon: Building2 },
  { key: 'apariencia',     label: 'Apariencia',           icon: Palette },
  { key: 'smtp',           label: 'Correo (SMTP)',        icon: Mail },
  { key: 'seguridad',      label: 'Seguridad',            icon: Shield },
  { key: 'osint',          label: 'OSINT / Pipeline',     icon: Globe },
  { key: 'ia',             label: 'IA / Modelos',         icon: Brain },
  { key: 'notificaciones', label: 'Notificaciones',       icon: Bell },
]

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>{label}</label>
      {children}
      {hint && <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>{hint}</p>}
    </div>
  )
}

function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <div className="w-9 h-5 rounded-full transition-all relative flex-shrink-0"
        style={{ background: value ? 'var(--brand)' : 'var(--bg-tertiary)' }}
        onClick={() => onChange(!value)}>
        <div className="w-4 h-4 bg-white rounded-full absolute top-0.5 shadow transition-all"
          style={{ left: value ? '19px' : '2px' }} />
      </div>
      <span className="text-xs" style={{ color: 'var(--text-primary)' }}>{label}</span>
    </label>
  )
}

// ── SECCIÓN GENERAL ───────────────────────────────────────────
function SeccionGeneral({ data, onChange }: { data: any; onChange: (k: string, v: any) => void }) {
  const logoRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()

  const logoMut = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData(); fd.append('archivo', file)
      return api.post('/configuracion/logo', fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data)
    },
    onSuccess: (d: any) => { onChange('logo_url', d.logo_url); toast.success('Logo actualizado') },
    onError: () => toast.error('Error al subir logo'),
  })

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Nombre del sistema *">
          <input className="input text-xs" value={data.nombre_sistema || ''} onChange={e => onChange('nombre_sistema', e.target.value)} />
        </Field>
        <Field label="Nombre de la organización *">
          <input className="input text-xs" value={data.nombre_organizacion || ''} onChange={e => onChange('nombre_organizacion', e.target.value)} />
        </Field>
      </div>
      <Field label="Descripción">
        <textarea className="input text-xs" rows={2} value={data.descripcion || ''} onChange={e => onChange('descripcion', e.target.value)} />
      </Field>
      <div className="grid grid-cols-3 gap-4">
        <Field label="País (código ISO)">
          <input className="input text-xs" value={data.pais || ''} maxLength={2} onChange={e => onChange('pais', e.target.value.toUpperCase())} placeholder="GQ" />
        </Field>
        <Field label="Sector">
          <input className="input text-xs" value={data.sector || ''} onChange={e => onChange('sector', e.target.value)} />
        </Field>
        <Field label="Web">
          <input className="input text-xs" value={data.web || ''} onChange={e => onChange('web', e.target.value)} placeholder="https://..." />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Email de contacto">
          <input className="input text-xs" type="email" value={data.email_contacto || ''} onChange={e => onChange('email_contacto', e.target.value)} />
        </Field>
        <Field label="Teléfono">
          <input className="input text-xs" value={data.telefono || ''} onChange={e => onChange('telefono', e.target.value)} />
        </Field>
      </div>
      {/* Logo */}
      <div>
        <label className="block text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Logo de la organización</label>
        <div className="flex items-center gap-4">
          <div className="w-20 h-20 rounded-xl flex items-center justify-center overflow-hidden"
            style={{ background: 'var(--bg-secondary)', border: '2px dashed var(--border)' }}>
            {data.logo_url
              ? <img src={data.logo_url} alt="Logo" className="w-full h-full object-contain p-1" />
              : <Building2 size={28} style={{ color: 'var(--text-tertiary)', opacity: 0.4 }} />}
          </div>
          <div>
            <input ref={logoRef} type="file" accept="image/*" className="hidden"
              onChange={e => { if (e.target.files?.[0]) logoMut.mutate(e.target.files[0]) }} />
            <button className="btn text-xs py-2 px-4 flex items-center gap-1.5" onClick={() => logoRef.current?.click()}
              disabled={logoMut.isPending}>
              <Upload size={13} /> {logoMut.isPending ? 'Subiendo...' : 'Subir logo'}
            </button>
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>PNG, SVG o JPG. Máx. 5MB. Fondo transparente recomendado.</p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── SECCIÓN APARIENCIA ────────────────────────────────────────
function SeccionApariencia({ data, onChange }: { data: any; onChange: (k: string, v: any) => void }) {
  const applyPreview = (color: string) => {
    document.documentElement.style.setProperty('--brand', color)
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Color primario" hint="Se aplica en botones, links y elementos activos">
          <div className="flex gap-2">
            <input type="color" className="w-10 h-9 rounded cursor-pointer border-0"
              value={data.color_primario || '#6366f1'}
              onChange={e => { onChange('color_primario', e.target.value); applyPreview(e.target.value) }} />
            <input className="input text-xs flex-1 font-mono" value={data.color_primario || '#6366f1'}
              onChange={e => { onChange('color_primario', e.target.value); applyPreview(e.target.value) }} />
          </div>
        </Field>
        <Field label="Color de acento" hint="Para elementos secundarios y highlights">
          <div className="flex gap-2">
            <input type="color" className="w-10 h-9 rounded cursor-pointer border-0"
              value={data.color_acento || '#8b5cf6'}
              onChange={e => onChange('color_acento', e.target.value)} />
            <input className="input text-xs flex-1 font-mono" value={data.color_acento || '#8b5cf6'}
              onChange={e => onChange('color_acento', e.target.value)} />
          </div>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Nombre en sidebar">
          <input className="input text-xs" value={data.nombre_en_sidebar || ''} onChange={e => onChange('nombre_en_sidebar', e.target.value)} placeholder="SIGINT Pro" />
        </Field>
        <Field label="Modo por defecto">
          <select className="input text-xs" value={data.modo_default || 'dark'} onChange={e => onChange('modo_default', e.target.value)}>
            <option value="dark">Oscuro</option>
            <option value="light">Claro</option>
          </select>
        </Field>
      </div>
      {/* Preview */}
      <div className="p-4 rounded-xl" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
        <div className="text-xs font-semibold mb-3" style={{ color: 'var(--text-secondary)' }}>Vista previa</div>
        <div className="flex gap-2 flex-wrap">
          <button className="btn-primary text-xs py-1.5 px-4">Botón primario</button>
          <span className="text-xs px-2 py-1 rounded" style={{ background: `${data.color_primario || '#6366f1'}22`, color: data.color_primario || '#6366f1' }}>Badge</span>
          <span className="text-xs hover:underline cursor-pointer" style={{ color: data.color_primario || '#6366f1' }}>Enlace activo</span>
          <div className="h-2 rounded-full flex-1" style={{ background: 'var(--bg-tertiary)', minWidth: '100px' }}>
            <div className="h-full rounded-full w-3/5" style={{ background: data.color_primario || '#6366f1' }} />
          </div>
        </div>
      </div>
    </div>
  )
}

// ── SECCIÓN SMTP ──────────────────────────────────────────────
function SeccionSMTP({ data, onChange }: { data: any; onChange: (k: string, v: any) => void }) {
  const testMut = useMutation({
    mutationFn: () => api.post('/configuracion/smtp/test').then(r => r.data),
    onSuccess: (d: any) => toast.success(d.mensaje || 'Email de prueba enviado'),
    onError: (e: any) => toast.error(e?.response?.data?.detail || 'Error al enviar'),
  })

  return (
    <div className="space-y-4">
      <Toggle value={data.activo || false} onChange={v => onChange('activo', v)} label="Activar envío de emails" />
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <Field label="Host SMTP">
            <input className="input text-xs" value={data.host || ''} onChange={e => onChange('host', e.target.value)} placeholder="smtp.gmail.com" />
          </Field>
        </div>
        <Field label="Puerto">
          <input className="input text-xs" type="number" value={data.puerto || 587} onChange={e => onChange('puerto', Number(e.target.value))} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Usuario">
          <input className="input text-xs" value={data.usuario || ''} onChange={e => onChange('usuario', e.target.value)} />
        </Field>
        <Field label="Contraseña">
          <input className="input text-xs" type="password" value={data.password || ''} onChange={e => onChange('password', e.target.value)} placeholder="••••••••" />
        </Field>
      </div>
      <Toggle value={data.tls || false} onChange={v => onChange('tls', v)} label="Usar STARTTLS" />
      <div className="grid grid-cols-2 gap-4">
        <Field label="Email remitente">
          <input className="input text-xs" type="email" value={data.email_remitente || ''} onChange={e => onChange('email_remitente', e.target.value)} />
        </Field>
        <Field label="Nombre remitente">
          <input className="input text-xs" value={data.nombre_remitente || ''} onChange={e => onChange('nombre_remitente', e.target.value)} />
        </Field>
      </div>
      <button className="btn text-xs py-2 px-4 flex items-center gap-1.5"
        onClick={() => testMut.mutate()} disabled={testMut.isPending || !data.activo}>
        <Mail size={13} /> {testMut.isPending ? 'Enviando...' : 'Enviar email de prueba'}
      </button>
    </div>
  )
}

// ── SECCIÓN SEGURIDAD ─────────────────────────────────────────
function SeccionSeguridad({ data, onChange }: { data: any; onChange: (k: string, v: any) => void }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Timeout de sesión (minutos)" hint="0 = sin expiración">
          <input className="input text-xs" type="number" value={data.timeout_sesion_minutos || 480}
            onChange={e => onChange('timeout_sesion_minutos', Number(e.target.value))} min="0" />
        </Field>
        <Field label="Intentos de login antes de bloqueo">
          <input className="input text-xs" type="number" value={data.max_intentos_login || 5}
            onChange={e => onChange('max_intentos_login', Number(e.target.value))} min="1" max="20" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Requerir 2FA para nivel ≥" hint="1 = todos, 5 = solo admins">
          <select className="input text-xs" value={data.requerir_2fa_nivel || 4} onChange={e => onChange('requerir_2fa_nivel', Number(e.target.value))}>
            {[1,2,3,4,5].map(n => <option key={n} value={n}>Nivel {n}+</option>)}
          </select>
        </Field>
        <Field label="Longitud mínima de contraseña">
          <input className="input text-xs" type="number" value={data.password_longitud_minima || 8}
            onChange={e => onChange('password_longitud_minima', Number(e.target.value))} min="6" max="32" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Caducidad de contraseña (días)" hint="0 = sin caducidad">
          <input className="input text-xs" type="number" value={data.password_caducidad_dias || 0}
            onChange={e => onChange('password_caducidad_dias', Number(e.target.value))} min="0" />
        </Field>
      </div>
      <Toggle value={data.bloqueo_ip_automatico || false} onChange={v => onChange('bloqueo_ip_automatico', v)} label="Bloquear IP automáticamente tras intentos fallidos" />
    </div>
  )
}

// ── SECCIÓN OSINT ─────────────────────────────────────────────
function SeccionOSINT({ data, onChange }: { data: any; onChange: (k: string, v: any) => void }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Nivel máx. para APIs externas" hint="Datos con nivel superior solo se procesan localmente">
          <select className="input text-xs" value={data.nivel_max_api_externa || 2} onChange={e => onChange('nivel_max_api_externa', Number(e.target.value))}>
            {[1,2,3,4,5].map(n => <option key={n} value={n}>Nivel {n}</option>)}
          </select>
        </Field>
        <Field label="Timeout de crawlers (segundos)">
          <input className="input text-xs" type="number" value={data.timeout_crawler_segundos || 20}
            onChange={e => onChange('timeout_crawler_segundos', Number(e.target.value))} min="5" max="120" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Máx. resultados por búsqueda">
          <input className="input text-xs" type="number" value={data.max_resultados_busqueda || 50}
            onChange={e => onChange('max_resultados_busqueda', Number(e.target.value))} min="5" max="200" />
        </Field>
        <Field label="User-Agent del crawler">
          <input className="input text-xs" value={data.user_agent || ''} onChange={e => onChange('user_agent', e.target.value)} />
        </Field>
      </div>
      <Toggle value={data.respetar_robots_txt || true} onChange={v => onChange('respetar_robots_txt', v)} label="Respetar robots.txt en web scraping" />
    </div>
  )
}

// ── SECCIÓN IA ────────────────────────────────────────────────
function SeccionIA({ data, onChange }: { data: any; onChange: (k: string, v: any) => void }) {
  return (
    <div className="space-y-4">
      <Field label="URL de Ollama / LM Studio" hint="Para Windows con LM Studio usar host.docker.internal:1234">
        <input className="input text-xs" value={data.ollama_url || ''} onChange={e => onChange('ollama_url', e.target.value)} placeholder="http://host.docker.internal:1234" />
      </Field>
      <div className="grid grid-cols-3 gap-4">
        <Field label="Modelo por defecto">
          <input className="input text-xs" value={data.modelo_default || ''} onChange={e => onChange('modelo_default', e.target.value)} placeholder="qwen2.5:7b" />
        </Field>
        <Field label="Modelo de análisis">
          <input className="input text-xs" value={data.modelo_analisis || ''} onChange={e => onChange('modelo_analisis', e.target.value)} placeholder="qwen2.5:14b" />
        </Field>
        <Field label="Modelo rápido (NER)">
          <input className="input text-xs" value={data.modelo_rapido || ''} onChange={e => onChange('modelo_rapido', e.target.value)} placeholder="mistral:7b" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Temperatura (0-1)" hint="Más bajo = más determinista">
          <input className="input text-xs" type="number" step="0.1" min="0" max="1"
            value={data.temperatura || 0.3} onChange={e => onChange('temperatura', parseFloat(e.target.value))} />
        </Field>
        <Field label="Max tokens por respuesta">
          <input className="input text-xs" type="number" value={data.max_tokens || 2048}
            onChange={e => onChange('max_tokens', Number(e.target.value))} min="256" max="8192" />
        </Field>
      </div>
      <div className="p-3 rounded-lg" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
        <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>APIs externas (opcional)</div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="OpenAI API Key">
            <input className="input text-xs" type="password" value={data.openai_api_key || ''} onChange={e => onChange('openai_api_key', e.target.value)} placeholder="sk-..." />
          </Field>
          <Field label="Anthropic API Key">
            <input className="input text-xs" type="password" value={data.anthropic_api_key || ''} onChange={e => onChange('anthropic_api_key', e.target.value)} placeholder="sk-ant-..." />
          </Field>
        </div>
        <div className="mt-2">
          <Field label="Nivel máx. de datos para IA externa" hint="Datos con nivel superior solo van a modelos locales">
            <select className="input text-xs" value={data.nivel_max_api_externa || 2} onChange={e => onChange('nivel_max_api_externa', Number(e.target.value))}>
              {[1,2,3,4,5].map(n => <option key={n} value={n}>Nivel {n}</option>)}
            </select>
          </Field>
        </div>
      </div>
    </div>
  )
}

// ── SECCIÓN NOTIFICACIONES ────────────────────────────────────
function SeccionNotificaciones({ data, onChange }: { data: any; onChange: (k: string, v: any) => void }) {
  return (
    <div className="space-y-4">
      <Toggle value={data.alertas_criticas_email || false} onChange={v => onChange('alertas_criticas_email', v)} label="Enviar email inmediato para alertas críticas" />
      <Toggle value={data.resumen_diario || false} onChange={v => onChange('resumen_diario', v)} label="Enviar resumen diario de actividad" />
      {data.resumen_diario && (
        <Field label="Hora del resumen diario">
          <input className="input text-xs" type="time" value={data.resumen_hora || '08:00'} onChange={e => onChange('resumen_hora', e.target.value)} style={{ width: '120px' }} />
        </Field>
      )}
      <Field label="Email destino para notificaciones">
        <input className="input text-xs" type="email" value={data.email_destino_alertas || ''}
          onChange={e => onChange('email_destino_alertas', e.target.value)} placeholder="seguridad@empresa.com" />
      </Field>
      <Field label="Umbral score de riesgo para alerta automática" hint={`Entidades que superen ${Math.round((data.umbral_score_alerta || 0.75) * 100)}% generarán alertas automáticas`}>
        <div className="flex items-center gap-3">
          <input type="range" min="0" max="1" step="0.05"
            value={data.umbral_score_alerta || 0.75}
            onChange={e => onChange('umbral_score_alerta', parseFloat(e.target.value))}
            style={{ flex: 1 }} />
          <span className="text-xs font-semibold w-10 text-right" style={{ color: 'var(--brand)' }}>
            {Math.round((data.umbral_score_alerta || 0.75) * 100)}%
          </span>
        </div>
      </Field>
    </div>
  )
}

// ── PÁGINA PRINCIPAL ──────────────────────────────────────────
export function Configuracion() {
  const queryClient = useQueryClient()
  const [seccionActiva, setSeccionActiva] = useState('general')
  const [localData, setLocalData] = useState<Record<string, any>>({})
  const [dirty, setDirty] = useState<Set<string>>(new Set())

  const { data: configData, isLoading } = useQuery({
    queryKey: ['configuracion'],
    queryFn: () => api.get('/configuracion').then((r: any) => r.data).catch(() => ({})),
  })

  // Sync remote data to local
  useEffect(() => {
    if (configData) setLocalData(configData)
  }, [configData])

  const guardarMut = useMutation({
    mutationFn: (seccion: string) =>
      api.patch(`/configuracion/${seccion}`, localData[seccion] || {}).then(r => r.data),
    onSuccess: (_, seccion) => {
      queryClient.invalidateQueries({ queryKey: ['configuracion'] })
      queryClient.invalidateQueries({ queryKey: ['config-publica'] })
      setDirty(prev => { const n = new Set(prev); n.delete(seccion); return n })
      toast.success('Configuración guardada')
    },
    onError: () => toast.error('Error al guardar'),
  })

  const handleChange = (campo: string, valor: any) => {
    setLocalData(prev => ({
      ...prev,
      [seccionActiva]: { ...(prev[seccionActiva] || {}), [campo]: valor }
    }))
    setDirty(prev => new Set(prev).add(seccionActiva))
  }

  const seccData = localData[seccionActiva] || {}
  const isDirty = dirty.has(seccionActiva)

  const SECCIONES_CONTENT: Record<string, React.ReactNode> = {
    general:        <SeccionGeneral data={seccData} onChange={handleChange} />,
    apariencia:     <SeccionApariencia data={seccData} onChange={handleChange} />,
    smtp:           <SeccionSMTP data={seccData} onChange={handleChange} />,
    seguridad:      <SeccionSeguridad data={seccData} onChange={handleChange} />,
    osint:          <SeccionOSINT data={seccData} onChange={handleChange} />,
    ia:             <SeccionIA data={seccData} onChange={handleChange} />,
    notificaciones: <SeccionNotificaciones data={seccData} onChange={handleChange} />,
  }

  return (
    <div className="max-w-6xl mx-auto animate-in" style={{ display: 'flex', gap: '24px', alignItems: 'flex-start' }}>

      {/* Menú lateral */}
      <div className="card overflow-hidden flex-shrink-0" style={{ width: '220px' }}>
        <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
            Configuración
          </span>
        </div>
        <nav className="py-2">
          {SECCIONES.map(s => {
            const Icon = s.icon
            const hasDirty = dirty.has(s.key)
            return (
              <button key={s.key}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left transition-all hover:opacity-80"
                style={{
                  background: seccionActiva === s.key ? 'var(--brand-light)' : 'transparent',
                  color: seccionActiva === s.key ? 'var(--brand-dark)' : 'var(--text-secondary)',
                }}
                onClick={() => setSeccionActiva(s.key)}>
                <Icon size={14} style={{ flexShrink: 0 }} />
                <span className="text-xs flex-1">{s.label}</span>
                {hasDirty && <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#f59e0b' }} />}
              </button>
            )
          })}
        </nav>
      </div>

      {/* Contenido */}
      <div className="flex-1 min-w-0">
        <div className="card overflow-hidden">
          {/* Header sección */}
          <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
            <div className="flex items-center gap-2">
              {(() => { const s = SECCIONES.find(s => s.key === seccionActiva); const Icon = s?.icon || Building2; return <Icon size={16} style={{ color: 'var(--brand)' }} /> })()}
              <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                {SECCIONES.find(s => s.key === seccionActiva)?.label}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              {isDirty && (
                <span className="text-xs flex items-center gap-1" style={{ color: '#f59e0b' }}>
                  ● Cambios sin guardar
                </span>
              )}
              <button className="btn text-xs py-1.5 px-3 flex items-center gap-1.5"
                onClick={() => setLocalData(prev => ({ ...prev, [seccionActiva]: configData?.[seccionActiva] || {} }))
                }>
                <RefreshCw size={12} /> Resetear
              </button>
              <button className="btn-primary text-xs py-1.5 px-4 flex items-center gap-1.5"
                disabled={guardarMut.isPending || !isDirty}
                onClick={() => guardarMut.mutate(seccionActiva)}>
                {guardarMut.isPending ? <><RefreshCw size={12} className="animate-spin" /> Guardando...</> : <><Save size={12} /> Guardar</>}
              </button>
            </div>
          </div>

          {/* Form content */}
          <div className="px-6 py-5">
            {isLoading
              ? <div className="text-xs text-center py-8" style={{ color: 'var(--text-tertiary)' }}>Cargando...</div>
              : SECCIONES_CONTENT[seccionActiva]
            }
          </div>
        </div>
      </div>
    </div>
  )
}
