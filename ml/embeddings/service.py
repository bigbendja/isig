# ml/embeddings/service.py
# ============================================================
# Búsqueda semántica con embeddings y pgvector
# Genera y almacena vectores de texto para búsqueda por similitud
# ============================================================
import json
from typing import Any

import asyncpg
import httpx
import numpy as np
import structlog

log = structlog.get_logger()

OLLAMA_URL   = "http://localhost:11434"
EMBED_MODEL  = "nomic-embed-text"
VECTOR_DIM   = 768       # dimensión de nomic-embed-text


# ── GENERACIÓN DE EMBEDDINGS ──────────────────────────────────

async def generar_embedding(texto: str) -> list[float] | None:
    """Genera un embedding de texto vía Ollama."""
    if not texto or not texto.strip():
        return None
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                f"{OLLAMA_URL}/api/embeddings",
                json={"model": EMBED_MODEL, "prompt": texto[:2000]},
            )
            r.raise_for_status()
            return r.json().get("embedding")
    except Exception as e:
        log.warning("Error generando embedding", error=str(e))
        return None


def texto_para_persona(row: dict) -> str:
    """Construye el texto representativo de una persona para el embedding."""
    partes = [
        row.get('nombre_completo', ''),
        row.get('cargo_actual', ''),
        row.get('sector_principal', ''),
        row.get('ciudad_residencia', ''),
        row.get('pais_residencia', ''),
    ]
    ext = row.get('perfil_extendido') or {}
    if isinstance(ext, str):
        try:
            ext = json.loads(ext)
        except Exception:
            ext = {}

    for campo, meta in ext.items():
        if isinstance(meta, dict) and meta.get('valor'):
            partes.append(f"{campo}: {meta['valor']}")

    return ' '.join(filter(None, partes))[:1500]


def texto_para_institucion(row: dict) -> str:
    """Construye el texto representativo de una institución."""
    partes = [
        row.get('nombre', ''),
        row.get('sector', ''),
        row.get('actividad_desc', ''),
        row.get('sede_ciudad', ''),
        row.get('pais_registro', ''),
    ]
    return ' '.join(filter(None, partes))[:1500]


# ── INDEXACIÓN ────────────────────────────────────────────────

async def indexar_entidades(
    pool: asyncpg.Pool,
    tipo: str = 'persona',
    limite: int = 500,
) -> dict[str, Any]:
    """
    Genera embeddings para todas las entidades y los almacena en PostgreSQL
    usando la extensión pgvector.
    Requiere: CREATE EXTENSION IF NOT EXISTS vector;
    """
    tabla    = "personas" if tipo == 'persona' else "instituciones"
    txt_fn   = texto_para_persona if tipo == 'persona' else texto_para_institucion

    # Verificar que pgvector esté instalado
    ext_check = await pool.fetchval(
        "SELECT COUNT(*) FROM pg_extension WHERE extname = 'vector'"
    )
    if not ext_check:
        return {
            "error":  "pgvector no instalado. Ejecuta: CREATE EXTENSION IF NOT EXISTS vector;",
            "accion": "Instala pgvector en PostgreSQL y ejecuta la migración 003."
        }

    # Cargar entidades sin embedding o con embedding antiguo
    rows = await pool.fetch(f"""
        SELECT p.*
        FROM core.{tabla} p
        WHERE p.deleted_at IS NULL
          AND p.activo = TRUE
          AND (
              NOT EXISTS (
                  SELECT 1 FROM ml.entity_embeddings e
                  WHERE e.entity_id = p.id AND e.entity_type = $1
              )
              OR EXISTS (
                  SELECT 1 FROM ml.entity_embeddings e
                  WHERE e.entity_id = p.id AND e.entity_type = $1
                    AND e.updated_at < p.updated_at
              )
          )
        LIMIT $2
    """, tipo, limite)

    if not rows:
        return {"tipo": tipo, "indexadas": 0, "message": "Todos los embeddings están actualizados"}

    indexadas = 0
    errores   = 0

    for row in rows:
        try:
            texto    = txt_fn(dict(row))
            embedding = await generar_embedding(texto)

            if embedding is None:
                errores += 1
                continue

            # Guardar embedding en tabla de ML
            await pool.execute("""
                INSERT INTO ml.entity_embeddings
                    (entity_id, entity_type, embedding, texto_base, updated_at)
                VALUES ($1::uuid, $2, $3::vector, $4, NOW())
                ON CONFLICT (entity_id, entity_type)
                DO UPDATE SET
                    embedding   = EXCLUDED.embedding,
                    texto_base  = EXCLUDED.texto_base,
                    updated_at  = NOW()
            """, str(row['id']), tipo, str(embedding), texto[:500])

            indexadas += 1

        except Exception as e:
            log.warning("Error indexando entidad", id=str(row['id']), error=str(e))
            errores += 1

    log.info("Indexación completada", tipo=tipo, indexadas=indexadas, errores=errores)
    return {"tipo": tipo, "indexadas": indexadas, "errores": errores}


# ── BÚSQUEDA SEMÁNTICA ────────────────────────────────────────

async def buscar_semantico(
    pool: asyncpg.Pool,
    query: str,
    tipo: str | None = None,
    limite: int = 10,
    nivel_acceso: int = 1,
) -> list[dict[str, Any]]:
    """
    Busca entidades por similitud semántica del texto.
    Más preciso que búsqueda por texto exacto para nombres con variaciones,
    descripciones en lenguaje natural, o búsquedas conceptuales.
    """
    embedding = await generar_embedding(query)
    if embedding is None:
        return []

    tipo_filter = "AND e.entity_type = $3" if tipo else ""
    params      = [str(embedding), limite, tipo] if tipo else [str(embedding), limite]

    result = await pool.fetch(f"""
        SELECT
            e.entity_id,
            e.entity_type,
            e.texto_base,
            1 - (e.embedding <=> $1::vector) AS similitud
        FROM ml.entity_embeddings e
        WHERE 1 - (e.embedding <=> $1::vector) > 0.6
          {tipo_filter}
        ORDER BY e.embedding <=> $1::vector
        LIMIT $2
    """, *params)

    resultados = []
    for row in result:
        # Cargar datos básicos de la entidad
        tabla = "personas" if row['entity_type'] == 'persona' else "instituciones"
        campo_nombre = "nombre_completo" if row['entity_type'] == 'persona' else "nombre"
        entidad = await pool.fetchrow(f"""
            SELECT id, {campo_nombre} AS nombre, score_riesgo, nivel_acceso_requerido
            FROM core.{tabla}
            WHERE id = $1::uuid AND nivel_acceso_requerido <= $2
        """, str(row['entity_id']), nivel_acceso)

        if entidad:
            resultados.append({
                "id":          str(entidad['id']),
                "tipo":        row['entity_type'],
                "nombre":      entidad['nombre'],
                "score_riesgo": float(entidad['score_riesgo'] or 0),
                "similitud":   round(float(row['similitud']), 4),
                "extracto":    row['texto_base'][:150] + "...",
            })

    return resultados
