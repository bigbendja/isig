-- ============================================================
-- SIGINT DataCenter Pro — Migración 003: Soporte ML avanzado
-- Requiere: pgvector instalado en PostgreSQL
-- ============================================================

-- Extensión pgvector para embeddings semánticos
CREATE EXTENSION IF NOT EXISTS vector;

-- Esquema ML
CREATE SCHEMA IF NOT EXISTS ml;
COMMENT ON SCHEMA ml IS 'Modelos ML: embeddings, predicciones, experimentos';

-- Tabla de embeddings de entidades
CREATE TABLE IF NOT EXISTS ml.entity_embeddings (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_id   UUID NOT NULL,
    entity_type VARCHAR(20) NOT NULL CHECK (entity_type IN ('persona', 'institucion')),
    -- Vector de 768 dimensiones (nomic-embed-text)
    -- Cambiar a 1536 si se usa OpenAI text-embedding-3-small
    embedding   vector(768),
    texto_base  TEXT,          -- texto usado para generar el embedding
    modelo      VARCHAR(100) DEFAULT 'nomic-embed-text',
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(entity_id, entity_type)
);

-- Índice IVFFlat para búsqueda ANN (Approximate Nearest Neighbor)
-- Requiere al menos 100 registros para construirse bien
CREATE INDEX IF NOT EXISTS idx_embeddings_ivfflat
    ON ml.entity_embeddings
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_embeddings_entity ON ml.entity_embeddings(entity_id, entity_type);

COMMENT ON TABLE ml.entity_embeddings IS
    'Vectores semánticos de entidades para búsqueda por similitud';

-- Tabla de predicciones
CREATE TABLE IF NOT EXISTS ml.predicciones (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entidad_tipo    VARCHAR(20),
    entidad_id      UUID,
    tipo_prediccion VARCHAR(100) NOT NULL,
    -- cambio_cargo / nuevo_vinculo / default_credito / expansion / sancion
    descripcion     TEXT,
    probabilidad    NUMERIC(5,4) CHECK (probabilidad BETWEEN 0 AND 1),
    horizonte_dias  INTEGER,
    features_input  JSONB DEFAULT '{}',
    version_modelo  VARCHAR(50),
    cumplida        BOOLEAN,      -- NULL = pendiente verificación
    cumplida_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pred_entidad ON ml.predicciones(entidad_tipo, entidad_id);
CREATE INDEX idx_pred_tipo    ON ml.predicciones(tipo_prediccion);
CREATE INDEX idx_pred_proba   ON ml.predicciones(probabilidad DESC);

-- Tabla de experimentos de entrenamiento
CREATE TABLE IF NOT EXISTS ml.experimentos (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre          VARCHAR(200) NOT NULL,
    tipo_modelo     VARCHAR(50),   -- xgboost / kmeans / neural
    tipo_entidad    VARCHAR(20),
    parametros      JSONB DEFAULT '{}',
    metricas        JSONB DEFAULT '{}',
    version         VARCHAR(50),
    activo          BOOLEAN DEFAULT FALSE,  -- TRUE = modelo en producción
    creado_por      UUID REFERENCES auth.usuarios(id),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla de segmentos (referenciada desde scoring.entidad_segmento)
-- Añadir constraint UNIQUE en nombre si no existe
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'segmentos_nombre_unique'
    ) THEN
        ALTER TABLE scoring.segmentos ADD CONSTRAINT segmentos_nombre_unique UNIQUE (nombre);
    END IF;
END $$;

-- Vista de analytics: segmentos con entidades y scores
CREATE OR REPLACE VIEW ml.v_segmentos_analytics AS
SELECT
    s.id AS segmento_id,
    s.nombre,
    s.descripcion,
    s.color_hex,
    s.etiquetas_json,
    COUNT(es.entidad_id) FILTER (WHERE es.entidad_tipo = 'persona')     AS num_personas,
    COUNT(es.entidad_id) FILTER (WHERE es.entidad_tipo = 'institucion') AS num_instituciones,
    AVG(CASE
        WHEN es.entidad_tipo = 'persona'
        THEN (SELECT score_riesgo FROM core.personas WHERE id = es.entidad_id)
        ELSE (SELECT score_riesgo FROM core.instituciones WHERE id = es.entidad_id)
    END) AS score_riesgo_medio,
    AVG(es.score) AS score_pertenencia_medio
FROM scoring.segmentos s
LEFT JOIN scoring.entidad_segmento es ON es.segmento_id = s.id
WHERE s.activo = TRUE
GROUP BY s.id, s.nombre, s.descripcion, s.color_hex, s.etiquetas_json
ORDER BY num_personas + num_instituciones DESC;

-- Añadir columna etiquetas_json si no existe en scoring.segmentos
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'scoring' AND table_name = 'segmentos' AND column_name = 'etiquetas_json'
    ) THEN
        ALTER TABLE scoring.segmentos ADD COLUMN etiquetas_json JSONB DEFAULT '[]';
    END IF;
END $$;

-- Función de búsqueda semántica (llamada desde la API)
CREATE OR REPLACE FUNCTION ml.buscar_similares(
    p_embedding vector(768),
    p_tipo      VARCHAR DEFAULT NULL,
    p_limite    INTEGER DEFAULT 10,
    p_nivel     SMALLINT DEFAULT 1
)
RETURNS TABLE(
    entity_id   UUID,
    entity_type VARCHAR,
    similitud   FLOAT
) AS $$
    SELECT
        e.entity_id,
        e.entity_type,
        1 - (e.embedding <=> p_embedding) AS similitud
    FROM ml.entity_embeddings e
    WHERE ($2 IS NULL OR e.entity_type = $2)
      AND 1 - (e.embedding <=> p_embedding) > 0.5
    ORDER BY e.embedding <=> p_embedding
    LIMIT $3;
$$ LANGUAGE SQL STABLE;

COMMENT ON FUNCTION ml.buscar_similares IS
    'Búsqueda semántica ANN usando pgvector. Requiere embeddings indexados.';
