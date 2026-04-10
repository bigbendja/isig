# pipeline/core/db.py
# ============================================================
# Cliente de base de datos para el pipeline OSINT
# Operaciones de escritura: datos raw, alertas, enriquecimiento
# ============================================================
import json
import uuid
from datetime import datetime
from typing import Any

import asyncpg
import structlog

from pipeline.core.config import config

log = structlog.get_logger()

_pool: asyncpg.Pool | None = None


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            config.postgres_url,
            min_size=2,
            max_size=10,
            command_timeout=30,
        )
    return _pool


async def close_pool():
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


# ── DATOS RAW ─────────────────────────────────────────────────

async def insertar_dato_raw(
    fuente_id: int,
    ejecucion_id: str,
    contenido_raw: dict,
    contenido_norm: dict | None = None,
    url_origen: str | None = None,
    confianza_ext: float = 0.5,
) -> str:
    """Inserta un dato en el buffer raw para procesamiento posterior."""
    pool = await get_pool()
    dato_id = str(uuid.uuid4())

    await pool.execute("""
        INSERT INTO osint.datos_raw
            (id, fuente_id, ejecucion_id, url_origen,
             contenido_raw, contenido_norm, confianza_ext, estado)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, 'pendiente')
    """,
        dato_id, fuente_id, ejecucion_id, url_origen,
        json.dumps(contenido_raw, ensure_ascii=False, default=str),
        json.dumps(contenido_norm or {}, ensure_ascii=False, default=str),
        confianza_ext,
    )
    return dato_id


async def marcar_dato_procesado(dato_id: str, entidad_tipo: str, entidad_id: str):
    pool = await get_pool()
    await pool.execute("""
        UPDATE osint.datos_raw
        SET estado = 'procesado',
            entidad_tipo = $2,
            entidad_id = $3,
            procesado_at = NOW()
        WHERE id = $1
    """, dato_id, entidad_tipo, entidad_id)


async def marcar_dato_error(dato_id: str, error: str):
    pool = await get_pool()
    await pool.execute("""
        UPDATE osint.datos_raw
        SET estado = 'error',
            requiere_revision = TRUE,
            procesado_at = NOW()
        WHERE id = $1
    """, dato_id)


# ── EJECUCIONES ───────────────────────────────────────────────

async def iniciar_ejecucion(fuente_id: int, trigger: str = 'schedule') -> str:
    pool = await get_pool()
    eje_id = str(uuid.uuid4())
    await pool.execute("""
        INSERT INTO osint.ejecuciones
            (id, fuente_id, trigger_tipo, estado)
        VALUES ($1, $2, $3, 'en_curso')
    """, eje_id, fuente_id, trigger)

    # Actualizar estado de la fuente
    await pool.execute("""
        UPDATE osint.fuentes
        SET ultima_ejecucion = NOW(), ultimo_estado = 'en_curso', total_runs = total_runs + 1
        WHERE id = $1
    """, fuente_id)

    return eje_id


async def finalizar_ejecucion(
    ejecucion_id: str,
    fuente_id: int,
    nuevos: int,
    actualizados: int,
    descartados: int,
    errores: list[str] | None = None,
    estado: str = 'ok',
):
    pool = await get_pool()
    await pool.execute("""
        UPDATE osint.ejecuciones
        SET fin = NOW(),
            estado = $2,
            registros_nuevos = $3,
            registros_actualizados = $4,
            registros_descartados = $5,
            registros_error = $6,
            errores = $7::jsonb
        WHERE id = $1
    """,
        ejecucion_id, estado, nuevos, actualizados, descartados,
        len(errores or []),
        json.dumps(errores or []),
    )
    await pool.execute("""
        UPDATE osint.fuentes
        SET ultimo_estado = $2,
            total_registros = total_registros + $3,
            registros_hoy = registros_hoy + $3,
            ultimo_error = $4
        WHERE id = $1
    """,
        fuente_id, estado, nuevos,
        errores[0] if errores else None,
    )


# ── ENTIDADES ─────────────────────────────────────────────────

async def buscar_persona_similar(nombre: str, umbral: float = 0.7) -> dict | None:
    """Busca una persona por similitud de nombre (fuzzy). Evita duplicados."""
    pool = await get_pool()
    row = await pool.fetchrow("""
        SELECT id, nombre_completo,
               similarity(nombre_completo, $1) AS sim
        FROM core.personas
        WHERE deleted_at IS NULL
          AND similarity(nombre_completo, $1) >= $2
        ORDER BY sim DESC
        LIMIT 1
    """, nombre, umbral)
    return dict(row) if row else None


