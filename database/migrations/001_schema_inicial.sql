-- ============================================================
-- SIGINT DataCenter Pro — Esquema PostgreSQL v2
-- Decisiones de diseño aplicadas:
--   - MongoDB eliminado: JSONB en PostgreSQL lo sustituye
--   - Elasticsearch diferido a Fase 6
--   - Dos capas por entidad: estructurada + perfil_extendido JSONB
--   - Metadatos de calidad del dato en cada campo extendido
--   - Módulo de Investigaciones/Casos incluido
--   - Scoring básico desde Fase 2 (reglas, sin ML aún)
-- ============================================================

-- ── EXTENSIONES ───────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "unaccent";
CREATE EXTENSION IF NOT EXISTS "btree_gin";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
-- pgvector se añade en Fase 7 (ML avanzado):
-- CREATE EXTENSION IF NOT EXISTS "vector";

-- ── ESQUEMAS ──────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS auth;       -- usuarios, roles, sesiones
CREATE SCHEMA IF NOT EXISTS core;       -- entidades principales
CREATE SCHEMA IF NOT EXISTS intel;      -- vínculos, eventos, investigaciones
CREATE SCHEMA IF NOT EXISTS osint;      -- pipeline de ingesta
CREATE SCHEMA IF NOT EXISTS scoring;    -- scores y segmentación
CREATE SCHEMA IF NOT EXISTS audit;      -- trazabilidad completa

COMMENT ON SCHEMA auth    IS 'Autenticación: usuarios, roles, sesiones, 2FA';
COMMENT ON SCHEMA core    IS 'Entidades principales: personas, instituciones, archivos';
COMMENT ON SCHEMA intel   IS 'Inteligencia: vínculos, eventos, investigaciones, perfiles digitales';
COMMENT ON SCHEMA osint   IS 'Pipeline OSINT: fuentes, ejecuciones, datos raw, alertas';
COMMENT ON SCHEMA scoring IS 'Scores de riesgo, segmentación, predicciones';
COMMENT ON SCHEMA audit   IS 'Auditoría: log de accesos, cambios por campo, trazabilidad';

-- ============================================================
-- BLOQUE 1: AUTH — USUARIOS Y CONTROL DE ACCESO
-- ============================================================

