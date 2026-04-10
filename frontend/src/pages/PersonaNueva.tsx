// src/pages/PersonaNueva.tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { personasService } from '@/services/api'
import toast from 'react-hot-toast'
import { SectorSelector } from '@/components/SectorSelector'

export function PersonaNueva() {
  const navigate   = useNavigate()
  const queryClient = useQueryClient()

  const [sectores, setSectores] = useState<string[]>([])
  const [form, setForm] = useState({
    nombre_completo:    '',
    nombres:            '',
    apellidos:          '',
    genero:             '',
    nacionalidad:       '',
    pais_residencia:    '',
    ciudad_residencia:  '',
    email_principal:    '',
    telefono_principal: '',
    cargo_actual:       '',
    sector_principal:   '',
    es_pep:             false,
    nivel_pep:          undefined as number | undefined,
    nivel_acceso_requerido: 1,
    fuente_primaria:    'Manual',
  })

  const mutation = useMutation({
    mutationFn: (data: typeof form) => personasService.crear(data),
    onSuccess: (persona: any) => {
      queryClient.invalidateQueries({ queryKey: ['personas'] })
      toast.success('Persona creada correctamente')
      navigate(`/personas/${persona.id}`)
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || 'Error al crear la persona'
      toast.error(typeof msg === 'string' ? msg : JSON.stringify(msg))
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.nombre_completo.trim()) {
      toast.error('El nombre completo es obligatorio')
      return
    }
    // Clean payload: remove empty strings and undefined values
    const payload: any = {}
    for (const [key, value] of Object.entries(form)) {
      if (value === '' || value === undefined) continue
      payload[key] = value
    }
    // nivel_pep only if es_pep is true and has value
    if (!payload.es_pep || !payload.nivel_pep) delete payload.nivel_pep
    mutation.mutate(payload)
  }

  const set = (field: string, value: any) =>
    setForm(f => ({ ...f, [field]: value }))

  return (
    <div className="max-w-2xl mx-auto animate-in space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          className="btn text-xs py-1"
          onClick={() => navigate('/personas')}
        >
          ← Volver
        </button>
        <div>
          <h1 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
            Nueva persona
          </h1>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Los campos marcados con * son obligatorios
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
            <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
              Nombre completo *
            </label>
            <input
              className="input"
              value={form.nombre_completo}
              onChange={e => set('nombre_completo', e.target.value)}
              placeholder="Ej: Juan García López"
              required
            />
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
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Nacionalidad (código ISO)</label>
              <input className="input" value={form.nacionalidad} onChange={e => set('nacionalidad', e.target.value.toUpperCase().slice(0,2))} placeholder="GQ, ES, FR..." maxLength={2} />
            </div>
          </div>
        </div>

        {/* Contacto y ubicación */}
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
              <input className="input" value={form.telefono_principal} onChange={e => set('telefono_principal', e.target.value)} placeholder="+240..." />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>País de residencia (ISO)</label>
              <input className="input" value={form.pais_residencia} onChange={e => set('pais_residencia', e.target.value.toUpperCase().slice(0,2))} placeholder="GQ, ES..." maxLength={2} />
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Ciudad</label>
              <input className="input" value={form.ciudad_residencia} onChange={e => set('ciudad_residencia', e.target.value)} placeholder="Malabo..." />
            </div>
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
              <input className="input" value={form.cargo_actual} onChange={e => set('cargo_actual', e.target.value)} placeholder="Director, Ministro..." />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>Sector principal (hasta 3)</label>
              <SectorSelector value={sectores} onChange={setSectores} max={3} />            </div>
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.es_pep}
                onChange={e => set('es_pep', e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-xs" style={{ color: 'var(--text-primary)' }}>
                Es Persona Políticamente Expuesta (PEP)
              </span>
            </label>

            {form.es_pep && (
              <select
                className="input w-32"
                value={form.nivel_pep ?? ''}
                onChange={e => set('nivel_pep', e.target.value ? Number(e.target.value) : undefined)}
              >
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
            Clasificación
          </h2>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Nivel de acceso requerido</label>
              <select
                className="input"
                value={form.nivel_acceso_requerido}
                onChange={e => set('nivel_acceso_requerido', Number(e.target.value))}
              >
                <option value={1}>1 — Público interno</option>
                <option value={2}>2 — Restringido</option>
                <option value={3}>3 — Confidencial</option>
                <option value={4}>4 — Secreto</option>
                <option value={5}>5 — Alto secreto</option>
              </select>
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Fuente primaria</label>
              <input className="input" value={form.fuente_primaria} onChange={e => set('fuente_primaria', e.target.value)} placeholder="Manual, OSINT, Registro..." />
            </div>
          </div>
        </div>

        {/* Acciones */}
        <div className="flex items-center justify-end gap-3 pb-8">
          <button
            type="button"
            className="btn text-xs py-2 px-4"
            onClick={() => navigate('/personas')}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="btn-primary text-xs py-2 px-6"
            disabled={mutation.isPending}
          >
            {mutation.isPending ? 'Creando...' : 'Crear persona'}
          </button>
        </div>

      </form>
    </div>
  )
}