async def buscar_institucion_similar(nombre: str, umbral: float = 0.75) -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow("""
        SELECT id, nombre,
               similarity(nombre, $1) AS sim
        FROM core.instituciones
        WHERE deleted_at IS NULL
          AND similarity(nombre, $1) >= $2
        ORDER BY sim DESC
        LIMIT 1
    """, nombre, umbral)
    return dict(row) if row else None


async def crear_persona_borrador(datos: dict) -> str:
    """Crea una persona con datos mínimos y la marca como borrador."""
    pool = await get_pool()
    persona_id = str(uuid.uuid4())
    await pool.execute("""
        INSERT INTO core.personas
            (id, nombre_completo, nombres, apellidos,
             fuente_primaria, nivel_acceso_requerido,
             perfil_extendido)
        VALUES ($1, $2, $3, $4, $5, 1, $6::jsonb)
        ON CONFLICT DO NOTHING
    """,
        persona_id,
        datos.get('nombre_completo', ''),
        datos.get('nombres'),
        datos.get('apellidos'),
        datos.get('fuente', 'OSINT'),
        json.dumps(datos.get('extendido', {}), default=str),
    )
    return persona_id


async def enriquecer_persona(
    persona_id: str,
    campo: str,
    valor: Any,
    fuente: str,
    confianza: int = 3,
):
    """
    Añade o actualiza un campo en perfil_extendido con metadatos de calidad.
    No sobreescribe campos con confianza mayor.
    """
    pool = await get_pool()

    # Leer confianza actual del campo si existe
    row = await pool.fetchrow("""
        SELECT perfil_extendido->>$2 AS campo_actual
        FROM core.personas WHERE id = $1
    """, persona_id, campo)

    if row and row['campo_actual']:
        try:
            actual = json.loads(row['campo_actual'])
            if actual.get('confianza', 0) >= confianza:
                return  # No sobreescribir con dato de menor confianza
        except Exception:
            pass

    valor_con_meta = {
        "valor":     valor,
        "fuente":    fuente,
        "fecha":     datetime.now().strftime('%Y-%m'),
        "confianza": confianza,
        "verificado": False,
    }

    await pool.execute("""
        UPDATE core.personas
        SET perfil_extendido = jsonb_set(
            COALESCE(perfil_extendido, '{}'),
            $2::text[],
            $3::jsonb,
            true
        ),
        updated_at = NOW()
        WHERE id = $1
    """,
        persona_id,
        [campo],
        json.dumps(valor_con_meta, default=str),
    )


async def enriquecer_institucion(
    inst_id: str,
    campo: str,
    valor: Any,
    fuente: str,
    confianza: int = 3,
):
    """Igual que enriquecer_persona pero para instituciones."""
    pool = await get_pool()
    valor_con_meta = {
        "valor": valor, "fuente": fuente,
        "fecha": datetime.now().strftime('%Y-%m'),
        "confianza": confianza, "verificado": False,
    }
    await pool.execute("""
        UPDATE core.instituciones
        SET perfil_extendido = jsonb_set(
            COALESCE(perfil_extendido, '{}'), $2::text[], $3::jsonb, true
        ), updated_at = NOW()
        WHERE id = $1
    """, inst_id, [campo], json.dumps(valor_con_meta, default=str))


# ── ALERTAS ───────────────────────────────────────────────────

async def crear_alerta(
    tipo_alerta: str,
    titulo: str,
    descripcion: str = '',
    severidad: str = 'media',
    entidad_tipo: str | None = None,
    entidad_id: str | None = None,
    fuente_id: int | None = None,
    dato_raw_id: str | None = None,
    datos_adicionales: dict | None = None,
):
    pool = await get_pool()
    alerta_id = str(uuid.uuid4())
    await pool.execute("""
        INSERT INTO osint.alertas
            (id, tipo_alerta, titulo, descripcion, severidad,
             entidad_tipo, entidad_id, fuente_id, dato_raw_id, datos_adicionales)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
    """,
        alerta_id, tipo_alerta, titulo, descripcion, severidad,
        entidad_tipo, entidad_id, fuente_id, dato_raw_id,
        json.dumps(datos_adicionales or {}),
    )
    log.info("Alerta creada", tipo=tipo_alerta, severidad=severidad, titulo=titulo)
    return alerta_id


# ── LISTAS DE SANCIONES ───────────────────────────────────────

async def verificar_en_listas(nombre: str) -> list[str]:
    """
    Verifica si un nombre aparece en las listas de sanciones
    almacenadas en la BD (tabla auxiliar sanctions_lists).
    """
    pool = await get_pool()
    rows = await pool.fetch("""
        SELECT lista FROM osint.sanctions_cache
        WHERE lower(nombre) % lower($1)
          AND similarity(lower(nombre), lower($1)) >= 0.8
        LIMIT 5
    """, nombre)
    return [r['lista'] for r in rows] if rows else []
