# ml/inference/service.py
# ============================================================
# Servicio de inferencia ML — scoring batch + tiempo real
# Lee entidades de PostgreSQL, aplica modelos, escribe resultados
# ============================================================
import asyncio
import json
from datetime import datetime, timezone
from typing import Any

import asyncpg
import numpy as np
import pandas as pd
import structlog

from ml.training.features import extractor
from ml.training.risk_model import RiskScoringModel, get_modelo
from ml.training.segmentation import SegmentationModel

log = structlog.get_logger()


# ── CARGA DE DATOS DESDE POSTGRESQL ──────────────────────────

async def cargar_personas(pool: asyncpg.Pool, limite: int = 10000) -> list[dict]:
    """
    Carga personas con features adicionales calculadas en SQL.
    Incluye conteos de vínculos, eventos y alertas como features.
    """
    rows = await pool.fetch(f"""
        SELECT
            p.*,
            COALESCE(v.num_vinculos, 0)          AS _num_vinculos,
            COALESCE(v.vinculos_alto_riesgo, 0)  AS _vinculos_alto_riesgo,
            COALESCE(ev.num_eventos, 0)           AS _num_eventos,
            COALESCE(al.num_alertas, 0)           AS _num_alertas
        FROM core.personas p
        LEFT JOIN (
            SELECT
                origen_id AS entity_id,
                COUNT(*) AS num_vinculos,
                COUNT(*) FILTER (
                    WHERE destino_id IN (
                        SELECT id FROM core.personas WHERE score_riesgo > 0.5
                        UNION
                        SELECT id FROM core.instituciones WHERE score_riesgo > 0.5
                    )
                ) AS vinculos_alto_riesgo
            FROM intel.vinculos
            WHERE vigente = TRUE AND origen_tipo = 'persona'
            GROUP BY origen_id
        ) v ON p.id = v.entity_id
        LEFT JOIN (
            SELECT entidad_id, COUNT(*) AS num_eventos
            FROM intel.eventos
            WHERE entidad_tipo = 'persona'
            GROUP BY entidad_id
        ) ev ON p.id = ev.entidad_id
        LEFT JOIN (
            SELECT entidad_id, COUNT(*) AS num_alertas
            FROM osint.alertas
            WHERE entidad_tipo = 'persona'
              AND created_at >= NOW() - INTERVAL '30 days'
              AND revisada = FALSE
            GROUP BY entidad_id
        ) al ON p.id::text = al.entidad_id::text
        WHERE p.deleted_at IS NULL AND p.activo = TRUE
        LIMIT {limite}
    """)
    return [dict(r) for r in rows]


async def cargar_instituciones(pool: asyncpg.Pool, limite: int = 5000) -> list[dict]:
    rows = await pool.fetch(f"""
        SELECT
            i.*,
            COALESCE(v.num_vinculos, 0)         AS _num_vinculos,
            COALESCE(v.vinculos_alto_riesgo, 0) AS _vinculos_alto_riesgo,
            COALESCE(al.num_alertas, 0)          AS _num_alertas
        FROM core.instituciones i
        LEFT JOIN (
            SELECT origen_id AS entity_id,
                   COUNT(*) AS num_vinculos,
                   COUNT(*) FILTER (WHERE score_dest > 0.5) AS vinculos_alto_riesgo
            FROM intel.vinculos v2
            LEFT JOIN (
                SELECT id, score_riesgo AS score_dest
                FROM core.personas
                UNION ALL
                SELECT id, score_riesgo
                FROM core.instituciones
            ) ent ON v2.destino_id = ent.id
            WHERE v2.vigente = TRUE AND v2.origen_tipo = 'institucion'
            GROUP BY origen_id
        ) v ON i.id = v.entity_id
        LEFT JOIN (
            SELECT entidad_id, COUNT(*) AS num_alertas
            FROM osint.alertas
            WHERE entidad_tipo = 'institucion'
              AND created_at >= NOW() - INTERVAL '30 days'
              AND revisada = FALSE
            GROUP BY entidad_id
        ) al ON i.id::text = al.entidad_id::text
        WHERE i.deleted_at IS NULL AND i.activo = TRUE
        LIMIT {limite}
    """)
    return [dict(r) for r in rows]


# ── SCORING BATCH ─────────────────────────────────────────────

