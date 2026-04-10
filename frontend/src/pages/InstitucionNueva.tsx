// src/pages/InstitucionNueva.tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { institucionesService } from '@/services/api'
import toast from 'react-hot-toast'
import { SectorSelector } from '@/components/SectorSelector'

export function InstitucionNueva() {
  const navigate    = useNavigate()
  const queryClient = useQueryClient()

  const [sectores, setSectores] = useState<string[]>([])
  const [form, setForm] = useState({
    nombre:             '',
    nombre_corto:       '',
    tipo_entidad:       '',
    sector:             '',
    pais_registro:      '',
    sede_ciudad:        '',
    estado_legal:       'activa',
    web_principal:      '',
    email_contacto:     '',
    telefono_central:   '',
    nivel_acceso_requerido: 1,
    fuente_primaria:    'Manual',
    actividad_desc:     '',
  })

  const mutation = useMutation({
    mutationFn: (data: typeof form) => institucionesService.crear(data),
    onSuccess: (inst: any) => {
      queryClient.invalidateQueries({ queryKey: ['instituciones'] })
      toast.success('Institución creada correctamente')
      navigate(`/instituciones/${inst.id}`)
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || 'Error al crear la institución'
      toast.error(typeof msg === 'string' ? msg : JSON.stringify(msg))
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.nombre.trim()) {
      toast.error('El nombre es obligatorio')
      return
    }
    // Clean payload: remove empty strings and undefined values
    const payload: any = {}
    for (const [key, value] of Object.entries(form)) {
      if (value === '' || value === undefined) continue
      payload[key] = value
    }
    payload.sector = sectores.join(', ')
    mutation.mutate(payload)
  }

  const set = (field: string, value: any) =>
    setForm(f => ({ ...f, [field]: value }))

  return (
    <div className="max-w-2xl mx-auto animate-in space-y-4">
      <div className="flex items-center gap-3">
        <button className="btn text-xs py-1" onClick={() => navigate('/instituciones')}>
          ← Volver
        </button>
        <div>
          <h1 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
            Nueva institución
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
            <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Nombre *</label>
            <input className="input" value={form.nombre} onChange={e => set('nombre', e.target.value)} placeholder="Nombre oficial de la institución" required />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Nombre corto / siglas</label>
              <input className="input" value={form.nombre_corto} onChange={e => set('nombre_corto', e.target.value)} placeholder="GEPETROL, BM..." />
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Tipo de entidad</label>
              <select className="input" value={form.tipo_entidad} onChange={e => set('tipo_entidad', e.target.value)}>
                <option value="">— Sin especificar —</option>
                <option value="SA">Sociedad Anónima</option>
                <option value="SL">Sociedad Limitada</option>
                <option value="ONG">ONG / Fundación</option>
                <option value="Gov">Entidad Gubernamental</option>
                <option value="Banco">Entidad Bancaria</option>
                <option value="Partidos">Partido Político</option>
                <option value="Otro">Otro</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Descripción de actividad</label>
            <textarea className="input" rows={2} value={form.actividad_desc} onChange={e => set('actividad_desc', e.target.value)} placeholder="Describe la actividad principal de la institución..." />
          </div>
        </div>

        {/* Ubicación y contacto */}
        <div className="card p-4 space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
            Ubicación y contacto
          </h2>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>País de registro (ISO)</label>
              <input className="input" value={form.pais_registro} onChange={e => set('pais_registro', e.target.value.toUpperCase().slice(0,2))} placeholder="GQ, ES..." maxLength={2} />
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Ciudad sede</label>
              <input className="input" value={form.sede_ciudad} onChange={e => set('sede_ciudad', e.target.value)} placeholder="Malabo..." />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Web</label>
              <input className="input" type="url" value={form.web_principal} onChange={e => set('web_principal', e.target.value)} placeholder="https://..." />
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Email de contacto</label>
              <input className="input" type="email" value={form.email_contacto} onChange={e => set('email_contacto', e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Teléfono central</label>
              <input className="input" value={form.telefono_central} onChange={e => set('telefono_central', e.target.value)} placeholder="+240..." />
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Sector</label>
              <SectorSelector value={sectores} onChange={setSectores} max={3} />
            </div>
          </div>
        </div>

        {/* Clasificación */}
        <div className="card p-4 space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
            Clasificación
          </h2>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Estado legal</label>
              <select className="input" value={form.estado_legal} onChange={e => set('estado_legal', e.target.value)}>
                <option value="activa">Activa</option>
                <option value="inactiva">Inactiva</option>
                <option value="disuelta">Disuelta</option>
                <option value="suspendida">Suspendida</option>
                <option value="fusionada">Fusionada</option>
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
        </div>

        <div className="flex items-center justify-end gap-3 pb-8">
          <button type="button" className="btn text-xs py-2 px-4" onClick={() => navigate('/instituciones')}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary text-xs py-2 px-6" disabled={mutation.isPending}>
            {mutation.isPending ? 'Creando...' : 'Crear institución'}
          </button>
        </div>
      </form>
    </div>
  )
}