CREATE TABLE auth.roles (
    id              SERIAL PRIMARY KEY,
    codigo          VARCHAR(30) UNIQUE NOT NULL,
    nombre          VARCHAR(100) NOT NULL,
    nivel_acceso    SMALLINT NOT NULL CHECK (nivel_acceso BETWEEN 1 AND 5),
    descripcion     TEXT,
    -- Permisos granulares por módulo
    -- Ejemplo: {"entidades": {"read": true, "write": true, "delete": false},
    --            "investigaciones": {"read": true, "write": true},
    --            "osint": {"read": true, "trigger": false},
    --            "admin": false, "export": true}
    permisos        JSONB NOT NULL DEFAULT '{}',
    activo          BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO auth.roles (codigo, nombre, nivel_acceso, descripcion, permisos) VALUES
('viewer',        'Observador',            1, 'Solo lectura de datos públicos',
    '{"entidades":{"read":true,"write":false},"investigaciones":{"read":false},"osint":{"read":false},"export":false,"admin":false}'),
('analyst',       'Analista',              2, 'Lectura y escritura de datos nivel 1-2',
    '{"entidades":{"read":true,"write":true},"investigaciones":{"read":true,"write":true},"osint":{"read":true,"trigger":false},"export":true,"admin":false}'),
('senior_analyst','Analista Senior',       3, 'Acceso a datos financieros y confidenciales',
    '{"entidades":{"read":true,"write":true},"investigaciones":{"read":true,"write":true},"osint":{"read":true,"trigger":true},"export":true,"admin":false}'),
('intel_officer', 'Oficial de Inteligencia', 4, 'Acceso secreto, puede gestionar fuentes OSINT',
    '{"entidades":{"read":true,"write":true,"delete":true},"investigaciones":{"read":true,"write":true,"close":true},"osint":{"read":true,"trigger":true,"config":true},"export":true,"admin":false}'),
('admin',         'Administrador',         5, 'Acceso total excepto configuración de sistema',
    '{"entidades":{"read":true,"write":true,"delete":true},"investigaciones":{"read":true,"write":true,"close":true},"osint":{"read":true,"trigger":true,"config":true},"export":true,"admin":true}'),
('root',          'Superadministrador',    5, 'Acceso y control total del sistema',
    '{"entidades":{"read":true,"write":true,"delete":true},"investigaciones":{"read":true,"write":true,"close":true},"osint":{"read":true,"trigger":true,"config":true},"export":true,"admin":true,"system":true}');

CREATE TABLE auth.usuarios (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username            VARCHAR(80) UNIQUE NOT NULL,
    email               VARCHAR(255) UNIQUE NOT NULL,
    password_hash       TEXT NOT NULL,              -- bcrypt, factor ≥12
    totp_secret         TEXT,                       -- 2FA TOTP (cifrado en app)
    totp_activo         BOOLEAN DEFAULT FALSE,
    totp_verificado_at  TIMESTAMPTZ,

    rol_id              INTEGER NOT NULL REFERENCES auth.roles(id),
    nivel_acceso        SMALLINT GENERATED ALWAYS AS (
                            -- desnormalizado para joins rápidos sin subquery
                            (SELECT nivel_acceso FROM auth.roles WHERE id = rol_id)
                        ) STORED,

    nombre_completo     VARCHAR(255),
    avatar_url          TEXT,
    idioma              VARCHAR(10) DEFAULT 'es',
    zona_horaria        VARCHAR(60) DEFAULT 'Africa/Malabo',
    preferencias        JSONB DEFAULT '{}',         -- tema, densidad, columnas visibles, etc.

    activo              BOOLEAN DEFAULT TRUE,
    bloqueado           BOOLEAN DEFAULT FALSE,
    razon_bloqueo       TEXT,
    intentos_fallidos   SMALLINT DEFAULT 0,
    ultimo_login        TIMESTAMPTZ,
    ultimo_ip           INET,

    token_reset         TEXT,
    token_reset_expiry  TIMESTAMPTZ,

    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_usuarios_email     ON auth.usuarios(email);
CREATE INDEX idx_usuarios_username  ON auth.usuarios(username);
CREATE INDEX idx_usuarios_activo    ON auth.usuarios(activo, rol_id);

CREATE TABLE auth.sesiones (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    usuario_id      UUID NOT NULL REFERENCES auth.usuarios(id) ON DELETE CASCADE,
    token_hash      TEXT NOT NULL,
    refresh_hash    TEXT,
    ip_address      INET,
    user_agent      TEXT,
    dispositivo     VARCHAR(100),
    activa          BOOLEAN DEFAULT TRUE,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    ultimo_uso      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sesiones_usuario  ON auth.sesiones(usuario_id);
CREATE INDEX idx_sesiones_activa   ON auth.sesiones(activa, expires_at);

-- ============================================================
-- BLOQUE 2: CATÁLOGOS Y TAXONOMÍAS
-- ============================================================

CREATE TABLE core.paises (
    codigo      CHAR(2) PRIMARY KEY,
    nombre_es   VARCHAR(100) NOT NULL,
    nombre_en   VARCHAR(100),
    region      VARCHAR(80),
    subregion   VARCHAR(80),
    activo      BOOLEAN DEFAULT TRUE
);

CREATE TABLE core.tipos_vinculo (
    id          SERIAL PRIMARY KEY,
    codigo      VARCHAR(50) UNIQUE NOT NULL,
    nombre      VARCHAR(100) NOT NULL,
    categoria   VARCHAR(50),    -- familiar | laboral | comercial | politico | social
    descripcion TEXT,
    bidireccional_por_defecto BOOLEAN DEFAULT FALSE
);

INSERT INTO core.tipos_vinculo (codigo, nombre, categoria, bidireccional_por_defecto) VALUES
('conyugue',        'Cónyuge / Pareja',          'familiar',   true),
('ex_conyugue',     'Ex cónyuge',                'familiar',   true),
('hijo',            'Hijo/a',                    'familiar',   false),
('padre',           'Padre/Madre',               'familiar',   false),
('hermano',         'Hermano/a',                 'familiar',   true),
('familiar_ext',    'Familiar extendido',        'familiar',   true),
('empleado',        'Empleado de',               'laboral',    false),
('supervisor',      'Supervisor de',             'laboral',    false),
('socio',           'Socio comercial',           'comercial',  true),
('accionista',      'Accionista de',             'comercial',  false),
('cliente',         'Cliente de',                'comercial',  false),
('proveedor',       'Proveedor de',              'comercial',  false),
('representante',   'Representante legal de',    'comercial',  false),
('consejero',       'Consejero/Directivo de',    'laboral',    false),
('aliado_politico', 'Aliado político',           'politico',   true),
('opositor',        'Opositor / Adversario',     'politico',   true),
('patrocinador',    'Patrocinador de',           'comercial',  false),
('conocido',        'Conocido / Contacto',       'social',     true),
('mentor',          'Mentor de',                 'social',     false),
('investigado_con', 'Investigado junto a',       'social',     true);

-- ============================================================
-- BLOQUE 3: ENTIDADES — PERSONAS
-- ============================================================

CREATE TABLE core.personas (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- ─── NIVEL 1: IDENTIFICACIÓN BÁSICA ─────────────────────
    nombre_completo VARCHAR(255) NOT NULL,
    nombres         VARCHAR(100),
    apellidos       VARCHAR(150),
    alias           TEXT[],
    genero          VARCHAR(20),
    fecha_nacimiento DATE,
    lugar_nacimiento VARCHAR(200),
    fecha_fallecimiento DATE,
    nacionalidad    CHAR(2) REFERENCES core.paises(codigo),
    otras_nacs      CHAR(2)[],
    estado_civil    VARCHAR(30),
    idiomas         TEXT[],

    -- ─── NIVEL 2: CONTACTO Y UBICACIÓN ───────────────────────
    email_principal VARCHAR(255),
    telefono_principal VARCHAR(50),
    pais_residencia CHAR(2) REFERENCES core.paises(codigo),
    ciudad_residencia VARCHAR(100),
    direccion_principal TEXT,
    -- Geolocalización PostGIS (última ubicación conocida)
    ubicacion_actual GEOGRAPHY(POINT, 4326),
    ubicacion_at    TIMESTAMPTZ,    -- cuándo se registró esa ubicación

    -- ─── NIVEL 2: LABORAL CORE ───────────────────────────────
    cargo_actual    VARCHAR(255),
    empresa_actual  UUID,           -- FK a instituciones (se añade más abajo)
    sector_principal VARCHAR(100),
    es_pep          BOOLEAN DEFAULT FALSE,
    nivel_pep       SMALLINT CHECK (nivel_pep BETWEEN 1 AND 3),

    -- ─── NIVEL 3: FINANCIERO ─────────────────────────────────
    nivel_riqueza   VARCHAR(30),    -- bajo/medio/alto/muy_alto/ultra
    patrimonio_est  NUMERIC(18,2),
    patrimonio_moneda CHAR(3) DEFAULT 'XAF',
    ingresos_anuales_est NUMERIC(18,2),

    -- ─── NIVEL 4: INTELIGENCIA ───────────────────────────────
    en_lista_vigilancia BOOLEAN DEFAULT FALSE,
    listas_externas TEXT[],         -- OFAC, EU, ONU, etc.
    nivel_prioridad SMALLINT DEFAULT 1 CHECK (nivel_prioridad BETWEEN 1 AND 5),

    -- ─── SCORING (calculado por sistema) ─────────────────────
    -- Rango 0.00–1.00. Se recalcula automáticamente.
    score_riesgo    NUMERIC(4,3) DEFAULT 0.000 CHECK (score_riesgo BETWEEN 0 AND 1),
    score_influencia NUMERIC(4,3) DEFAULT 0.000,  -- PageRank del grafo
    score_version   INTEGER DEFAULT 0,            -- versión del cálculo
    score_at        TIMESTAMPTZ,

    -- ─── EXPEDIENTE EXTENDIDO (JSONB LIBRE) ──────────────────
    -- Cualquier campo adicional sigue este schema por campo:
    -- { "campo_nombre": {
    --     "valor": ...,
    --     "fuente": "LinkedIn | OSINT | Manual | ...",
    --     "fecha": "2024-03",
    --     "confianza": 3,        -- 1 (baja) a 5 (verificado)
    --     "verificado": false,   -- true si analista lo confirmó
    --     "verificado_por": uuid,
    --     "notas": "..."
    --   }
    -- }
    perfil_extendido JSONB DEFAULT '{}',

    -- ─── METADATOS DEL SISTEMA ───────────────────────────────
    nivel_acceso_requerido SMALLINT DEFAULT 1 CHECK (nivel_acceso_requerido BETWEEN 1 AND 5),
    completitud     NUMERIC(5,2) DEFAULT 0,        -- % campos completados
    nivel_confianza_global SMALLINT DEFAULT 3,     -- confianza media del expediente

    fuente_primaria VARCHAR(100),
    activo          BOOLEAN DEFAULT TRUE,
    duplicado_de    UUID REFERENCES core.personas(id),

    created_by      UUID REFERENCES auth.usuarios(id),
    updated_by      UUID REFERENCES auth.usuarios(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ                    -- soft delete
);

-- Índices de búsqueda
CREATE INDEX idx_personas_nombre    ON core.personas USING gin(nombre_completo gin_trgm_ops);
CREATE INDEX idx_personas_apellidos ON core.personas USING gin(apellidos gin_trgm_ops);
CREATE INDEX idx_personas_alias     ON core.personas USING gin(alias);
CREATE INDEX idx_personas_email     ON core.personas(email_principal);
CREATE INDEX idx_personas_nac       ON core.personas(nacionalidad);
CREATE INDEX idx_personas_ciudad    ON core.personas(ciudad_residencia);
CREATE INDEX idx_personas_pep       ON core.personas(es_pep) WHERE es_pep = TRUE;
CREATE INDEX idx_personas_vigilancia ON core.personas(en_lista_vigilancia) WHERE en_lista_vigilancia = TRUE;
CREATE INDEX idx_personas_riesgo    ON core.personas(score_riesgo DESC);
CREATE INDEX idx_personas_prioridad ON core.personas(nivel_prioridad DESC);
CREATE INDEX idx_personas_geo       ON core.personas USING gist(ubicacion_actual);
CREATE INDEX idx_personas_activo    ON core.personas(activo, deleted_at) WHERE activo = TRUE AND deleted_at IS NULL;
-- Índice GIN sobre el JSONB extendido para búsquedas en campos dinámicos
CREATE INDEX idx_personas_extendido ON core.personas USING gin(perfil_extendido jsonb_path_ops);

-- ============================================================
-- BLOQUE 4: ENTIDADES — INSTITUCIONES
-- ============================================================

CREATE TABLE core.instituciones (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- ─── NIVEL 1: IDENTIFICACIÓN LEGAL ───────────────────────
    nombre          VARCHAR(255) NOT NULL,
    nombre_corto    VARCHAR(100),
    alias           TEXT[],
    tipo_entidad    VARCHAR(50),        -- SA/SL/ONG/Gov/Coop/Partidos/etc.
    sector          VARCHAR(100),
    subsector       VARCHAR(100),
    actividad_desc  TEXT,
    numero_registro VARCHAR(100),
    cif_nif         VARCHAR(50),
    pais_registro   CHAR(2) REFERENCES core.paises(codigo),
    fecha_fundacion DATE,
    estado_legal    VARCHAR(30) DEFAULT 'activa',  -- activa/inactiva/disuelta/suspendida/fusionada

    -- ─── NIVEL 1/2: PRESENCIA ────────────────────────────────
    web_principal   VARCHAR(255),
    email_contacto  VARCHAR(255),
    telefono_central VARCHAR(50),
    sede_pais       CHAR(2) REFERENCES core.paises(codigo),
    sede_ciudad     VARCHAR(100),
    sede_direccion  TEXT,
    sede_coords     GEOGRAPHY(POINT, 4326),
    paises_operacion CHAR(2)[],

    -- ─── NIVEL 2: ESTRUCTURA ─────────────────────────────────
    empresa_matriz  UUID REFERENCES core.instituciones(id),
    grupo_empresarial VARCHAR(255),
    tipo_propiedad  VARCHAR(30),        -- pública/privada/mixta/familiar
    cotiza_bolsa    BOOLEAN DEFAULT FALSE,
    numero_empleados INTEGER,

    -- ─── NIVEL 3: FINANCIERO ─────────────────────────────────
    capital_social  NUMERIC(18,2),
    patrimonio_neto NUMERIC(18,2),
    facturacion_anual NUMERIC(18,2),
    facturacion_moneda CHAR(3) DEFAULT 'XAF',
    rating_credito  VARCHAR(20),
    endeudamiento   NUMERIC(18,2),

    -- ─── NIVEL 4: INTELIGENCIA ───────────────────────────────
    en_lista_vigilancia BOOLEAN DEFAULT FALSE,
    listas_externas TEXT[],
    nivel_prioridad SMALLINT DEFAULT 1 CHECK (nivel_prioridad BETWEEN 1 AND 5),

    -- ─── SCORING ─────────────────────────────────────────────
    score_riesgo    NUMERIC(4,3) DEFAULT 0.000 CHECK (score_riesgo BETWEEN 0 AND 1),
    score_influencia NUMERIC(4,3) DEFAULT 0.000,
    score_version   INTEGER DEFAULT 0,
    score_at        TIMESTAMPTZ,

    -- ─── EXPEDIENTE EXTENDIDO ────────────────────────────────
    perfil_extendido JSONB DEFAULT '{}',

    -- ─── METADATOS SISTEMA ───────────────────────────────────
    nivel_acceso_requerido SMALLINT DEFAULT 1,
    completitud     NUMERIC(5,2) DEFAULT 0,
    nivel_confianza_global SMALLINT DEFAULT 3,
    fuente_primaria VARCHAR(100),
    activo          BOOLEAN DEFAULT TRUE,
    duplicado_de    UUID REFERENCES core.instituciones(id),

    created_by      UUID REFERENCES auth.usuarios(id),
    updated_by      UUID REFERENCES auth.usuarios(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

-- FK circular (personas ↔ instituciones)
ALTER TABLE core.personas ADD CONSTRAINT fk_persona_empresa
    FOREIGN KEY (empresa_actual) REFERENCES core.instituciones(id);

CREATE INDEX idx_inst_nombre    ON core.instituciones USING gin(nombre gin_trgm_ops);
CREATE INDEX idx_inst_sector    ON core.instituciones(sector);
CREATE INDEX idx_inst_pais      ON core.instituciones(pais_registro);
CREATE INDEX idx_inst_vigilancia ON core.instituciones(en_lista_vigilancia) WHERE en_lista_vigilancia = TRUE;
CREATE INDEX idx_inst_riesgo    ON core.instituciones(score_riesgo DESC);
CREATE INDEX idx_inst_geo       ON core.instituciones USING gist(sede_coords);
CREATE INDEX idx_inst_activo    ON core.instituciones(activo, deleted_at) WHERE activo = TRUE AND deleted_at IS NULL;
CREATE INDEX idx_inst_extendido ON core.instituciones USING gin(perfil_extendido jsonb_path_ops);

-- ============================================================
-- BLOQUE 5: DOCUMENTOS DE IDENTIDAD Y ARCHIVOS
-- ============================================================

CREATE TABLE core.documentos_identidad (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    persona_id      UUID NOT NULL REFERENCES core.personas(id) ON DELETE CASCADE,
    tipo            VARCHAR(50) NOT NULL,       -- pasaporte/dni/nie/ruc/electoral/etc.
    numero          VARCHAR(100) NOT NULL,
    pais_emisor     CHAR(2) REFERENCES core.paises(codigo),
    fecha_emision   DATE,
    fecha_expiry    DATE,
    vigente         BOOLEAN DEFAULT TRUE,
    nivel_acceso    SMALLINT DEFAULT 2,
    archivo_id      UUID,                       -- FK a archivos
    fuente          VARCHAR(100),
    confianza       SMALLINT DEFAULT 3,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_docs_persona ON core.documentos_identidad(persona_id);
CREATE INDEX idx_docs_numero  ON core.documentos_identidad USING gin(numero gin_trgm_ops);

CREATE TABLE core.archivos (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entidad_tipo    VARCHAR(20) CHECK (entidad_tipo IN ('persona','institucion','investigacion')),
    entidad_id      UUID NOT NULL,
    nombre          VARCHAR(500) NOT NULL,
    tipo_mime       VARCHAR(100),
    extension       VARCHAR(20),
    tamano_bytes    BIGINT,
    hash_sha256     CHAR(64),
    categoria       VARCHAR(80),               -- foto/pasaporte/contrato/extracto/etc.
    descripcion     TEXT,
    etiquetas       TEXT[],
    storage_backend VARCHAR(20) DEFAULT 'local',
    storage_path    TEXT NOT NULL,
    nivel_acceso    SMALLINT DEFAULT 2,
    cifrado         BOOLEAN DEFAULT TRUE,
    created_by      UUID REFERENCES auth.usuarios(id),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_archivos_entidad   ON core.archivos(entidad_tipo, entidad_id);
CREATE INDEX idx_archivos_categoria ON core.archivos(categoria);
CREATE INDEX idx_archivos_hash      ON core.archivos(hash_sha256);

-- ============================================================
-- BLOQUE 6: INTEL — VÍNCULOS Y GRAFO
-- ============================================================

CREATE TABLE intel.vinculos (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Origen del vínculo
    origen_tipo     VARCHAR(20) NOT NULL CHECK (origen_tipo IN ('persona','institucion')),
    origen_id       UUID NOT NULL,

    -- Destino del vínculo
    destino_tipo    VARCHAR(20) NOT NULL CHECK (destino_tipo IN ('persona','institucion')),
    destino_id      UUID NOT NULL,

    tipo_vinculo_id INTEGER REFERENCES core.tipos_vinculo(id),
    tipo_vinculo_custom VARCHAR(100),          -- si no está en catálogo
    descripcion     TEXT,
    bidireccional   BOOLEAN DEFAULT FALSE,

    -- Peso del vínculo
    intensidad      NUMERIC(3,2) DEFAULT 0.50 CHECK (intensidad BETWEEN 0 AND 1),
    frecuencia      VARCHAR(30),               -- diaria/semanal/mensual/ocasional/unica

    -- Temporalidad
    fecha_inicio    DATE,
    fecha_fin       DATE,
    vigente         BOOLEAN DEFAULT TRUE,

    -- Calidad del dato
    fuente          VARCHAR(100),
    confianza       SMALLINT DEFAULT 3 CHECK (confianza BETWEEN 1 AND 5),
    verificado      BOOLEAN DEFAULT FALSE,
    verificado_por  UUID REFERENCES auth.usuarios(id),
    evidencias      JSONB DEFAULT '[]',        -- [{url, descripcion, fecha}]

    nivel_acceso    SMALLINT DEFAULT 2,

    created_by      UUID REFERENCES auth.usuarios(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),

    -- Evitar duplicados exactos
    CONSTRAINT no_self_link CHECK (
        NOT (origen_tipo = destino_tipo AND origen_id = destino_id)
    )
);

CREATE INDEX idx_vinculos_origen    ON intel.vinculos(origen_tipo, origen_id);
CREATE INDEX idx_vinculos_destino   ON intel.vinculos(destino_tipo, destino_id);
CREATE INDEX idx_vinculos_tipo      ON intel.vinculos(tipo_vinculo_id);
CREATE INDEX idx_vinculos_vigente   ON intel.vinculos(vigente) WHERE vigente = TRUE;
CREATE INDEX idx_vinculos_intensidad ON intel.vinculos(intensidad DESC);

-- ============================================================
-- BLOQUE 7: INTEL — EVENTOS Y TIMELINE
-- ============================================================

CREATE TABLE intel.eventos (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entidad_tipo    VARCHAR(20) CHECK (entidad_tipo IN ('persona','institucion')),
    entidad_id      UUID,

    tipo_evento     VARCHAR(80) NOT NULL,
    -- Tipos: nombramiento/dimision/compraventa/proceso_judicial/viaje/
    --        aparicion_media/cambio_domicilio/sancion/mencion_osint/
    --        nuevo_vinculo/cambio_cargo/alerta_sistema/nota_analista

    titulo          VARCHAR(500) NOT NULL,
    descripcion     TEXT,
    fecha_evento    TIMESTAMPTZ,
    fecha_fin       TIMESTAMPTZ,
    es_futuro       BOOLEAN DEFAULT FALSE,

    -- Geolocalización del evento
    pais_evento     CHAR(2) REFERENCES core.paises(codigo),
    ciudad_evento   VARCHAR(100),
    coords_evento   GEOGRAPHY(POINT, 4326),

    importancia     SMALLINT DEFAULT 3 CHECK (importancia BETWEEN 1 AND 5),
    etiquetas       TEXT[],
    entidades_rel   JSONB DEFAULT '[]',        -- otras entidades implicadas [{tipo, id, rol}]

    -- Calidad del dato
    fuente          VARCHAR(100),
    url_fuente      TEXT,
    confianza       SMALLINT DEFAULT 3,
    verificado      BOOLEAN DEFAULT FALSE,
    nivel_acceso    SMALLINT DEFAULT 2,

    created_by      UUID REFERENCES auth.usuarios(id),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_eventos_entidad    ON intel.eventos(entidad_tipo, entidad_id);
CREATE INDEX idx_eventos_tipo       ON intel.eventos(tipo_evento);
CREATE INDEX idx_eventos_fecha      ON intel.eventos(fecha_evento DESC NULLS LAST);
CREATE INDEX idx_eventos_importancia ON intel.eventos(importancia DESC);
CREATE INDEX idx_eventos_etiquetas  ON intel.eventos USING gin(etiquetas);

-- ============================================================
-- BLOQUE 8: INTEL — PERFILES DIGITALES
-- ============================================================

CREATE TABLE intel.perfiles_digitales (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entidad_tipo    VARCHAR(20) NOT NULL,
    entidad_id      UUID NOT NULL,

    plataforma      VARCHAR(80) NOT NULL,
    -- linkedin/twitter_x/facebook/instagram/telegram/
    -- youtube/tiktok/github/web_personal/otros

    username        VARCHAR(255),
    url_perfil      TEXT,
    id_plataforma   VARCHAR(255),
    nombre_mostrado VARCHAR(255),
    bio             TEXT,
    seguidores      INTEGER,
    siguiendo       INTEGER,
    publicaciones   INTEGER,
    verificado      BOOLEAN DEFAULT FALSE,
    activo          BOOLEAN DEFAULT TRUE,

    ultimo_scrapeo  TIMESTAMPTZ,
    datos_extra     JSONB DEFAULT '{}',        -- campos específicos por plataforma

    fuente          VARCHAR(100),
    confianza       SMALLINT DEFAULT 3,
    nivel_acceso    SMALLINT DEFAULT 2,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(entidad_tipo, entidad_id, plataforma)
);

CREATE INDEX idx_perfiles_entidad   ON intel.perfiles_digitales(entidad_tipo, entidad_id);
CREATE INDEX idx_perfiles_plataforma ON intel.perfiles_digitales(plataforma);

-- ============================================================
-- BLOQUE 9: INTEL — INVESTIGACIONES / CASOS
-- ============================================================

CREATE TABLE intel.investigaciones (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    codigo          VARCHAR(50) UNIQUE,        -- Ej: INV-2026-001
    titulo          VARCHAR(500) NOT NULL,
    descripcion     TEXT,
    objetivo        TEXT,

    estado          VARCHAR(30) DEFAULT 'abierta',
    -- abierta/en_curso/pausada/cerrada/archivada

    prioridad       SMALLINT DEFAULT 3 CHECK (prioridad BETWEEN 1 AND 5),
    clasificacion   SMALLINT DEFAULT 2 CHECK (clasificacion BETWEEN 1 AND 5),

    responsable_id  UUID REFERENCES auth.usuarios(id),
    equipo          UUID[],                    -- IDs de analistas asignados

    fecha_apertura  TIMESTAMPTZ DEFAULT NOW(),
    fecha_cierre    TIMESTAMPTZ,
    fecha_objetivo  DATE,                      -- deadline estimado

    conclusion      TEXT,                      -- resumen al cerrar
    etiquetas       TEXT[],

    created_by      UUID REFERENCES auth.usuarios(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_inv_estado         ON intel.investigaciones(estado);
CREATE INDEX idx_inv_responsable    ON intel.investigaciones(responsable_id);
CREATE INDEX idx_inv_clasificacion  ON intel.investigaciones(clasificacion);

-- Entidades vinculadas a una investigación
CREATE TABLE intel.inv_entidades (
    investigacion_id UUID NOT NULL REFERENCES intel.investigaciones(id) ON DELETE CASCADE,
    entidad_tipo    VARCHAR(20) NOT NULL,
    entidad_id      UUID NOT NULL,
    rol_en_caso     VARCHAR(100),              -- investigado/testigo/víctima/relacionado
    notas           TEXT,
    añadido_por     UUID REFERENCES auth.usuarios(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (investigacion_id, entidad_tipo, entidad_id)
);

-- Notas y evidencias de la investigación
CREATE TABLE intel.inv_notas (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    investigacion_id UUID NOT NULL REFERENCES intel.investigaciones(id) ON DELETE CASCADE,
    tipo            VARCHAR(30) DEFAULT 'nota',
    -- nota/evidencia/hallazgo/contradiccion/hipotesis/conclusion_parcial
    contenido       TEXT NOT NULL,
    adjuntos        UUID[],                    -- IDs de archivos
    entidades_ref   JSONB DEFAULT '[]',        -- entidades mencionadas en la nota
    nivel_acceso    SMALLINT DEFAULT 2,
    created_by      UUID NOT NULL REFERENCES auth.usuarios(id),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_inv_notas_inv  ON intel.inv_notas(investigacion_id, created_at DESC);

-- ============================================================
-- BLOQUE 10: OSINT — PIPELINE DE INGESTA
-- ============================================================

CREATE TABLE osint.fuentes (
    id              SERIAL PRIMARY KEY,
    nombre          VARCHAR(200) NOT NULL,
    tipo            VARCHAR(50) NOT NULL,
    -- web_scraper/api_rest/rss/manual/ocr/social/email/db_externa

    url_base        TEXT,
    descripcion     TEXT,

    -- Configuración del conector (cifrado a nivel app)
    config          JSONB DEFAULT '{}',
    -- {headers, auth_type, credentials_ref, params, proxy, etc.}

    frecuencia_cron VARCHAR(50),               -- expresión cron
    timeout_seg     INTEGER DEFAULT 30,
    rate_limit_rpm  INTEGER DEFAULT 10,
    activa          BOOLEAN DEFAULT TRUE,

    -- Estado
    ultima_ejecucion TIMESTAMPTZ,
    proximo_run      TIMESTAMPTZ,
    ultimo_estado   VARCHAR(20) DEFAULT 'pendiente',
    ultimo_error    TEXT,
    total_runs      INTEGER DEFAULT 0,
    total_registros INTEGER DEFAULT 0,
    registros_hoy   INTEGER DEFAULT 0,

    nivel_confianza SMALLINT DEFAULT 3,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE osint.ejecuciones (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fuente_id       INTEGER NOT NULL REFERENCES osint.fuentes(id),
    inicio          TIMESTAMPTZ DEFAULT NOW(),
    fin             TIMESTAMPTZ,
    duracion_seg    INTEGER GENERATED ALWAYS AS (
                        EXTRACT(EPOCH FROM (fin - inicio))::INTEGER
                    ) STORED,
    estado          VARCHAR(20) DEFAULT 'en_curso',
    trigger_tipo    VARCHAR(20) DEFAULT 'schedule',  -- schedule/manual/webhook
    trigger_usuario UUID REFERENCES auth.usuarios(id),

    registros_nuevos        INTEGER DEFAULT 0,
    registros_actualizados  INTEGER DEFAULT 0,
    registros_descartados   INTEGER DEFAULT 0,
    registros_error         INTEGER DEFAULT 0,

    errores         JSONB DEFAULT '[]',
    log_resumen     TEXT
);

CREATE INDEX idx_ejecuciones_fuente ON osint.ejecuciones(fuente_id, inicio DESC);
CREATE INDEX idx_ejecuciones_estado ON osint.ejecuciones(estado);

CREATE TABLE osint.datos_raw (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fuente_id       INTEGER REFERENCES osint.fuentes(id),
    ejecucion_id    UUID REFERENCES osint.ejecuciones(id),

    url_origen      TEXT,
    contenido_raw   JSONB,                     -- dato tal como llegó
    contenido_norm  JSONB,                     -- tras normalización ETL

    -- Mapeo a entidad
    entidad_tipo    VARCHAR(20),
    entidad_id      UUID,                      -- NULL si no procesado aún
    campo_afectado  VARCHAR(100),
    valor_extraido  TEXT,

    estado          VARCHAR(20) DEFAULT 'pendiente',
    -- pendiente/procesado/descartado/error/revision_manual

    confianza_ext   NUMERIC(3,2),              -- confianza de la extracción
    requiere_revision BOOLEAN DEFAULT FALSE,

    created_at      TIMESTAMPTZ DEFAULT NOW(),
    procesado_at    TIMESTAMPTZ
);

CREATE INDEX idx_raw_fuente    ON osint.datos_raw(fuente_id);
CREATE INDEX idx_raw_entidad   ON osint.datos_raw(entidad_tipo, entidad_id);
CREATE INDEX idx_raw_estado    ON osint.datos_raw(estado) WHERE estado = 'pendiente';
CREATE INDEX idx_raw_revision  ON osint.datos_raw(requiere_revision) WHERE requiere_revision = TRUE;

CREATE TABLE osint.alertas (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tipo_alerta     VARCHAR(80) NOT NULL,
    -- nueva_mencion/cambio_cargo/nuevo_vinculo/lista_sancion/
    -- cambio_domicilio/actividad_inusual/dato_contradictorio

    titulo          VARCHAR(500),
    descripcion     TEXT,
    severidad       VARCHAR(20) DEFAULT 'media',  -- baja/media/alta/critica

    entidad_tipo    VARCHAR(20),
    entidad_id      UUID,
    fuente_id       INTEGER REFERENCES osint.fuentes(id),
    dato_raw_id     UUID REFERENCES osint.datos_raw(id),
    datos_adicionales JSONB DEFAULT '{}',

    -- Workflow de revisión
    revisada        BOOLEAN DEFAULT FALSE,
    revisada_por    UUID REFERENCES auth.usuarios(id),
    revisada_at     TIMESTAMPTZ,
    accion_tomada   VARCHAR(50),
    -- ignorada/actualizado_expediente/abierta_investigacion/falso_positivo
    notas_revision  TEXT,

    nivel_acceso    SMALLINT DEFAULT 2,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_alertas_entidad   ON osint.alertas(entidad_tipo, entidad_id);
CREATE INDEX idx_alertas_revisada  ON osint.alertas(revisada) WHERE revisada = FALSE;
CREATE INDEX idx_alertas_severidad ON osint.alertas(severidad, created_at DESC);

-- ============================================================
-- BLOQUE 11: SCORING — REGLAS Y MODELOS
-- ============================================================

CREATE TABLE scoring.reglas (
    id              SERIAL PRIMARY KEY,
    nombre          VARCHAR(200) NOT NULL,
    descripcion     TEXT,
    tipo_entidad    VARCHAR(20) DEFAULT 'persona',
    -- Campo/condición que activa la regla
    campo           VARCHAR(100),
    condicion       VARCHAR(50),               -- equals/gt/lt/contains/not_null
    valor           TEXT,
    -- Peso de la regla en el score (negativo = reduce riesgo)
    peso            NUMERIC(4,3) NOT NULL,
    activa          BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Reglas base de scoring de riesgo para personas
INSERT INTO scoring.reglas (nombre, tipo_entidad, campo, condicion, valor, peso) VALUES
('Es PEP',                      'persona', 'es_pep',              'equals',   'true',  0.300),
('En lista de vigilancia',      'persona', 'en_lista_vigilancia', 'equals',   'true',  0.400),
('En lista OFAC',               'persona', 'listas_externas',     'contains', 'OFAC',  0.500),
('En lista UE sanciones',       'persona', 'listas_externas',     'contains', 'EU',    0.450),
('Patrimonio muy alto (>10M)',  'persona', 'patrimonio_est',       'gt',       '10000000', 0.100),
('PEP nivel 1 (nacional)',      'persona', 'nivel_pep',           'equals',   '1',     0.150),
('Alta prioridad de seguimiento','persona','nivel_prioridad',     'equals',   '5',     0.200),
('Empresa en vigilancia',       'institucion','en_lista_vigilancia','equals', 'true',  0.350),
('Empresa en sanción',          'institucion','listas_externas',  'not_null', '',      0.400);

CREATE TABLE scoring.historial_scores (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entidad_tipo    VARCHAR(20) NOT NULL,
    entidad_id      UUID NOT NULL,
    score_riesgo    NUMERIC(4,3) NOT NULL,
    score_influencia NUMERIC(4,3),
    reglas_aplicadas JSONB DEFAULT '[]',       -- [{regla_id, peso, condicion_met}]
    version         INTEGER NOT NULL,
    calculado_by    VARCHAR(50) DEFAULT 'rules_engine',
    -- rules_engine / ml_model_v1 / ml_model_v2 / etc.
    calculado_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_scores_entidad ON scoring.historial_scores(entidad_tipo, entidad_id, calculado_at DESC);

CREATE TABLE scoring.segmentos (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre          VARCHAR(200) NOT NULL,
    descripcion     TEXT,
    color_hex       CHAR(7) DEFAULT '#378ADD',
    criterios       JSONB NOT NULL,            -- reglas de clasificación
    automatico      BOOLEAN DEFAULT TRUE,
    activo          BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE scoring.entidad_segmento (
    entidad_tipo    VARCHAR(20) NOT NULL,
    entidad_id      UUID NOT NULL,
    segmento_id     UUID NOT NULL REFERENCES scoring.segmentos(id) ON DELETE CASCADE,
    score           NUMERIC(5,4),
    asignado_at     TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (entidad_tipo, entidad_id, segmento_id)
);

-- ============================================================
-- BLOQUE 12: AUDIT — TRAZABILIDAD TOTAL
-- ============================================================

-- Tabla particionada por mes para escalabilidad
CREATE TABLE audit.log_accesos (
    id              BIGSERIAL,
    usuario_id      UUID,
    sesion_id       UUID,
    accion          VARCHAR(50) NOT NULL,
    -- login/logout/view/create/update/delete/export/search/ai_query
    recurso_tipo    VARCHAR(50),
    recurso_id      UUID,
    recurso_desc    VARCHAR(255),
    ip_address      INET,
    user_agent      TEXT,
    endpoint        VARCHAR(255),
    metodo_http     VARCHAR(10),
    nivel_dato_accedido SMALLINT,
    duracion_ms     INTEGER,
    exito           BOOLEAN DEFAULT TRUE,
    razon_fallo     TEXT,
    datos_extra     JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW()
) PARTITION BY RANGE (created_at);

-- Particiones iniciales
CREATE TABLE audit.log_2026_q1 PARTITION OF audit.log_accesos
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
CREATE TABLE audit.log_2026_q2 PARTITION OF audit.log_accesos
    FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
CREATE TABLE audit.log_2026_q3 PARTITION OF audit.log_accesos
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
CREATE TABLE audit.log_2026_q4 PARTITION OF audit.log_accesos
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');
CREATE TABLE audit.log_2027    PARTITION OF audit.log_accesos
    FOR VALUES FROM ('2027-01-01') TO ('2028-01-01');

CREATE INDEX idx_log_usuario    ON audit.log_accesos(usuario_id, created_at DESC);
CREATE INDEX idx_log_recurso    ON audit.log_accesos(recurso_tipo, recurso_id);
CREATE INDEX idx_log_fecha      ON audit.log_accesos(created_at DESC);
CREATE INDEX idx_log_accion     ON audit.log_accesos(accion, created_at DESC);

-- Cambios campo por campo
CREATE TABLE audit.cambios_entidad (
    id              BIGSERIAL PRIMARY KEY,
    tabla_afectada  VARCHAR(100) NOT NULL,
    registro_id     UUID NOT NULL,
    operacion       CHAR(1) NOT NULL CHECK (operacion IN ('I','U','D')),
    campo           VARCHAR(100),
    valor_anterior  TEXT,
    valor_nuevo     TEXT,
    usuario_id      UUID,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cambios_registro ON audit.cambios_entidad(tabla_afectada, registro_id, created_at DESC);
CREATE INDEX idx_cambios_usuario  ON audit.cambios_entidad(usuario_id, created_at DESC);

-- ============================================================
-- BLOQUE 13: TRIGGERS DE AUDITORÍA
-- ============================================================

CREATE OR REPLACE FUNCTION audit.fn_registrar_cambio()
RETURNS TRIGGER AS $$
DECLARE
    v_usuario_id UUID;
    v_campo TEXT;
    v_old_val TEXT;
    v_new_val TEXT;
BEGIN
    -- Leer el usuario actual de la variable de sesión
    BEGIN
        v_usuario_id := current_setting('app.current_user_id', TRUE)::UUID;
    EXCEPTION WHEN OTHERS THEN
        v_usuario_id := NULL;
    END;

    IF TG_OP = 'INSERT' THEN
        INSERT INTO audit.cambios_entidad(tabla_afectada, registro_id, operacion, usuario_id)
        VALUES (TG_TABLE_SCHEMA||'.'||TG_TABLE_NAME, NEW.id, 'I', v_usuario_id);
        RETURN NEW;

    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO audit.cambios_entidad(tabla_afectada, registro_id, operacion, usuario_id)
        VALUES (TG_TABLE_SCHEMA||'.'||TG_TABLE_NAME, OLD.id, 'D', v_usuario_id);
        RETURN OLD;

    ELSIF TG_OP = 'UPDATE' THEN
        -- Registrar solo los campos que cambiaron
        FOR v_campo, v_old_val, v_new_val IN
            SELECT key,
                   (SELECT value FROM jsonb_each_text(to_jsonb(OLD)) WHERE key = e.key),
                   e.value
            FROM jsonb_each_text(to_jsonb(NEW)) e
            WHERE e.key NOT IN ('updated_at','updated_by','score_at','score_version')
        LOOP
            IF v_old_val IS DISTINCT FROM v_new_val THEN
                INSERT INTO audit.cambios_entidad(
                    tabla_afectada, registro_id, operacion,
                    campo, valor_anterior, valor_nuevo, usuario_id
                ) VALUES (
                    TG_TABLE_SCHEMA||'.'||TG_TABLE_NAME, NEW.id, 'U',
                    v_campo, v_old_val, v_new_val, v_usuario_id
                );
            END IF;
        END LOOP;
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Aplicar trigger a tablas principales
CREATE TRIGGER trg_audit_personas
    AFTER INSERT OR UPDATE OR DELETE ON core.personas
    FOR EACH ROW EXECUTE FUNCTION audit.fn_registrar_cambio();

CREATE TRIGGER trg_audit_instituciones
    AFTER INSERT OR UPDATE OR DELETE ON core.instituciones
    FOR EACH ROW EXECUTE FUNCTION audit.fn_registrar_cambio();

CREATE TRIGGER trg_audit_vinculos
    AFTER INSERT OR UPDATE OR DELETE ON intel.vinculos
    FOR EACH ROW EXECUTE FUNCTION audit.fn_registrar_cambio();

CREATE TRIGGER trg_audit_investigaciones
    AFTER INSERT OR UPDATE OR DELETE ON intel.investigaciones
    FOR EACH ROW EXECUTE FUNCTION audit.fn_registrar_cambio();

-- ============================================================
-- BLOQUE 14: ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE core.personas         ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.instituciones    ENABLE ROW LEVEL SECURITY;
ALTER TABLE intel.vinculos        ENABLE ROW LEVEL SECURITY;
ALTER TABLE intel.eventos         ENABLE ROW LEVEL SECURITY;
ALTER TABLE intel.investigaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE osint.alertas         ENABLE ROW LEVEL SECURITY;

-- Función helper: nivel de acceso del usuario de la sesión actual
CREATE OR REPLACE FUNCTION auth.mi_nivel()
RETURNS SMALLINT AS $$
    SELECT COALESCE(
        (SELECT u.nivel_acceso
         FROM auth.usuarios u
         WHERE u.id = NULLIF(current_setting('app.current_user_id', TRUE), '')::UUID
           AND u.activo = TRUE
           AND u.bloqueado = FALSE),
        0
    );
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- Función helper: usuario actual es admin?
CREATE OR REPLACE FUNCTION auth.es_admin()
RETURNS BOOLEAN AS $$
    SELECT COALESCE(
        (SELECT (r.permisos->>'admin')::BOOLEAN
         FROM auth.usuarios u
         JOIN auth.roles r ON u.rol_id = r.id
         WHERE u.id = NULLIF(current_setting('app.current_user_id', TRUE), '')::UUID
           AND u.activo = TRUE),
        FALSE
    );
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- Políticas personas
CREATE POLICY pol_personas_select ON core.personas
    FOR SELECT USING (
        deleted_at IS NULL
        AND auth.mi_nivel() >= nivel_acceso_requerido
    );
CREATE POLICY pol_personas_insert ON core.personas
    FOR INSERT WITH CHECK (auth.mi_nivel() >= 2);
CREATE POLICY pol_personas_update ON core.personas
    FOR UPDATE USING (
        auth.mi_nivel() >= nivel_acceso_requerido
        AND auth.mi_nivel() >= 2
    );
CREATE POLICY pol_personas_delete ON core.personas
    FOR DELETE USING (auth.es_admin() OR auth.mi_nivel() = 5);

-- Políticas instituciones
CREATE POLICY pol_inst_select ON core.instituciones
    FOR SELECT USING (
        deleted_at IS NULL
        AND auth.mi_nivel() >= nivel_acceso_requerido
    );
CREATE POLICY pol_inst_insert ON core.instituciones
    FOR INSERT WITH CHECK (auth.mi_nivel() >= 2);
CREATE POLICY pol_inst_update ON core.instituciones
    FOR UPDATE USING (auth.mi_nivel() >= 2);
CREATE POLICY pol_inst_delete ON core.instituciones
    FOR DELETE USING (auth.es_admin());

-- Políticas vínculos
CREATE POLICY pol_vinculos_select ON intel.vinculos
    FOR SELECT USING (auth.mi_nivel() >= nivel_acceso);
CREATE POLICY pol_vinculos_write ON intel.vinculos
    FOR ALL USING (auth.mi_nivel() >= 2);

-- Políticas investigaciones: solo el equipo asignado o admins
CREATE POLICY pol_inv_select ON intel.investigaciones
    FOR SELECT USING (
        auth.es_admin()
        OR responsable_id = NULLIF(current_setting('app.current_user_id', TRUE), '')::UUID
        OR NULLIF(current_setting('app.current_user_id', TRUE), '')::UUID = ANY(equipo)
        OR (clasificacion <= auth.mi_nivel())
    );
CREATE POLICY pol_inv_write ON intel.investigaciones
    FOR ALL USING (
        auth.es_admin()
        OR responsable_id = NULLIF(current_setting('app.current_user_id', TRUE), '')::UUID
    );

-- ============================================================
-- BLOQUE 15: FUNCIÓN DE BÚSQUEDA GLOBAL
-- ============================================================

CREATE OR REPLACE FUNCTION core.buscar(
    p_termino       TEXT,
    p_tipo          VARCHAR DEFAULT NULL,   -- 'persona' | 'institucion' | NULL
    p_limite        INTEGER DEFAULT 20,
    p_offset        INTEGER DEFAULT 0
)
RETURNS TABLE (
    tipo            VARCHAR,
    id              UUID,
    nombre          TEXT,
    subtitulo       TEXT,
    ciudad          TEXT,
    score_riesgo    NUMERIC,
    nivel_acceso_req SMALLINT,
    relevancia      REAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        'persona'::VARCHAR,
        p.id,
        p.nombre_completo::TEXT,
        COALESCE(p.cargo_actual || ' — ' || p.sector_principal, p.cargo_actual, p.sector_principal)::TEXT,
        p.ciudad_residencia::TEXT,
        p.score_riesgo,
        p.nivel_acceso_requerido,
        GREATEST(
            similarity(p.nombre_completo, p_termino),
            similarity(COALESCE(p.apellidos,''), p_termino)
        ) AS relevancia
    FROM core.personas p
    WHERE (p_tipo IS NULL OR p_tipo = 'persona')
      AND p.deleted_at IS NULL
      AND p.activo = TRUE
      AND (
          p.nombre_completo ILIKE '%' || p_termino || '%'
          OR p.apellidos    ILIKE '%' || p_termino || '%'
          OR p.email_principal ILIKE '%' || p_termino || '%'
          OR EXISTS (SELECT 1 FROM unnest(p.alias) a WHERE a ILIKE '%' || p_termino || '%')
          OR p.perfil_extendido::text ILIKE '%' || p_termino || '%'
      )

    UNION ALL

    SELECT
        'institucion'::VARCHAR,
        i.id,
        i.nombre::TEXT,
        COALESCE(i.sector || ' — ' || i.sede_pais, i.sector)::TEXT,
        i.sede_ciudad::TEXT,
        i.score_riesgo,
        i.nivel_acceso_requerido,
        similarity(i.nombre, p_termino) AS relevancia
    FROM core.instituciones i
    WHERE (p_tipo IS NULL OR p_tipo = 'institucion')
      AND i.deleted_at IS NULL
      AND i.activo = TRUE
      AND (
          i.nombre ILIKE '%' || p_termino || '%'
          OR EXISTS (SELECT 1 FROM unnest(i.alias) a WHERE a ILIKE '%' || p_termino || '%')
      )

    ORDER BY relevancia DESC, score_riesgo DESC
    LIMIT p_limite
    OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================
-- BLOQUE 16: FUNCIÓN DE SCORING POR REGLAS
-- ============================================================

CREATE OR REPLACE FUNCTION scoring.calcular_score_persona(p_id UUID)
RETURNS NUMERIC AS $$
DECLARE
    v_score     NUMERIC := 0.0;
    v_regla     RECORD;
    v_persona   core.personas;
    v_campo_val TEXT;
    v_activa    BOOLEAN;
BEGIN
    SELECT * INTO v_persona FROM core.personas WHERE id = p_id;
    IF NOT FOUND THEN RETURN 0.0; END IF;

    FOR v_regla IN
        SELECT * FROM scoring.reglas
        WHERE tipo_entidad = 'persona' AND activa = TRUE
    LOOP
        v_activa := FALSE;

        CASE v_regla.campo
            WHEN 'es_pep'              THEN v_activa := (v_persona.es_pep = TRUE AND v_regla.condicion = 'equals' AND v_regla.valor = 'true');
            WHEN 'en_lista_vigilancia' THEN v_activa := (v_persona.en_lista_vigilancia = TRUE AND v_regla.condicion = 'equals' AND v_regla.valor = 'true');
            WHEN 'nivel_pep'           THEN v_activa := (v_persona.nivel_pep::TEXT = v_regla.valor AND v_regla.condicion = 'equals');
            WHEN 'nivel_prioridad'     THEN v_activa := (v_persona.nivel_prioridad::TEXT = v_regla.valor AND v_regla.condicion = 'equals');
            WHEN 'listas_externas'     THEN v_activa := (v_regla.condicion = 'contains' AND v_persona.listas_externas @> ARRAY[v_regla.valor]);
            WHEN 'patrimonio_est'      THEN
                IF v_regla.condicion = 'gt' AND v_persona.patrimonio_est IS NOT NULL THEN
                    v_activa := v_persona.patrimonio_est > v_regla.valor::NUMERIC;
                END IF;
            ELSE NULL;
        END CASE;

        IF v_activa THEN
            v_score := v_score + v_regla.peso;
        END IF;
    END LOOP;

    -- Clamp entre 0 y 1
    v_score := GREATEST(0.0, LEAST(1.0, v_score));

    -- Actualizar el registro y guardar historial
    UPDATE core.personas SET
        score_riesgo  = v_score,
        score_version = score_version + 1,
        score_at      = NOW()
    WHERE id = p_id;

    INSERT INTO scoring.historial_scores(entidad_tipo, entidad_id, score_riesgo, version, calculado_by)
    VALUES ('persona', p_id, v_score, (SELECT score_version FROM core.personas WHERE id = p_id), 'rules_engine');

    RETURN v_score;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- BLOQUE 17: TRIGGER UPDATED_AT AUTOMÁTICO
-- ============================================================

CREATE OR REPLACE FUNCTION core.fn_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_upd_personas
    BEFORE UPDATE ON core.personas
    FOR EACH ROW EXECUTE FUNCTION core.fn_set_updated_at();

CREATE TRIGGER trg_upd_instituciones
    BEFORE UPDATE ON core.instituciones
    FOR EACH ROW EXECUTE FUNCTION core.fn_set_updated_at();

CREATE TRIGGER trg_upd_vinculos
    BEFORE UPDATE ON intel.vinculos
    FOR EACH ROW EXECUTE FUNCTION core.fn_set_updated_at();

CREATE TRIGGER trg_upd_investigaciones
    BEFORE UPDATE ON intel.investigaciones
    FOR EACH ROW EXECUTE FUNCTION core.fn_set_updated_at();

-- ============================================================
-- BLOQUE 18: VISTAS DE CONSULTA
-- ============================================================

-- Vista personas con score y completitud (RLS se aplica automáticamente)
CREATE VIEW core.v_personas AS
SELECT
    p.*,
    i.nombre    AS empresa_nombre,
    i.sector    AS empresa_sector,
    c.nombre_es AS pais_residencia_nombre,
    -- Cálculo de completitud inline
    (
        (CASE WHEN p.nombres          IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN p.apellidos        IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN p.fecha_nacimiento IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN p.nacionalidad     IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN p.email_principal  IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN p.telefono_principal IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN p.pais_residencia  IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN p.cargo_actual     IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN p.empresa_actual   IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN p.ubicacion_actual IS NOT NULL THEN 1 ELSE 0 END)
    ) * 10.0 AS completitud_calculada
FROM core.personas p
LEFT JOIN core.instituciones i ON p.empresa_actual = i.id
LEFT JOIN core.paises c ON p.pais_residencia = c.codigo
WHERE p.deleted_at IS NULL AND p.activo = TRUE;

-- Vista de alertas sin revisar para el panel
CREATE VIEW osint.v_alertas_pendientes AS
SELECT
    a.*,
    f.nombre AS fuente_nombre
FROM osint.alertas a
LEFT JOIN osint.fuentes f ON a.fuente_id = f.id
WHERE a.revisada = FALSE
ORDER BY
    CASE a.severidad
        WHEN 'critica' THEN 1
        WHEN 'alta'    THEN 2
        WHEN 'media'   THEN 3
        WHEN 'baja'    THEN 4
        ELSE 5
    END,
    a.created_at DESC;

-- Vista de grafo para queries rápidas
CREATE VIEW intel.v_grafo AS
SELECT
    v.id,
    v.origen_tipo,
    v.origen_id,
    CASE v.origen_tipo
        WHEN 'persona'     THEN (SELECT nombre_completo FROM core.personas WHERE id = v.origen_id)
        WHEN 'institucion' THEN (SELECT nombre FROM core.instituciones WHERE id = v.origen_id)
    END AS origen_nombre,
    v.destino_tipo,
    v.destino_id,
    CASE v.destino_tipo
        WHEN 'persona'     THEN (SELECT nombre_completo FROM core.personas WHERE id = v.destino_id)
        WHEN 'institucion' THEN (SELECT nombre FROM core.instituciones WHERE id = v.destino_id)
    END AS destino_nombre,
    tv.nombre   AS tipo_vinculo_nombre,
    tv.categoria AS tipo_vinculo_categoria,
    v.intensidad,
    v.vigente,
    v.fecha_inicio,
    v.fecha_fin
FROM intel.vinculos v
LEFT JOIN core.tipos_vinculo tv ON v.tipo_vinculo_id = tv.id
WHERE v.vigente = TRUE;

-- ============================================================
-- FIN DEL ESQUEMA
-- Tablas: 25 | Índices: 40+ | Triggers: 8 | Funciones: 7
-- RLS habilitado en: 6 tablas
-- ============================================================