async def score_batch(
    pool: asyncpg.Pool,
    tipo: str = 'persona',
    usar_ml: bool = True,
) -> dict[str, Any]:
    """
    Recalcula el score de riesgo para TODAS las entidades activas.
    Combina reglas SQL + modelo ML si está disponible.
    """
    log.info("Iniciando scoring batch", tipo=tipo)
    t0 = datetime.now()

    # 1. Cargar entidades
    if tipo == 'persona':
        rows = await cargar_personas(pool)
    else:
        rows = await cargar_instituciones(pool)

    if not rows:
        return {"tipo": tipo, "procesadas": 0, "metodo": "sin_datos"}

    # 2. Extraer features
    df = extractor.dataframe_from_rows(rows, tipo)

    # 3. Intentar modelo ML
    metodo  = "reglas_sql"
    scores  = {}
    modelo  = get_modelo(tipo) if usar_ml else None

    if modelo and modelo.model is not None:
        try:
            X = df[modelo.feature_names].fillna(0).values.astype(np.float32)
            X_scaled = modelo.scaler.transform(X)
            probs = modelo.model.predict_proba(X_scaled)[:, 1]

            for row, score in zip(rows, probs):
                scores[str(row['id'])] = float(np.clip(score, 0.0, 1.0))

            metodo = f"xgboost_v{modelo.version}"
            log.info("Scoring ML completado", n=len(scores), metodo=metodo)

        except Exception as e:
            log.warning("Modelo ML falló, usando reglas", error=str(e))
            scores = {}

    # 4. Fallback a reglas SQL si ML no disponible
    if not scores:
        tabla = "personas" if tipo == 'persona' else "instituciones"
        fn    = "scoring.calcular_score_persona" if tipo == 'persona' else None
        for row in rows:
            if fn:
                result = await pool.fetchval(f"SELECT {fn}($1)", row['id'])
                scores[str(row['id'])] = float(result or 0)

    # 5. Escribir scores en lote
    if scores:
        tabla = "personas" if tipo == 'persona' else "instituciones"
        version_actual = await pool.fetchval(
            f"SELECT COALESCE(MAX(score_version), 0) FROM core.{tabla}"
        )
        nueva_version = (version_actual or 0) + 1

        async with pool.acquire() as conn:
            async with conn.transaction():
                for entity_id, score in scores.items():
                    await conn.execute(f"""
                        UPDATE core.{tabla}
                        SET score_riesgo = $2,
                            score_version = $3,
                            score_at = NOW()
                        WHERE id = $1::uuid
                    """, entity_id, score, nueva_version)

                # Guardar historial de scores
                await conn.executemany("""
                    INSERT INTO scoring.historial_scores
                        (entidad_tipo, entidad_id, score_riesgo, version, calculado_by)
                    VALUES ($1, $2::uuid, $3, $4, $5)
                """, [
                    (tipo, eid, score, nueva_version, metodo)
                    for eid, score in scores.items()
                ])

    duracion = (datetime.now() - t0).total_seconds()
    log.info("Scoring batch completado",
             tipo=tipo, procesadas=len(scores), metodo=metodo,
             duracion_seg=round(duracion, 2))

    return {
        "tipo":        tipo,
        "procesadas":  len(scores),
        "metodo":      metodo,
        "duracion_seg": round(duracion, 2),
        "version":     nueva_version if scores else 0,
    }


# ── SEGMENTACIÓN BATCH ────────────────────────────────────────

async def segmentar_batch(
    pool: asyncpg.Pool,
    tipo: str = 'persona',
) -> dict[str, Any]:
    """
    Aplica K-Means a todas las entidades y actualiza la tabla scoring.entidad_segmento.
    """
    log.info("Iniciando segmentación batch", tipo=tipo)

    # Cargar datos
    rows = (await cargar_personas(pool) if tipo == 'persona'
            else await cargar_instituciones(pool))
    if not rows:
        return {"tipo": tipo, "segmentos": 0, "procesadas": 0}

    df = extractor.dataframe_from_rows(rows, tipo)

    # Cargar o entrenar modelo de segmentación
    seg_model = SegmentationModel(tipo)
    if not seg_model.load():
        log.info("Entrenando nuevo modelo de segmentación")
        segmentos = seg_model.train(df)
        seg_model.save()
    else:
        segmentos = seg_model.segmentos

    # Predecir segmento para cada entidad
    X = df.fillna(0).values.astype(np.float32)
    X_scaled = seg_model.scaler.transform(X)
    X_pca    = seg_model.pca.transform(X_scaled)
    labels   = seg_model.model.predict(X_pca)

    # Actualizar BD
    # 1. Registrar segmentos en scoring.segmentos
    async with pool.acquire() as conn:
        for seg in segmentos:
            await conn.execute("""
                INSERT INTO scoring.segmentos (id, nombre, descripcion, color_hex, criterios, automatico)
                VALUES (
                    gen_random_uuid(),
                    $1, $2, $3,
                    $4::jsonb,
                    TRUE
                )
                ON CONFLICT (nombre) DO UPDATE
                SET descripcion = EXCLUDED.descripcion,
                    color_hex   = EXCLUDED.color_hex
            """,
                seg.nombre, seg.descripcion, seg.color,
                json.dumps({"etiquetas": seg.etiquetas, "perfil": seg.perfil}),
            )

        # 2. Asignar entidades a segmentos
        for row, label in zip(rows, labels):
            seg = next((s for s in segmentos if s.id == int(label)), None)
            if seg is None:
                continue

            seg_row = await conn.fetchrow(
                "SELECT id FROM scoring.segmentos WHERE nombre = $1",
                seg.nombre
            )
            if not seg_row:
                continue

            # Calcular distancia al centroide como score de pertenencia
            entity_vec = X_pca[rows.index(row)].reshape(1, -1)
            dist = seg_model.model.transform(entity_vec)[0, int(label)]
            max_dist = np.max(seg_model.model.transform(entity_vec))
            score_pertenencia = float(1.0 - dist / (max_dist + 1e-6))

            await conn.execute("""
                INSERT INTO scoring.entidad_segmento
                    (entidad_tipo, entidad_id, segmento_id, score, asignado_at)
                VALUES ($1, $2::uuid, $3::uuid, $4, NOW())
                ON CONFLICT (entidad_tipo, entidad_id, segmento_id)
                DO UPDATE SET score = EXCLUDED.score, asignado_at = NOW()
            """, tipo, str(row['id']), str(seg_row['id']), score_pertenencia)

    return {
        "tipo":       tipo,
        "segmentos":  len(segmentos),
        "procesadas": len(rows),
        "modelo":     "kmeans_v1",
        "silhouette": round(seg_model.metrics.get('silhouette', 0), 3),
    }


