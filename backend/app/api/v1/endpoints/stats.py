# app/api/v1/endpoints/stats.py
# ============================================================
# Estadísticas globales para el panel de overview
# ============================================================
from fastapi import APIRouter, Depends
from sqlalchemy import text
import structlog

from app.api.dependencies import CurrentUser, get_current_user, get_db_session, require_nivel
from sqlalchemy.ext.asyncio import AsyncSession

log = structlog.get_logger()
router = APIRouter(prefix="/stats", tags=["Estadísticas"])


@router.get("/overview")
async def overview(db: AsyncSession = Depends(get_db_session), current_user: CurrentUser = Depends(get_current_user)):
    """
    Métricas globales del sistema.
    Cacheadas en Redis por 60s para no saturar la BD.
    """
    from app.core.database import get_redis_cache
    import json

    redis = get_redis_cache()
    cache_key = f"stats:overview:u{current_user.nivel_acceso}"

    # Intentar desde caché
    cached = await redis.get(cache_key)
    if cached:
        return json.loads(cached)

    # Calcular desde BD
    result = await db.execute(text("""
        SELECT
            (SELECT COUNT(*) FROM core.personas
             WHERE deleted_at IS NULL AND activo = TRUE)                    AS total_personas,
            (SELECT COUNT(*) FROM core.instituciones
             WHERE deleted_at IS NULL AND activo = TRUE)                    AS total_instituciones,
            (SELECT COUNT(*) FROM intel.vinculos WHERE vigente = TRUE)      AS total_vinculos,
            (SELECT COUNT(*) FROM osint.alertas WHERE revisada = FALSE)     AS alertas_pendientes,
            (SELECT ROUND(AVG(score_riesgo)::numeric, 3)
             FROM core.personas WHERE deleted_at IS NULL AND activo = TRUE) AS score_medio_riesgo,
            (SELECT COUNT(*) FROM core.personas
             WHERE created_at >= NOW() - INTERVAL '24 hours'
               AND deleted_at IS NULL)                                      AS registros_hoy,
            (SELECT COUNT(*) FROM intel.investigaciones
             WHERE estado IN ('abierta','en_curso'))                        AS investigaciones_activas,
            (SELECT COUNT(*) FROM core.personas
             WHERE en_lista_vigilancia = TRUE AND deleted_at IS NULL)       AS en_vigilancia
    """))
    row = result.fetchone()

    data = {
        "total_personas":           int(row.total_personas or 0),
        "total_instituciones":      int(row.total_instituciones or 0),
        "total_vinculos":           int(row.total_vinculos or 0),
        "alertas_pendientes":       int(row.alertas_pendientes or 0),
        "score_medio_riesgo":       float(row.score_medio_riesgo or 0),
        "registros_hoy":            int(row.registros_hoy or 0),
        "investigaciones_activas":  int(row.investigaciones_activas or 0),
        "en_vigilancia":            int(row.en_vigilancia or 0),
    }

    # Guardar en caché 60 segundos
    await redis.setex(cache_key, 60, json.dumps(data))
    return data


@router.get("/distribucion-riesgo")
async def distribucion_riesgo(db: AsyncSession = Depends(get_db_session), current_user: CurrentUser = Depends(get_current_user)):
    """Distribución de scores de riesgo para gráficos."""
    result = await db.execute(text("""
        SELECT
            CASE
                WHEN score_riesgo < 0.10 THEN 'sin_riesgo'
                WHEN score_riesgo < 0.30 THEN 'bajo'
                WHEN score_riesgo < 0.50 THEN 'medio'
                WHEN score_riesgo < 0.75 THEN 'alto'
                ELSE 'critico'
            END AS nivel,
            COUNT(*) AS cantidad
        FROM core.personas
        WHERE deleted_at IS NULL AND activo = TRUE
        GROUP BY 1
        ORDER BY MIN(score_riesgo)
    """))
    return [{"nivel": r.nivel, "cantidad": int(r.cantidad)} for r in result.fetchall()]


