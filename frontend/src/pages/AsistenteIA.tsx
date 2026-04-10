// src/pages/AsistenteIA.tsx
import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Send, Plus, Bot, User, Zap, AlertTriangle, ChevronDown, FileText, Search } from 'lucide-react'
import { api } from '@/services/api'
import toast from 'react-hot-toast'

interface Mensaje {
  id: string
  rol: 'user' | 'assistant'
  contenido: string
  timestamp: Date
  modelo?: string
}

interface Conversacion {
  id: string
  titulo: string
  mensajes: Mensaje[]
  createdAt: Date
}

const CAPACIDADES = [
  { icon: '🔍', titulo: 'Análisis de expediente', desc: 'Analiza el perfil completo de una persona o institución', cmd: 'Analiza el expediente de ' },
  { icon: '📄', titulo: 'Extracción de entidades', desc: 'Extrae personas, empresas y relaciones de un texto', cmd: 'Extrae las entidades del siguiente texto:\n\n' },
  { icon: '🕸️', titulo: 'Análisis de red', desc: 'Interpreta las conexiones y vínculos de una entidad', cmd: 'Analiza la red de vínculos de ' },
  { icon: '⚠️', titulo: 'Evaluación de riesgo', desc: 'Evalúa el nivel de riesgo de una entidad', cmd: 'Evalúa el riesgo de ' },
  { icon: '📋', titulo: 'Generar informe', desc: 'Genera un informe estructurado de una investigación', cmd: 'Genera un informe sobre ' },
]

function genId() { return Math.random().toString(36).slice(2) }

