# app/api/v1/endpoints/ml.py
# Analytics endpoints — datos reales de PostgreSQL (sin ML externo por ahora)
from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.dependencies import CurrentUser, get_current_user, get_db_session

router = APIRouter(prefix="/ml", tags=["Analytics / ML"])


@router.get("/stats")
async def ml_stats(
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Estadísticas globales para Analytics."""
    result = await db.execute(text("""
        SELECT
            (SELECT COUNT(*) FROM core.personas WHERE deleted_at IS NULL AND activo = TRUE) AS total_personas,
            (SELECT COUNT(*) FROM core.instituciones WHERE deleted_at IS NULL AND activo = TRUE) AS total_instituciones,
            (SELECT COUNT(*) FROM intel.vinculos WHERE vigente = TRUE) AS total_vinculos,
            (SELECT ROUND(AVG(score_riesgo)::numeric, 3) FROM core.personas WHERE deleted_at IS NULL AND activo = TRUE) AS score_medio_personas,
            (SELECT ROUND(AVG(score_riesgo)::numeric, 3) FROM core.instituciones WHERE deleted_at IS NULL AND activo = TRUE) AS score_medio_instituciones,
            (SELECT COUNT(*) FROM core.personas WHERE deleted_at IS NULL AND activo = TRUE AND es_pep = TRUE) AS total_pep,
            (SELECT COUNT(*) FROM core.personas WHERE deleted_at IS NULL AND activo = TRUE AND en_lista_vigilancia = TRUE) AS en_vigilancia,
            (SELECT COUNT(*) FROM osint.alertas WHERE revisada = FALSE) AS alertas_pendientes
    """))
    row = dict(result.fetchone()._mapping)
    return {k: float(v) if v is not None else 0 for k, v in row.items()}


@router.get("/distribucion")
async def distribucion_riesgo(
    tipo: str = Query("persona", pattern="^(persona|institucion)$"),
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Distribución de scores de riesgo por rangos."""
    table = "core.personas" if tipo == "persona" else "core.instituciones"
    result = await db.execute(text(f"""
        SELECT
            CASE
                WHEN score_riesgo < 0.10 THEN 'Sin riesgo'
                WHEN score_riesgo < 0.30 THEN 'Bajo'
                WHEN score_riesgo < 0.50 THEN 'Medio'
                WHEN score_riesgo < 0.75 THEN 'Alto'
                ELSE 'Crítico'
            END AS nivel,
            COUNT(*) AS cantidad,
            ROUND(AVG(score_riesgo)::numeric, 3) AS score_medio
        FROM {table}
        WHERE deleted_at IS NULL AND activo = TRUE
        GROUP BY 1
        ORDER BY MIN(score_riesgo)
    """))
    return [dict(r._mapping) for r in result.fetchall()]


@router.get("/segmentos")
async def segmentos(
    tipo: str = Query("persona", pattern="^(persona|institucion)$"),
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Segmentación por sector/tipo y score."""
    if tipo == "persona":
        result = await db.execute(text("""
            SELECT
                COALESCE(sector_principal, 'Sin sector') AS segmento,
                COUNT(*) AS cantidad,
                ROUND(AVG(score_riesgo)::numeric, 3) AS score_medio,
                COUNT(*) FILTER (WHERE es_pep = TRUE) AS pep_count,
                COUNT(*) FILTER (WHERE en_lista_vigilancia = TRUE) AS vigilancia_count
            FROM core.personas
            WHERE deleted_at IS NULL AND activo = TRUE
            GROUP BY 1 ORDER BY cantidad DESC LIMIT 10
        """))
    else:
        result = await db.execute(text("""
            SELECT
                COALESCE(sector, 'Sin sector') AS segmento,
                COUNT(*) AS cantidad,
                ROUND(AVG(score_riesgo)::numeric, 3) AS score_medio,
                COUNT(*) FILTER (WHERE estado_legal = 'activa') AS activas_count,
                0 AS vigilancia_count
            FROM core.instituciones
            WHERE deleted_at IS NULL AND activo = TRUE
            GROUP BY 1 ORDER BY cantidad DESC LIMIT 10
        """))
    return [dict(r._mapping) for r in result.fetchall()]


@router.get("/top-riesgo")
async def top_riesgo(
    limite: int = Query(10, ge=5, le=50),
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Top entidades por score de riesgo."""
    result = await db.execute(text("""
        SELECT 'persona' AS tipo, id, nombre_completo AS nombre, score_riesgo,
               cargo_actual AS subtitulo, pais_residencia AS pais
        FROM core.personas WHERE deleted_at IS NULL AND activo = TRUE AND score_riesgo > 0
        UNION ALL
        SELECT 'institucion', id, nombre, score_riesgo, sector, pais_registro
        FROM core.instituciones WHERE deleted_at IS NULL AND activo = TRUE AND score_riesgo > 0
        ORDER BY score_riesgo DESC LIMIT :limite
    """), {"limite": limite})
    return [dict(r._mapping) for r in result.fetchall()]


@router.get("/evolucion-vinculos")
async def evolucion_vinculos(
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Evolución de vínculos creados por mes (últimos 12 meses)."""
    result = await db.execute(text("""
        SELECT
            TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS mes,
            COUNT(*) AS total
        FROM intel.vinculos
        WHERE created_at >= NOW() - INTERVAL '12 months'
        GROUP BY 1 ORDER BY 1
    """))
    return [dict(r._mapping) for r in result.fetchall()]