@router.get("/top-riesgo")
async def top_riesgo(
    limite: int = 10,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Top N entidades por score de riesgo."""
    result = await db.execute(text("""
        SELECT 'persona' AS tipo, id, nombre_completo AS nombre,
               score_riesgo, ciudad_residencia AS ciudad, pais_residencia AS pais
        FROM core.personas
        WHERE deleted_at IS NULL AND activo = TRUE AND score_riesgo > 0
        UNION ALL
        SELECT 'institucion', id, nombre, score_riesgo, sede_ciudad, sede_pais
        FROM core.instituciones
        WHERE deleted_at IS NULL AND activo = TRUE AND score_riesgo > 0
        ORDER BY score_riesgo DESC
        LIMIT :limite
    """), {"limite": limite})
    return [dict(r._mapping) for r in result.fetchall()]


@router.get("/personas-kpis")
async def personas_kpis(
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    """KPIs y rankings específicos de personas."""
    result = await db.execute(text("""
        SELECT
            (SELECT COUNT(*) FROM core.personas WHERE deleted_at IS NULL AND activo = TRUE) AS total,
            (SELECT COUNT(*) FROM core.personas WHERE deleted_at IS NULL AND activo = TRUE AND en_lista_vigilancia = TRUE) AS en_vigilancia,
            (SELECT COUNT(*) FROM core.personas WHERE deleted_at IS NULL AND activo = TRUE AND es_pep = TRUE) AS pep,
            (SELECT ROUND(AVG(score_riesgo)::numeric, 3) FROM core.personas WHERE deleted_at IS NULL AND activo = TRUE) AS score_medio
    """))
    row = result.fetchone()

    # Top 5 por riesgo
    top_riesgo = await db.execute(text("""
        SELECT id, nombre_completo, score_riesgo, cargo_actual, pais_residencia
        FROM core.personas WHERE deleted_at IS NULL AND activo = TRUE AND score_riesgo > 0
        ORDER BY score_riesgo DESC LIMIT 5
    """))

    # Top 5 por prioridad
    top_prioridad = await db.execute(text("""
        SELECT id, nombre_completo, nivel_prioridad, cargo_actual, score_riesgo
        FROM core.personas WHERE deleted_at IS NULL AND activo = TRUE
        ORDER BY nivel_prioridad DESC, score_riesgo DESC LIMIT 5
    """))

    # Últimas añadidas
    ultimas = await db.execute(text("""
        SELECT id, nombre_completo, created_at, cargo_actual, score_riesgo
        FROM core.personas WHERE deleted_at IS NULL AND activo = TRUE
        ORDER BY created_at DESC LIMIT 5
    """))

    # "En el radar" - personas que requieren atención:
    # score subió en los últimos 7 días, o en vigilancia con vínculos recientes,
    # o tienen score alto sin haber sido revisadas recientemente
    radar = await db.execute(text("""
        SELECT p.id, p.nombre_completo, p.score_riesgo, p.cargo_actual,
               p.en_lista_vigilancia, p.es_pep,
               CASE
                   WHEN p.score_riesgo >= 0.75 THEN 'Score crítico'
                   WHEN p.en_lista_vigilancia AND p.score_riesgo >= 0.5 THEN 'Vigilancia + riesgo alto'
                   WHEN p.es_pep AND p.score_riesgo >= 0.4 THEN 'PEP con riesgo elevado'
                   WHEN (SELECT COUNT(*) FROM intel.vinculos v
                         WHERE (v.origen_id = p.id OR v.destino_id = p.id)
                         AND v.created_at >= NOW() - INTERVAL '7 days') > 0 THEN 'Vínculos recientes'
                   ELSE 'Requiere revisión'
               END AS razon
        FROM core.personas p
        WHERE p.deleted_at IS NULL AND p.activo = TRUE
        AND (
            p.score_riesgo >= 0.6
            OR (p.en_lista_vigilancia = TRUE AND p.score_riesgo >= 0.4)
            OR (p.es_pep = TRUE AND p.score_riesgo >= 0.4)
            OR EXISTS (
                SELECT 1 FROM intel.vinculos v
                WHERE (v.origen_id = p.id OR v.destino_id = p.id)
                AND v.created_at >= NOW() - INTERVAL '7 days'
            )
        )
        ORDER BY p.score_riesgo DESC LIMIT 5
    """))

    return {
        "kpis": {
            "total": int(row.total or 0),
            "en_vigilancia": int(row.en_vigilancia or 0),
            "pep": int(row.pep or 0),
            "score_medio": float(row.score_medio or 0),
        },
        "top_riesgo": [dict(r._mapping) for r in top_riesgo.fetchall()],
        "top_prioridad": [dict(r._mapping) for r in top_prioridad.fetchall()],
        "ultimas": [dict(r._mapping) for r in ultimas.fetchall()],
        "en_el_radar": [dict(r._mapping) for r in radar.fetchall()],
    }


@router.get("/instituciones-kpis")
async def instituciones_kpis(
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    """KPIs y rankings específicos de instituciones."""
    result = await db.execute(text("""
        SELECT
            (SELECT COUNT(*) FROM core.instituciones WHERE deleted_at IS NULL AND activo = TRUE) AS total,
            (SELECT COUNT(*) FROM core.instituciones WHERE deleted_at IS NULL AND activo = TRUE AND en_lista_vigilancia = TRUE) AS en_vigilancia,
            (SELECT COUNT(DISTINCT origen_id) FROM intel.vinculos WHERE vigente = TRUE AND origen_tipo = 'institucion') +
            (SELECT COUNT(DISTINCT destino_id) FROM intel.vinculos WHERE vigente = TRUE AND destino_tipo = 'institucion') AS con_vinculos,
            (SELECT ROUND(AVG(score_riesgo)::numeric, 3) FROM core.instituciones WHERE deleted_at IS NULL AND activo = TRUE) AS score_medio
    """))
    row = result.fetchone()

    top_riesgo = await db.execute(text("""
        SELECT id, nombre, score_riesgo, sector, pais_registro
        FROM core.instituciones WHERE deleted_at IS NULL AND activo = TRUE AND score_riesgo > 0
        ORDER BY score_riesgo DESC LIMIT 5
    """))

    mas_vinculadas = await db.execute(text("""
        SELECT i.id, i.nombre, i.sector, i.score_riesgo,
               COUNT(v.id) as total_vinculos
        FROM core.instituciones i
        LEFT JOIN intel.vinculos v ON (v.origen_id = i.id OR v.destino_id = i.id) AND v.vigente = TRUE
        WHERE i.deleted_at IS NULL AND i.activo = TRUE
        GROUP BY i.id, i.nombre, i.sector, i.score_riesgo
        ORDER BY total_vinculos DESC, i.score_riesgo DESC LIMIT 5
    """))

    radar = await db.execute(text("""
        SELECT i.id, i.nombre, i.score_riesgo, i.sector, i.en_lista_vigilancia,
               CASE
                   WHEN i.score_riesgo >= 0.75 THEN 'Score crítico'
                   WHEN i.en_lista_vigilancia AND i.score_riesgo >= 0.5 THEN 'Vigilancia + riesgo alto'
                   WHEN (SELECT COUNT(*) FROM intel.vinculos v
                         WHERE (v.origen_id = i.id OR v.destino_id = i.id)
                         AND v.created_at >= NOW() - INTERVAL '7 days') > 0 THEN 'Vínculos recientes'
                   ELSE 'Requiere revisión'
               END AS razon
        FROM core.instituciones i
        WHERE i.deleted_at IS NULL AND i.activo = TRUE
        AND (
            i.score_riesgo >= 0.6
            OR (i.en_lista_vigilancia = TRUE AND i.score_riesgo >= 0.4)
            OR EXISTS (
                SELECT 1 FROM intel.vinculos v
                WHERE (v.origen_id = i.id OR v.destino_id = i.id)
                AND v.created_at >= NOW() - INTERVAL '7 days'
            )
        )
        ORDER BY i.score_riesgo DESC LIMIT 5
    """))

    return {
        "kpis": {
            "total": int(row.total or 0),
            "en_vigilancia": int(row.en_vigilancia or 0),
            "con_vinculos": int(row.con_vinculos or 0),
            "score_medio": float(row.score_medio or 0),
        },
        "top_riesgo": [dict(r._mapping) for r in top_riesgo.fetchall()],
        "mas_vinculadas": [dict(r._mapping) for r in mas_vinculadas.fetchall()],
        "en_el_radar": [dict(r._mapping) for r in radar.fetchall()],
    }