export function AsistenteIA() {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [conversaciones, setConversaciones] = useState<Conversacion[]>([
    { id: genId(), titulo: 'Nueva conversación', mensajes: [], createdAt: new Date() }
  ])
  const [convActiva, setConvActiva] = useState(0)
  const [input, setInput] = useState('')
  const [modeloSeleccionado, setModeloSeleccionado] = useState('')

  const { data: modelosData } = useQuery({
    queryKey: ['ia-modelos'],
    queryFn: () => api.get('/ia/modelos-disponibles').then((r: any) => r.data).catch(() => ({ ollama_disponible: false, modelos: [] })),
    refetchInterval: 30_000,
  })

  const ollamaOk  = modelosData?.ollama_disponible
  const modelos   = modelosData?.modelos || []
  const conv      = conversaciones[convActiva]
  const mensajes  = conv?.mensajes || []

  useEffect(() => {
    if (modelos.length > 0 && !modeloSeleccionado) {
      setModeloSeleccionado(modelos[0].nombre)
    }
  }, [modelos])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [mensajes])

  const chatMut = useMutation({
    mutationFn: (mensaje: string) => api.post('/ia/chat', {
      mensaje,
      contexto: modeloSeleccionado ? `modelo_preferido: ${modeloSeleccionado}` : undefined,
    }).then((r: any) => r.data),
    onSuccess: (data) => {
      setConversaciones(prev => {
        const updated = [...prev]
        updated[convActiva] = {
          ...updated[convActiva],
          mensajes: [...updated[convActiva].mensajes, {
            id: genId(),
            rol: 'assistant',
            contenido: data.respuesta || data.analisis || 'Sin respuesta',
            timestamp: new Date(),
            modelo: data.modelo,
          }]
        }
        return updated
      })
    },
    onError: (e: any) => {
      const detail = e?.response?.data?.detail || 'Error al conectar con el modelo'
      setConversaciones(prev => {
        const updated = [...prev]
        updated[convActiva] = {
          ...updated[convActiva],
          mensajes: [...updated[convActiva].mensajes, {
            id: genId(),
            rol: 'assistant',
            contenido: `⚠️ ${detail}`,
            timestamp: new Date(),
          }]
        }
        return updated
      })
    },
  })

  const enviar = () => {
    const txt = input.trim()
    if (!txt || chatMut.isPending) return

    // Add user message
    setConversaciones(prev => {
      const updated = [...prev]
      const isFirst = updated[convActiva].mensajes.length === 0
      updated[convActiva] = {
        ...updated[convActiva],
        titulo: isFirst ? txt.slice(0, 40) + (txt.length > 40 ? '…' : '') : updated[convActiva].titulo,
        mensajes: [...updated[convActiva].mensajes, {
          id: genId(), rol: 'user', contenido: txt, timestamp: new Date(),
        }]
      }
      return updated
    })
    setInput('')
    chatMut.mutate(txt)
  }

  const nuevaConv = () => {
    setConversaciones(prev => [...prev, { id: genId(), titulo: 'Nueva conversación', mensajes: [], createdAt: new Date() }])
    setConvActiva(conversaciones.length)
  }

  return (
    <div style={{ height: 'calc(100vh - 120px)', display: 'flex', gap: '12px' }}>

      {/* Panel izquierdo — Historial */}
      <div className="card overflow-hidden flex-shrink-0" style={{ width: '220px', display: 'flex', flexDirection: 'column' }}>
        <div className="flex items-center justify-between px-3 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Conversaciones</span>
          <button className="btn p-1" onClick={nuevaConv} title="Nueva conversación">
            <Plus size={13} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {conversaciones.map((c, i) => (
            <button key={c.id} className="w-full text-left px-3 py-2.5 rounded-md mx-1 transition-all hover:opacity-80"
              style={{
                background: i === convActiva ? 'var(--brand-light)' : 'transparent',
                color: i === convActiva ? 'var(--brand-dark)' : 'var(--text-secondary)',
                width: 'calc(100% - 8px)',
              }}
              onClick={() => setConvActiva(i)}>
              <div className="text-xs font-medium truncate">{c.titulo}</div>
              <div className="text-xs" style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>
                {c.mensajes.length} mensajes
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Panel central — Chat */}
      <div className="card overflow-hidden flex-1" style={{ display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
          <Bot size={16} style={{ color: 'var(--brand)' }} />
          <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Asistente SIGINT</span>
          <div className="flex items-center gap-1.5 ml-2">
            <div className="w-2 h-2 rounded-full" style={{ background: ollamaOk ? '#22c55e' : '#ef4444' }} />
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {ollamaOk ? 'Conectado' : 'Sin conexión'}
            </span>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {mensajes.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-4 py-8">
              <Bot size={40} style={{ color: 'var(--text-tertiary)', opacity: 0.3 }} />
              <div className="text-center">
                <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                  {ollamaOk ? '¿En qué puedo ayudarte?' : 'Modelo no disponible'}
                </p>
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  {ollamaOk
                    ? 'Puedes preguntarme sobre entidades, investigaciones o pedir análisis'
                    : 'Configura LM Studio o Ollama para activar el asistente'}
                </p>
              </div>
              {ollamaOk && (
                <div className="grid grid-cols-1 gap-2 w-full max-w-sm">
                  {CAPACIDADES.slice(0, 3).map(cap => (
                    <button key={cap.titulo} className="text-left px-3 py-2 rounded-lg hover:opacity-80 transition-all"
                      style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
                      onClick={() => setInput(cap.cmd)}>
                      <div className="flex items-center gap-2">
                        <span>{cap.icon}</span>
                        <div>
                          <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{cap.titulo}</div>
                          <div className="text-xs" style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>{cap.desc}</div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {mensajes.map(m => (
            <div key={m.id} className={`flex gap-3 ${m.rol === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
              <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: m.rol === 'user' ? 'var(--brand)' : 'var(--bg-secondary)' }}>
                {m.rol === 'user'
                  ? <User size={13} style={{ color: '#fff' }} />
                  : <Bot size={13} style={{ color: 'var(--brand)' }} />}
              </div>
              <div style={{ maxWidth: '75%' }}>
                <div className="px-4 py-3 rounded-2xl text-xs" style={{
                  background: m.rol === 'user' ? 'var(--brand)' : 'var(--bg-secondary)',
                  color: m.rol === 'user' ? '#fff' : 'var(--text-primary)',
                  lineHeight: '1.6',
                  whiteSpace: 'pre-wrap',
                  borderRadius: m.rol === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                }}>
                  {m.contenido}
                </div>
                <div className="flex items-center gap-2 mt-1 px-1">
                  <span style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>
                    {m.timestamp.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {m.modelo && <span style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>· {m.modelo}</span>}
                </div>
              </div>
            </div>
          ))}

          {chatMut.isPending && (
            <div className="flex gap-3">
              <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'var(--bg-secondary)' }}>
                <Bot size={13} style={{ color: 'var(--brand)' }} />
              </div>
              <div className="px-4 py-3 rounded-2xl text-xs" style={{ background: 'var(--bg-secondary)', borderRadius: '18px 18px 18px 4px' }}>
                <div className="flex gap-1">
                  {[0,1,2].map(i => (
                    <div key={i} className="w-1.5 h-1.5 rounded-full"
                      style={{ background: 'var(--text-tertiary)', animation: `bounce 1s ${i * 0.2}s infinite` }} />
                  ))}
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="px-4 py-3" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="flex gap-2">
            <textarea
              className="input flex-1 resize-none text-xs"
              rows={2}
              placeholder={ollamaOk ? 'Escribe tu pregunta o instrucción...' : 'Modelo no disponible — configura LM Studio'}
              value={input}
              disabled={!ollamaOk || chatMut.isPending}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar() } }}
            />
            <button className="btn-primary px-3 flex-shrink-0 self-end"
              disabled={!input.trim() || !ollamaOk || chatMut.isPending}
              onClick={enviar}>
              <Send size={14} />
            </button>
          </div>
          <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>Enter para enviar · Shift+Enter para nueva línea</div>
        </div>
      </div>

      {/* Panel derecho — Configuración */}
      <div className="card overflow-hidden flex-shrink-0" style={{ width: '240px', display: 'flex', flexDirection: 'column' }}>
        <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Configuración</span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-5">

          {/* Estado */}
          <div>
            <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>Estado del modelo</div>
            <div className="flex items-center gap-2 p-2 rounded-lg" style={{ background: ollamaOk ? '#f0fdf4' : '#fef2f2', border: `1px solid ${ollamaOk ? '#bbf7d0' : '#fecaca'}` }}>
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: ollamaOk ? '#22c55e' : '#ef4444' }} />
              <div>
                <div className="text-xs font-medium" style={{ color: ollamaOk ? '#166534' : '#dc2626' }}>
                  {ollamaOk ? 'Ollama conectado' : 'Sin conexión'}
                </div>
                <div style={{ fontSize: '10px', color: ollamaOk ? '#166534' : '#dc2626' }}>
                  {ollamaOk ? `${modelos.length} modelo(s) disponible(s)` : 'Inicia LM Studio o Ollama'}
                </div>
              </div>
            </div>
          </div>

          {/* Selector de modelo */}
          <div>
            <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>Modelo activo</div>
            {modelos.length > 0 ? (
              <select className="input text-xs w-full" value={modeloSeleccionado}
                onChange={e => setModeloSeleccionado(e.target.value)}>
                {modelos.map((m: any) => (
                  <option key={m.nombre} value={m.nombre}>
                    {m.nombre} ({m.tamaño_gb}GB)
                  </option>
                ))}
              </select>
            ) : (
              <div className="text-xs p-2 rounded" style={{ background: 'var(--bg-secondary)', color: 'var(--text-tertiary)' }}>
                Sin modelos detectados
              </div>
            )}
          </div>

          {/* Capacidades */}
          <div>
            <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>Acciones rápidas</div>
            <div className="space-y-1.5">
              {CAPACIDADES.map(cap => (
                <button key={cap.titulo} className="w-full text-left px-3 py-2 rounded-lg hover:opacity-80 transition-all"
                  style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
                  onClick={() => { setInput(cap.cmd); }}>
                  <div className="flex items-center gap-2">
                    <span style={{ fontSize: '14px' }}>{cap.icon}</span>
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{cap.titulo}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Info seguridad */}
          <div className="p-3 rounded-lg" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
            <div className="text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>🔒 Seguridad</div>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)', lineHeight: '1.5' }}>
              Datos clasificados nivel 3+ solo se envían a modelos locales. Nunca a APIs externas.
            </p>
          </div>
        </div>
      </div>

    </div>
  )
}
