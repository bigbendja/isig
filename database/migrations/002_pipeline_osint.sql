-- ============================================================
-- SIGINT DataCenter Pro — Migración 002: Soporte pipeline OSINT
-- Ejecutar después de 001_schema_inicial.sql
-- ============================================================

-- Caché de listas de sanciones (para verificación rápida)
CREATE TABLE IF NOT EXISTS osint.sanctions_cache (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre      VARCHAR(500) NOT NULL,
    lista       VARCHAR(100) NOT NULL,   -- OFAC, EU, ONU, INTERPOL, etc.
    id_externo  VARCHAR(200),            -- ID en la lista original
    pais        CHAR(2),
    fecha_nac   DATE,
    metadatos   JSONB DEFAULT '{}',
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(nombre, lista)
);

CREATE INDEX idx_sanctions_nombre
    ON osint.sanctions_cache USING gin(nombre gin_trgm_ops);
CREATE INDEX idx_sanctions_lista
    ON osint.sanctions_cache(lista);

COMMENT ON TABLE osint.sanctions_cache IS
    'Caché local de listas de sanciones internacionales para verificación rápida sin API';

-- Función para verificar nombre contra sanciones (usada por el pipeline)
CREATE OR REPLACE FUNCTION osint.verificar_sancion(p_nombre TEXT)
RETURNS TABLE(lista TEXT, similitud REAL) AS $$
    SELECT lista, similarity(nombre, p_nombre) AS sim
    FROM osint.sanctions_cache
    WHERE similarity(nombre, p_nombre) >= 0.80
    ORDER BY sim DESC
    LIMIT 5;
$$ LANGUAGE SQL STABLE;

-- Tabla de fuentes predefinidas (semilla inicial)
INSERT INTO osint.fuentes (nombre, tipo, url_base, descripcion, frecuencia_cron, nivel_confianza, activa)
VALUES
    ('Entrada manual',          'manual',       NULL,                        'Datos introducidos manualmente por analistas', NULL, 5, TRUE),
    ('Importación CSV/Excel',   'manual',       NULL,                        'Datos importados desde archivos', NULL, 4, TRUE),
    ('RSS — Prensa guinea',     'rss',          'https://example-guinea.com/feed', 'Medios de prensa locales', '0 */4 * * *', 3, FALSE),
    ('OpenSanctions — Sanciones', 'opensanctions', 'https://api.opensanctions.org', 'Listas internacionales de sanciones', '0 2 * * *', 5, FALSE),
    ('OpenCorporates — Empresas', 'opencorporates', 'https://api.opencorporates.com', 'Registro global de empresas', '0 4 * * 1', 4, FALSE),
    ('Monitor web — Menciones', 'menciones',    NULL,                        'Monitoreo de menciones web', '0 8 * * *', 3, FALSE)
ON CONFLICT DO NOTHING;

-- Índice adicional para búsqueda en perfil_extendido de personas
CREATE INDEX IF NOT EXISTS idx_personas_ext_gin
    ON core.personas USING gin(perfil_extendido);

-- Índice adicional para búsqueda en perfil_extendido de instituciones
CREATE INDEX IF NOT EXISTS idx_inst_ext_gin
    ON core.instituciones USING gin(perfil_extendido);

-- Vista de estadísticas del pipeline para el dashboard
CREATE OR REPLACE VIEW osint.v_pipeline_stats AS
SELECT
    f.id AS fuente_id,
    f.nombre,
    f.tipo,
    f.activa,
    f.ultimo_estado,
    f.ultima_ejecucion,
    f.total_registros,
    f.registros_hoy,
    f.nivel_confianza,
    (SELECT COUNT(*) FROM osint.datos_raw d
     WHERE d.fuente_id = f.id AND d.estado = 'pendiente') AS datos_pendientes,
    (SELECT COUNT(*) FROM osint.ejecuciones e
     WHERE e.fuente_id = f.id
       AND e.inicio >= NOW() - INTERVAL '7 days') AS ejecuciones_semana,
    (SELECT AVG(
         EXTRACT(EPOCH FROM (e.fin - e.inicio))
     )
     FROM osint.ejecuciones e
     WHERE e.fuente_id = f.id AND e.fin IS NOT NULL
       AND e.inicio >= NOW() - INTERVAL '30 days') AS duracion_media_seg
FROM osint.fuentes f
ORDER BY f.activa DESC, f.nombre;

COMMENT ON VIEW osint.v_pipeline_stats IS
    'Vista consolidada para el panel de monitoreo del pipeline OSINT';
