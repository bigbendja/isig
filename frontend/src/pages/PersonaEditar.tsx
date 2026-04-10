// src/pages/PersonaEditar.tsx
import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { personasService } from '@/services/api'
import toast from 'react-hot-toast'
import { SectorSelector } from '@/components/SectorSelector'

export function PersonaEditar() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: persona, isLoading } = useQuery({
    queryKey: ['persona', id],
    queryFn: () => personasService.obtener(id!),
    enabled: !!id,
  })

  const [form, setForm] = useState<any>({})
  const [sectores, setSectores] = useState<string[]>([])

  useEffect(() => {
    if (persona) {
      setForm({
        nombre_completo:    persona.nombre_completo || '',
        nombres:            persona.nombres || '',
        apellidos:          persona.apellidos || '',
        genero:             persona.genero || '',
        nacionalidad:       persona.nacionalidad || '',
        estado_civil:       persona.estado_civil || '',
        email_principal:    persona.email_principal || '',
        telefono_principal: persona.telefono_principal || '',
        pais_residencia:    persona.pais_residencia || '',
        ciudad_residencia:  persona.ciudad_residencia || '',
        direccion_principal: persona.direccion_principal || '',
        cargo_actual:       persona.cargo_actual || '',
        sector_principal:   persona.sector_principal || '',
        es_pep:             persona.es_pep || false,
        nivel_pep:          persona.nivel_pep || '',
        en_lista_vigilancia: persona.en_lista_vigilancia || false,
        nivel_prioridad:    persona.nivel_prioridad || 1,
        nivel_acceso_requerido: persona.nivel_acceso_requerido || 1,
        fuente_primaria:    persona.fuente_primaria || '',
      })
      setSectores(persona.sector_principal ? persona.sector_principal.split(', ').filter(Boolean) : [])
    }
  }, [persona])

  const mutation = useMutation({
    mutationFn: (data: any) => personasService.actualizar(id!, { ...data, sector_principal: sectores.join(', ') }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['persona', id] })
      queryClient.invalidateQueries({ queryKey: ['personas'] })
      toast.success('Persona actualizada correctamente')
      navigate(`/personas/${id}`)
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || 'Error al actualizar'
      toast.error(typeof msg === 'string' ? msg : JSON.stringify(msg))
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // Clean empty strings
    const payload: any = {}
    for (const [key, value] of Object.entries(form)) {
      if (value === '' || value === undefined) continue
      payload[key] = value
    }
    if (!payload.nivel_pep) delete payload.nivel_pep
    mutation.mutate(payload)
  }

  const set = (field: string, value: any) => setForm((f: any) => ({ ...f, [field]: value }))

  if (isLoading) return (
    <div className="max-w-2xl mx-auto space-y-4 animate-in">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="skeleton h-12 rounded-xl" />
      ))}
    </div>
  )

  if (!persona) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <p style={{ color: 'var(--text-secondary)' }}>Persona no encontrada</p>
      <button className="btn" onClick={() => navigate('/personas')}>← Volver</button>
    </div>
  )

  return (
    <div className="max-w-2xl mx-auto animate-in space-y-4">
      <div className="flex items-center gap-3">
        <button className="btn text-xs py-1" onClick={() => navigate(`/personas/${id}`)}>
          ← Cancelar
        </button>
        <div>
          <h1 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
            Editar — {persona.nombre_completo}
          </h1>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Los cambios se guardan al pulsar "Guardar cambios"
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">

        {/* Identificación */}
        <div className="card p-4 space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
            Identificación
          </h2>
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Nombre completo *</label>
            <input className="input" value={form.nombre_completo} onChange={e => set('nombre_completo', e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Nombres</label>
              <input className="input" value={form.nombres} onChange={e => set('nombres', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Apellidos</label>
              <input className="input" value={form.apellidos} onChange={e => set('apellidos', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Género</label>
              <select className="input" value={form.genero} onChange={e => set('genero', e.target.value)}>
                <option value="">— Sin especificar —</option>
                <option value="M">Masculino</option>
                <option value="F">Femenino</option>
                <option value="O">Otro</option>
              </select>
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Nacionalidad (ISO)</label>
              <input className="input" value={form.nacionalidad} onChange={e => set('nacionalidad', e.target.value.toUpperCase().slice(0,2))} maxLength={2} placeholder="GQ, ES..." />
            </div>
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Estado civil</label>
            <select className="input" value={form.estado_civil} onChange={e => set('estado_civil', e.target.value)}>
              <option value="">— Sin especificar —</option>
              <option value="soltero">Soltero/a</option>
              <option value="casado">Casado/a</option>
              <option value="divorciado">Divorciado/a</option>
              <option value="viudo">Viudo/a</option>
              <option value="union_libre">Unión libre</option>
            </select>
          </div>
        </div>

        {/* Contacto */}
        <div className="card p-4 space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
            Contacto y ubicación
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Email</label>
              <input className="input" type="email" value={form.email_principal} onChange={e => set('email_principal', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Teléfono</label>
              <input className="input" value={form.telefono_principal} onChange={e => set('telefono_principal', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>País residencia (ISO)</label>
              <input className="input" value={form.pais_residencia} onChange={e => set('pais_residencia', e.target.value.toUpperCase().slice(0,2))} maxLength={2} placeholder="GQ, ES..." />
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Ciudad</label>
              <input className="input" value={form.ciudad_residencia} onChange={e => set('ciudad_residencia', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Dirección</label>
            <input className="input" value={form.direccion_principal} onChange={e => set('direccion_principal', e.target.value)} />
          </div>
        </div>

        {/* Laboral */}
        <div className="card p-4 space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
            Información laboral
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Cargo actual</label>
              <input className="input" value={form.cargo_actual} onChange={e => set('cargo_actual', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>Sector principal (hasta 3)</label>
              <SectorSelector value={sectores} onChange={setSectores} max={3} />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.es_pep} onChange={e => set('es_pep', e.target.checked)} className="w-4 h-4" />
              <span className="text-xs" style={{ color: 'var(--text-primary)' }}>Es PEP (Persona Políticamente Expuesta)</span>
            </label>
            {form.es_pep && (
              <select className="input w-32" value={form.nivel_pep} onChange={e => set('nivel_pep', e.target.value ? Number(e.target.value) : '')}>
                <option value="">Nivel PEP</option>
                <option value="1">Nivel 1 — Alto</option>
                <option value="2">Nivel 2 — Medio</option>
                <option value="3">Nivel 3 — Bajo</option>
              </select>
            )}
          </div>
        </div>

        {/* Clasificación */}
        <div className="card p-4 space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
            Clasificación y riesgo
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Prioridad</label>
              <select className="input" value={form.nivel_prioridad} onChange={e => set('nivel_prioridad', Number(e.target.value))}>
                {[1,2,3,4,5].map(n => <option key={n} value={n}>{n} — {['Mínima','Baja','Media','Alta','Crítica'][n-1]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Nivel de acceso requerido</label>
              <select className="input" value={form.nivel_acceso_requerido} onChange={e => set('nivel_acceso_requerido', Number(e.target.value))}>
                <option value={1}>1 — Público interno</option>
                <option value={2}>2 — Restringido</option>
                <option value={3}>3 — Confidencial</option>
                <option value={4}>4 — Secreto</option>
                <option value={5}>5 — Alto secreto</option>
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.en_lista_vigilancia} onChange={e => set('en_lista_vigilancia', e.target.checked)} className="w-4 h-4" />
            <span className="text-xs" style={{ color: 'var(--text-primary)' }}>En lista de vigilancia interna</span>
          </label>
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Fuente primaria</label>
            <input className="input" value={form.fuente_primaria} onChange={e => set('fuente_primaria', e.target.value)} />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pb-8">
          <button type="button" className="btn text-xs py-2 px-4" onClick={() => navigate(`/personas/${id}`)}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary text-xs py-2 px-6" disabled={mutation.isPending}>
            {mutation.isPending ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </div>
  )
}
