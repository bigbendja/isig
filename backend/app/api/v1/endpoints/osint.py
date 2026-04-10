# app/api/v1/endpoints/osint.py
# ============================================================
# Gestión del pipeline OSINT desde el dashboard
# Fuentes, ejecuciones, datos pendientes, importación
# ============================================================
import json
from uuid import UUID, uuid4

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, Depends
from sqlalchemy import text
import structlog

from app.api.dependencies import CurrentUser, get_current_user, get_db_session, require_nivel
from sqlalchemy.ext.asyncio import AsyncSession
from app.schemas import PaginatedResponse, SuccessResponse

log = structlog.get_logger()
router = APIRouter(prefix="/osint", tags=["OSINT / Pipeline"])


# ── FUENTES ───────────────────────────────────────────────────

@router.get("/fuentes")
async def listar_fuentes(
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    result = await db.execute(text("""
        SELECT f.*,
               (SELECT COUNT(*) FROM osint.ejecuciones e WHERE e.fuente_id = f.id) AS total_ejecuciones,
               (SELECT COUNT(*) FROM osint.datos_raw d WHERE d.fuente_id = f.id AND d.estado = 'pendiente') AS pendientes
        FROM osint.fuentes f
        ORDER BY f.activa DESC, f.nombre
    """))
    return [dict(r._mapping) for r in result.fetchall()]


@router.post("/fuentes")
async def crear_fuente(
    nombre: str,
    tipo: str,
    url_base: str | None = None,
    descripcion: str | None = None,
    frecuencia_cron: str = "0 */6 * * *",
    nivel_confianza: int = 3,
    config_extra: dict | None = None,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    if current_user.nivel_acceso < 3:
        raise HTTPException(status_code=403, detail="Requiere nivel 3+")

    await db.execute(text("""
        INSERT INTO osint.fuentes
            (nombre, tipo, url_base, descripcion, frecuencia_cron, nivel_confianza, config)
        VALUES (:nombre, :tipo, :url_base, :desc, :cron, :confianza, CAST(:config AS jsonb))
    """), {
        "nombre": nombre, "tipo": tipo, "url_base": url_base,
        "desc": descripcion, "cron": frecuencia_cron,
        "confianza": nivel_confianza,
        "config": json.dumps(config_extra or {}),
    })
    return SuccessResponse(message=f"Fuente '{nombre}' creada")


@router.patch("/fuentes/{fuente_id}/toggle")
async def toggle_fuente(
    fuente_id: int,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    if current_user.nivel_acceso < 3:
        raise HTTPException(status_code=403, detail="Requiere nivel 3+")
    await db.execute(text("""
        UPDATE osint.fuentes SET activa = NOT activa WHERE id = :id
    """), {"id": fuente_id})
    return SuccessResponse(message="Estado de fuente actualizado")


@router.post("/fuentes/{fuente_id}/ejecutar")
async def ejecutar_fuente_manual(
    fuente_id: int,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Dispara una ejecución manual inmediata."""
    if current_user.nivel_acceso < 2:
        raise HTTPException(status_code=403, detail="Requiere nivel 2+")

    # Verificar fuente existe
    result = await db.execute(
        text("SELECT id, nombre FROM osint.fuentes WHERE id = :id"),
        {"id": fuente_id}
    )
    fuente = result.fetchone()
    if not fuente:
        raise HTTPException(status_code=404, detail="Fuente no encontrada")

    # Disparar en background (sin bloquear la respuesta HTTP)
    import asyncio
    from app.core.database import AsyncSessionLocal

    async def _run_bg():
        """Ejecuta el pipeline en background."""
        try:
            import sys, os
            sys.path.insert(0, '/app/pipeline')
            from pipeline.runner import ejecutar_fuente
            await ejecutar_fuente(fuente_id, trigger='manual')
        except ImportError:
            log.warning("Pipeline no disponible en este contenedor — solo backend")

    asyncio.create_task(_run_bg())

    return SuccessResponse(
        message=f"Ejecución iniciada para '{fuente.nombre}'",
        data={"fuente_id": fuente_id, "fuente": fuente.nombre}
    )



@router.patch("/fuentes/{fuente_id}")
async def actualizar_fuente(
    fuente_id: int,
    body: dict,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    allowed = {'nombre', 'url_base', 'descripcion', 'frecuencia_cron', 'nivel_confianza'}
    datos = {k: v for k, v in body.items() if k in allowed}
    if not datos:
        raise HTTPException(status_code=400, detail="Sin campos válidos")
    set_clauses = ", ".join(f"{k} = :{k}" for k in datos)
    await db.execute(
        text(f"UPDATE osint.fuentes SET {set_clauses} WHERE id = :id"),
        {**datos, "id": fuente_id}
    )
    return SuccessResponse(message="Fuente actualizada")


@router.delete("/fuentes/{fuente_id}")
async def eliminar_fuente(
    fuente_id: int,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_nivel(3)),
):
    await db.execute(
        text("DELETE FROM osint.fuentes WHERE id = :id"),
        {"id": fuente_id}
    )
    return SuccessResponse(message="Fuente eliminada")


# ── EJECUCIONES ───────────────────────────────────────────────

@router.get("/ejecuciones")
async def listar_ejecuciones(
    fuente_id: int | None = None,
    limite: int = 50,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    params = {"limite": limite}
    where = "1=1"
    if fuente_id:
        where = "e.fuente_id = :fuente_id"
        params["fuente_id"] = fuente_id

    result = await db.execute(text(f"""
        SELECT e.*, f.nombre AS fuente_nombre
        FROM osint.ejecuciones e
        JOIN osint.fuentes f ON e.fuente_id = f.id
        WHERE {where}
        ORDER BY e.inicio DESC
        LIMIT :limite
    """), params)
    return [dict(r._mapping) for r in result.fetchall()]


# ── DATOS PENDIENTES ──────────────────────────────────────────

@router.get("/datos-pendientes")
async def datos_pendientes(
    limite: int = 30,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    result = await db.execute(text("""
        SELECT d.id, d.url_origen, d.confianza_ext, d.created_at,
               d.contenido_norm, f.nombre AS fuente_nombre
        FROM osint.datos_raw d
        LEFT JOIN osint.fuentes f ON d.fuente_id = f.id
        WHERE d.estado = 'pendiente' OR d.requiere_revision = TRUE
        ORDER BY d.created_at DESC
        LIMIT :limite
    """), {"limite": limite})
    items = []
    for r in result.fetchall():
        d = dict(r._mapping)
        for k, v in d.items():
            if hasattr(v, 'isoformat'):
                d[k] = v.isoformat()
        items.append(d)
    return {"items": items, "total": len(items)}


# ── IMPORTACIÓN MASIVA CSV/EXCEL ──────────────────────────────

@router.post("/importar-csv")
async def importar_csv(
    archivo: UploadFile = File(...),
    tipo_entidad: str = Form("persona"),
    mapeo_columnas: str = Form('{"nombre": "nombre_completo"}'),
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_nivel(2)),
):
    """
    Importa entidades desde un archivo CSV o Excel.
    mapeo_columnas: JSON {"columna_csv": "campo_bd"}
    """
    if not archivo.filename.endswith(('.csv', '.xlsx', '.xls')):
        raise HTTPException(status_code=400, detail="Solo CSV o Excel (.csv, .xlsx, .xls)")

    contenido = await archivo.read()
    if len(contenido) > 10 * 1024 * 1024:  # 10MB máximo
        raise HTTPException(status_code=400, detail="Archivo demasiado grande (máx. 10MB)")

    try:
        mapeo = json.loads(mapeo_columnas)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="mapeo_columnas debe ser JSON válido")

    # Guardar temporalmente
    import tempfile, os
    with tempfile.NamedTemporaryFile(
        suffix=os.path.splitext(archivo.filename)[1],
        delete=False
    ) as tmp:
        tmp.write(contenido)
        tmp_path = tmp.name

    try:
        # Registrar ejecución manual
        fuente_result = await db.execute(
            text("SELECT id FROM osint.fuentes WHERE tipo = 'manual' LIMIT 1")
        )
        fuente_row = fuente_result.fetchone()
        fuente_id = fuente_row.id if fuente_row else 0

        # Importar
        from pipeline.processors.etl import importar_csv as _importar_csv
        stats = await _importar_csv(tmp_path, mapeo, f"CSV:{archivo.filename}", fuente_id, tipo_entidad)

        return {
            "archivo": archivo.filename,
            "tipo_entidad": tipo_entidad,
            "entidades_creadas": stats.entidades_creadas,
            "entidades_enriquecidas": stats.entidades_enriquecidas,
            "ignoradas": stats.entidades_ignoradas,
            "errores": len(stats.errores),
            "muestra_errores": stats.errores[:5],
        }
    except ImportError:
        # Pipeline no disponible — hacer importación básica directamente
        return await _importar_csv_basico(contenido, archivo.filename, mapeo, tipo_entidad, db, current_user)
    finally:
        os.unlink(tmp_path)


async def _importar_csv_basico(
    contenido: bytes,
    nombre_archivo: str,
    mapeo: dict,
    tipo_entidad: str,
    db,
    current_user,
) -> dict:
    """Importación básica sin el módulo pipeline completo."""
    import io
    import pandas as pd

    if nombre_archivo.endswith(('.xlsx', '.xls')):
        df = pd.read_excel(io.BytesIO(contenido))
    else:
        df = pd.read_csv(io.BytesIO(contenido), encoding='utf-8-sig')

    creadas = 0
    errores = []

    for _, fila in df.iterrows():
        try:
            datos = {}
            for col, campo in mapeo.items():
                if col in fila and str(fila[col]) != 'nan':
                    datos[campo] = str(fila[col]).strip()

            nombre = datos.get('nombre_completo')
            if not nombre:
                continue

            if tipo_entidad == 'persona':
                await db.execute(text("""
                    INSERT INTO core.personas
                        (id, nombre_completo, fuente_primaria, nivel_acceso_requerido, created_by)
                    VALUES (gen_random_uuid(), :nombre, 'CSV', 1, :uid)
                    ON CONFLICT DO NOTHING
                """), {"nombre": nombre, "uid": str(current_user.id)})
            else:
                await db.execute(text("""
                    INSERT INTO core.instituciones
                        (id, nombre, fuente_primaria, nivel_acceso_requerido, created_by)
                    VALUES (gen_random_uuid(), :nombre, 'CSV', 1, :uid)
                    ON CONFLICT DO NOTHING
                """), {"nombre": nombre, "uid": str(current_user.id)})
            creadas += 1
        except Exception as e:
            errores.append(str(e)[:100])

    return {
        "archivo": nombre_archivo,
        "tipo_entidad": tipo_entidad,
        "entidades_creadas": creadas,
        "entidades_enriquecidas": 0,
        "ignoradas": len(df) - creadas,
        "errores": len(errores),
        "muestra_errores": errores[:5],
    }


# ── ESTADÍSTICAS DEL PIPELINE ─────────────────────────────────

@router.get("/stats")
async def stats_pipeline(
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    result = await db.execute(text("""
        SELECT
            (SELECT COUNT(*) FROM osint.fuentes WHERE activa = TRUE) AS fuentes_activas,
            (SELECT COUNT(*) FROM osint.fuentes WHERE activa = FALSE) AS fuentes_pausadas,
            (SELECT COUNT(*) FROM osint.datos_raw WHERE estado = 'pendiente') AS datos_pendientes,
            (SELECT COUNT(*) FROM osint.datos_raw WHERE created_at >= NOW() - INTERVAL '24h') AS procesados_hoy,
            (SELECT COUNT(*) FROM osint.alertas WHERE revisada = FALSE) AS alertas_pendientes,
            (SELECT COUNT(*) FROM osint.ejecuciones WHERE estado = 'en_curso') AS ejecuciones_activas,
            (SELECT COUNT(*) FROM osint.ejecuciones WHERE inicio >= NOW() - INTERVAL '24h') AS ejecuciones_hoy
    """))
    row = result.fetchone()
    return dict(row._mapping)
