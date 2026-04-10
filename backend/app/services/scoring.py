# app/services/scoring.py
# ============================================================
# Motor de scoring por reglas — Fase 2
# ML real viene en Fase 7
# ============================================================
from uuid import UUID
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
import structlog

log = structlog.get_logger()


async def recalcular_score_persona(db: AsyncSession, persona_id: UUID) -> float:
    """
    Llama a la función SQL que aplica las reglas de scoring.
    Actualiza score_riesgo directamente en la tabla.
    """
    try:
        result = await db.execute(
            text("SELECT scoring.calcular_score_persona(:pid)"),
            {"pid": persona_id},
        )
        score = result.scalar() or 0.0
        log.debug("Score calculado", entidad="persona", id=persona_id, score=score)
        return float(score)
    except Exception as e:
        log.error("Error calculando score persona", id=persona_id, error=str(e))
        return 0.0


async def recalcular_score_institucion(db: AsyncSession, inst_id: UUID) -> float:
    """Score simplificado para instituciones usando reglas SQL."""
    try:
        result = await db.execute(
            text("""
                WITH reglas AS (
                    SELECT
                        CASE WHEN en_lista_vigilancia THEN 0.35 ELSE 0.0 END +
                        CASE WHEN listas_externas IS NOT NULL
                              AND array_length(listas_externas, 1) > 0
                             THEN 0.40 ELSE 0.0 END +
                        CASE WHEN nivel_prioridad = 5 THEN 0.20 ELSE 0.0 END
                    AS score
                    FROM core.instituciones WHERE id = :iid
                )
                UPDATE core.instituciones
                SET score_riesgo = LEAST(1.0, (SELECT score FROM reglas)),
                    score_version = score_version + 1,
                    score_at = NOW()
                WHERE id = :iid
                RETURNING score_riesgo
            """),
            {"iid": inst_id},
        )
        score = result.scalar() or 0.0
        return float(score)
    except Exception as e:
        log.error("Error calculando score institución", id=inst_id, error=str(e))
        return 0.0
