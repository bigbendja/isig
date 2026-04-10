// src/components/SectorSelector.tsx
import { useState } from 'react'
import { X, ChevronDown } from 'lucide-react'

const SECTORES: Record<string, string[]> = {
  'Energía': ['Petróleo y gas', 'Minería', 'Electricidad', 'Energías renovables', 'Agua y saneamiento', 'Nuclear'],
  'Finanzas': ['Banca', 'Seguros', 'Inversión y fondos', 'Mercados de capitales', 'Microfinanzas', 'Criptoactivos', 'Leasing y factoring', 'Gestión de activos'],
  'Gobierno y Sector Público': ['Administración pública', 'Defensa y seguridad', 'Justicia', 'Diplomacia', 'Organismos internacionales', 'Policía y fuerzas del orden', 'Inteligencia y contrainteligencia', 'Regulación y supervisión'],
  'Salud': ['Farmacéutica', 'Hospitales y clínicas', 'Investigación médica', 'Salud pública', 'Biotecnología', 'Equipamiento médico', 'Seguros de salud'],
  'Tecnología': ['Software y desarrollo', 'Hardware', 'Telecomunicaciones', 'Ciberseguridad', 'Inteligencia artificial', 'Cloud computing', 'Semiconductores', 'Fintech'],
  'Construcción e Inmobiliaria': ['Construcción', 'Promotora inmobiliaria', 'Infraestructura', 'Urbanismo', 'Arquitectura e ingeniería', 'Facility management'],
  'Comercio': ['Retail', 'Importación/Exportación', 'Logística', 'Distribución', 'Comercio electrónico', 'Mayorista'],
  'Legal y Consultoría': ['Despacho jurídico', 'Auditoría', 'Consultoría estratégica', 'Recursos humanos', 'Relaciones públicas', 'Cumplimiento regulatorio (Compliance)', 'Arbitraje y mediación'],
  'Medios y Comunicación': ['Prensa escrita', 'Radio y televisión', 'Publicidad y marketing', 'Redes sociales y digital', 'Agencia de noticias', 'Producción audiovisual'],
  'Educación': ['Universidad', 'Formación profesional', 'Educación primaria y secundaria', 'Investigación académica', 'Formación online', 'Think tanks'],
  'Agricultura y Alimentación': ['Agricultura', 'Pesca y acuicultura', 'Ganadería', 'Industria alimentaria', 'Agroindustria', 'Silvicultura'],
  'Transporte': ['Aviación', 'Marítimo y puertos', 'Ferroviario', 'Transporte por carretera', 'Logística multimodal', 'Automoción'],
  'ONG y Fundaciones': ['Humanitario', 'Cooperación al desarrollo', 'Religioso', 'Cultural y patrimonio', 'Medioambiental', 'Derechos humanos'],
  'Industria y Manufactura': ['Química e industria básica', 'Metalurgia y siderurgia', 'Textil y moda', 'Electrónica', 'Plásticos y caucho', 'Papel y cartón'],
  'Turismo y Hostelería': ['Hoteles y alojamiento', 'Restauración', 'Ocio y entretenimiento', 'Agencias de viaje', 'Casinos y juego'],
  'Política': ['Partido político', 'Sindicato', 'Patronal', 'Lobby y grupos de presión', 'Campaña electoral'],
  'Inmobiliaria y Patrimonio': ['Gestión de patrimonio', 'Family office', 'Holding', 'Sociedad instrumental', 'Fideicomiso'],
  'Seguridad Privada': ['Vigilancia y protección', 'Seguridad informática', 'Investigación privada', 'Gestión de riesgos'],
}

interface Props {
  value: string[]
  onChange: (sectors: string[]) => void
  max?: number
}

export function SectorSelector({ value, onChange, max = 3 }: Props) {
  const [open, setOpen] = useState(false)
  const [expandedCat, setExpandedCat] = useState<string | null>(null)

  const toggle = (sector: string) => {
    if (value.includes(sector)) {
      onChange(value.filter(s => s !== sector))
    } else if (value.length < max) {
      onChange([...value, sector])
    }
  }

  return (
    <div className="relative">
      {/* Selected chips */}
      <div className="flex flex-wrap gap-1.5 mb-1.5">
        {value.map(s => (
          <span key={s} className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
            style={{ background: 'var(--brand-light)', color: 'var(--brand-dark)', border: '1px solid var(--brand)' }}>
            {s}
            <button type="button" onClick={() => onChange(value.filter(x => x !== s))} className="hover:opacity-70">
              <X size={10} />
            </button>
          </span>
        ))}
        {value.length === 0 && (
          <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Sin sector seleccionado</span>
        )}
      </div>

      {/* Trigger button */}
      <button type="button" className="input flex items-center justify-between w-full text-xs"
        style={{ textAlign: 'left' }}
        onClick={() => setOpen(o => !o)}
        disabled={value.length >= max}>
        <span style={{ color: value.length >= max ? 'var(--text-tertiary)' : 'var(--text-secondary)' }}>
          {value.length >= max ? `Máximo ${max} sectores` : `Seleccionar sector${value.length > 0 ? ' (puede añadir más)' : ''}...`}
        </span>
        <ChevronDown size={13} style={{ color: 'var(--text-tertiary)', transform: open ? 'rotate(180deg)' : 'none', transition: '0.2s' }} />
      </button>

      {/* Dropdown */}
      {open && value.length < max && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-lg shadow-xl overflow-hidden"
          style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', maxHeight: '320px', overflowY: 'auto' }}>
          {Object.entries(SECTORES).map(([cat, subs]) => (
            <div key={cat}>
              {/* Category header */}
              <button type="button" className="w-full flex items-center justify-between px-3 py-2 text-left hover:opacity-80"
                style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}
                onClick={() => setExpandedCat(expandedCat === cat ? null : cat)}>
                <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{cat}</span>
                <ChevronDown size={11} style={{ color: 'var(--text-tertiary)', transform: expandedCat === cat ? 'rotate(180deg)' : 'none' }} />
              </button>
              {/* Subcategories */}
              {expandedCat === cat && subs.map(sub => {
                const selected = value.includes(sub)
                const disabled = !selected && value.length >= max
                return (
                  <button type="button" key={sub}
                    className="w-full flex items-center gap-2 px-5 py-2 text-left"
                    style={{
                      borderBottom: '1px solid var(--border)',
                      background: selected ? 'var(--brand-light)' : 'var(--bg-primary)',
                      opacity: disabled ? 0.4 : 1,
                      cursor: disabled ? 'not-allowed' : 'pointer',
                    }}
                    disabled={disabled}
                    onClick={() => toggle(sub)}>
                    <div className="w-3.5 h-3.5 rounded flex items-center justify-center flex-shrink-0"
                      style={{ background: selected ? 'var(--brand)' : 'var(--bg-tertiary)', border: `1px solid ${selected ? 'var(--brand)' : 'var(--border)'}` }}>
                      {selected && <span style={{ color: '#fff', fontSize: '8px', lineHeight: 1 }}>✓</span>}
                    </div>
                    <span className="text-xs" style={{ color: selected ? 'var(--brand-dark)' : 'var(--text-primary)' }}>{sub}</span>
                  </button>
                )
              })}
            </div>
          ))}
          <div className="px-3 py-2" style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
            <button type="button" className="text-xs hover:underline" style={{ color: 'var(--brand)' }}
              onClick={() => setOpen(false)}>
              Cerrar ✓
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
