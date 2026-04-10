# app/api/v1/endpoints/etiquetas.py
from uuid import UUID
from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.dependencies import get_db_session, get_current_user, require_nivel, CurrentUser

router = APIRouter(prefix="/etiquetas", tags=["Etiquetas"])


@router.get("")
async def listar_etiquetas(
    categoria: str | None = Query(None),
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Lista todas las etiquetas activas."""
    sql = "SELECT * FROM core.etiquetas WHERE activa = TRUE"
    params = {}
    if categoria:
        sql += " AND categoria = :cat"
        params["cat"] = categoria
    sql += " ORDER BY categoria, nombre"
    result = await db.execute(text(sql), params)
    return [dict(r._mapping) for r in result.fetchall()]


@router.post("")
async def crear_etiqueta(
    body: dict,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_nivel(3)),
):
    """Crea una nueva etiqueta personalizada."""
    result = await db.execute(
        text("""
            INSERT INTO core.etiquetas (nombre, categoria, color, descripcion)
            VALUES (:nombre, :categoria, :color, :descripcion)
            RETURNING id, nombre, categoria, color, descripcion, auto, activa, created_at
        """),
        {
            "nombre": body.get("nombre", ""),
            "categoria": body.get("categoria", "personalizado"),
            "color": body.get("color", "#6b7280"),
            "descripcion": body.get("descripcion"),
        },
    )
    return dict(result.fetchone()._mapping)


@router.get("/entidad/{entidad_tipo}/{entidad_id}")
async def etiquetas_de_entidad(
    entidad_tipo: str,
    entidad_id: UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Lista las etiquetas asignadas a una entidad."""
    result = await db.execute(
        text("""
            SELECT e.id, e.nombre, e.categoria, e.color, e.auto,
                   ee.created_at as asignada_at
            FROM core.entidad_etiquetas ee
            JOIN core.etiquetas e ON e.id = ee.etiqueta_id
            WHERE ee.entidad_tipo = :tipo AND ee.entidad_id = :eid
            ORDER BY e.categoria, e.nombre
        """),
        {"tipo": entidad_tipo, "eid": entidad_id},
    )
    return [dict(r._mapping) for r in result.fetchall()]


@router.post("/entidad/{entidad_tipo}/{entidad_id}")
async def asignar_etiqueta(
    entidad_tipo: str,
    entidad_id: UUID,
    body: dict,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_nivel(2)),
):
    """Asigna una etiqueta a una entidad."""
    etiqueta_ids = body.get("etiqueta_ids", [])
    if isinstance(body.get("etiqueta_id"), int):
        etiqueta_ids = [body["etiqueta_id"]]

    for eid in etiqueta_ids:
        try:
            await db.execute(
                text("""
                    INSERT INTO core.entidad_etiquetas
                        (entidad_tipo, entidad_id, etiqueta_id, asignada_por)
                    VALUES (:tipo, :eid, :etid, :by)
                    ON CONFLICT (entidad_tipo, entidad_id, etiqueta_id) DO NOTHING
                """),
                {"tipo": entidad_tipo, "eid": entidad_id, "etid": eid, "by": current_user.id},
            )
        except Exception:
            pass

    return {"message": f"{len(etiqueta_ids)} etiqueta(s) asignadas"}


@router.delete("/entidad/{entidad_tipo}/{entidad_id}/{etiqueta_id}")
async def quitar_etiqueta(
    entidad_tipo: str,
    entidad_id: UUID,
    etiqueta_id: int,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_nivel(2)),
):
    """Quita una etiqueta de una entidad."""
    await db.execute(
        text("""
            DELETE FROM core.entidad_etiquetas
            WHERE entidad_tipo = :tipo AND entidad_id = :eid AND etiqueta_id = :etid
        """),
        {"tipo": entidad_tipo, "eid": entidad_id, "etid": etiqueta_id},
    )
    return {"message": "Etiqueta quitada"}


@router.post("/auto-asignar/{entidad_tipo}/{entidad_id}")
async def auto_asignar_etiquetas(
    entidad_tipo: str,
    entidad_id: UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Auto-asigna etiquetas según los datos de la entidad (PEP, vigilancia, etc.)."""
    asignadas = 0
    if entidad_tipo == "persona":
        result = await db.execute(
            text("SELECT es_pep, en_lista_vigilancia FROM core.personas WHERE id = :id"),
            {"id": entidad_id},
        )
        row = result.fetchone()
        if row:
            if row.es_pep:
                await db.execute(
                    text("""INSERT INTO core.entidad_etiquetas (entidad_tipo, entidad_id, etiqueta_id, asignada_por)
                            SELECT :tipo, :eid, id, :by FROM core.etiquetas WHERE nombre = 'PEP' AND auto = TRUE
                            ON CONFLICT DO NOTHING"""),
                    {"tipo": entidad_tipo, "eid": entidad_id, "by": current_user.id},
                )
                asignadas += 1
            if row.en_lista_vigilancia:
                await db.execute(
                    text("""INSERT INTO core.entidad_etiquetas (entidad_tipo, entidad_id, etiqueta_id, asignada_por)
                            SELECT :tipo, :eid, id, :by FROM core.etiquetas WHERE nombre = 'Vigilancia' AND auto = TRUE
                            ON CONFLICT DO NOTHING"""),
                    {"tipo": entidad_tipo, "eid": entidad_id, "by": current_user.id},
                )
                asignadas += 1
    return {"message": f"{asignadas} etiquetas auto-asignadas"}