# ── SCORING INDIVIDUAL EN TIEMPO REAL ─────────────────────────

async def score_individual(
    pool: asyncpg.Pool,
    entidad_id: str,
    entidad_tipo: str,
) -> dict[str, Any]:
    """Recalcula el score de una sola entidad y devuelve SHAP."""
    # Cargar entidad con features adicionales
    tabla    = "personas" if entidad_tipo == 'persona' else "instituciones"
    query    = (
        f"SELECT p.*, "
        f"COALESCE((SELECT COUNT(*) FROM intel.vinculos WHERE origen_id = p.id AND vigente=TRUE), 0) AS _num_vinculos, "
        f"COALESCE((SELECT COUNT(*) FROM intel.eventos WHERE entidad_id = p.id), 0) AS _num_eventos, "
        f"COALESCE((SELECT COUNT(*) FROM osint.alertas WHERE entidad_id = p.id::text AND revisada=FALSE), 0) AS _num_alertas, "
        f"0 AS _vinculos_alto_riesgo "
        f"FROM core.{tabla} p WHERE p.id = $1::uuid"
    )
    row = await pool.fetchrow(query, entidad_id)
    if not row:
        return {"error": "Entidad no encontrada"}

    row_dict = dict(row)
    features = (extractor.extract_persona_features(row_dict)
                if entidad_tipo == 'persona'
                else extractor.extract_institucion_features(row_dict))

    modelo = get_modelo(entidad_tipo)

    if modelo.model is not None:
        resultado = modelo.predict_with_shap(features)
    else:
        # Fallback a reglas
        fn = "scoring.calcular_score_persona" if entidad_tipo == 'persona' else None
        if fn:
            score = float(await pool.fetchval(f"SELECT {fn}($1)", entidad_id) or 0)
        else:
            score = 0.0
        resultado = {
            "score":           score,
            "nivel_riesgo":    RiskScoringModel._score_to_level(score),
            "contribuciones":  [],
            "metodo":          "reglas_sql",
        }

    # Persistir el score
    await pool.execute(f"""
        UPDATE core.{tabla}
        SET score_riesgo  = $2,
            score_version = score_version + 1,
            score_at      = NOW()
        WHERE id = $1::uuid
    """, entidad_id, resultado['score'])

    return {
        "entidad_id":   entidad_id,
        "entidad_tipo": entidad_tipo,
        **resultado,
        "features_usadas": features,
    }


# ── ENTRENAMIENTO COMPLETO ────────────────────────────────────

async def entrenar_modelo_riesgo(
    pool: asyncpg.Pool,
    tipo: str = 'persona',
) -> dict[str, Any]:
    """
    Entrena el modelo XGBoost usando los datos actuales de la BD.
    Usa score_riesgo > 0.5 como label positivo.
    El modelo aprende a replicar y mejorar las reglas manuales.
    """
    log.info("Cargando datos para entrenamiento", tipo=tipo)

    rows = (await cargar_personas(pool) if tipo == 'persona'
            else await cargar_instituciones(pool))

    if len(rows) < 20:
        return {
            "error": f"Datos insuficientes para entrenar ({len(rows)} entidades). "
                     f"Se necesitan al menos 20."
        }

    df = extractor.dataframe_from_rows(rows, tipo)

    # Labels: usar score actual (calculado por reglas) como ground truth inicial
    # Con el tiempo, los analistas pueden verificar/corregir labels
    y_continuo = np.array([float(r.get('score_riesgo') or 0) for r in rows])

    # Binarizar: alto riesgo = score_riesgo > 0.4
    umbral = 0.4
    y = (y_continuo > umbral).astype(int)

    pos_count = int(y.sum())
    log.info("Dataset preparado", muestras=len(df),
             alto_riesgo=pos_count, bajo_riesgo=int(len(y) - pos_count))

    if pos_count < 5 or (len(y) - pos_count) < 5:
        return {
            "error": "Distribución de clases insuficiente. "
                     "Necesitas al menos 5 entidades en cada clase."
        }

    modelo = RiskScoringModel(tipo)
    metricas = modelo.train(df, pd.Series(y), optimize=len(rows) >= 100)
    modelo.save()

    return {
        "tipo":         tipo,
        "entrenado":    True,
        "muestras":     len(rows),
        "alto_riesgo":  pos_count,
        "metricas":     metricas,
    }
