# app/api/v1/endpoints/vinculos.py
from uuid import UUID, uuid4
from fastapi import APIRouter, HTTPException, Query, status, Depends
from sqlalchemy import text
import structlog
from app.api.dependencies import CurrentUser, get_current_user, get_db_session, require_nivel
from sqlalchemy.ext.asyncio import AsyncSession
from app.schemas import PaginatedResponse, SuccessResponse, VinculoCreate, VinculoResumen
from app.services.neo4j_sync import sync_vinculo_neo4j
import json

log = structlog.get_logger()
router = APIRouter(prefix="/vinculos", tags=["Vínculos"])


@router.get("/entidad/{tipo}/{entidad_id}", response_model=PaginatedResponse)
async def vinculos_de_entidad(
    tipo: str,
    entidad_id: UUID,
    vigente: bool = True,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Devuelve todos los vínculos de una entidad (grafo de primer grado)."""
    offset = (page - 1) * page_size
    result = await db.execute(
        text("""
            SELECT * FROM intel.v_grafo
            WHERE (
                (origen_tipo = :tipo AND origen_id = :eid)
                OR (destino_tipo = :tipo AND destino_id = :eid)
            )
            AND vigente = TRUE
            ORDER BY intensidad DESC
            LIMIT :limit OFFSET :offset
        """),
        {"tipo": tipo, "eid": entidad_id, "limit": page_size, "offset": offset},
    )
    rows = result.fetchall()
    count = await db.execute(
        text("""
            SELECT COUNT(*) FROM intel.v_grafo
            WHERE ((origen_tipo = :tipo AND origen_id = :eid)
               OR (destino_tipo = :tipo AND destino_id = :eid))
            AND vigente = TRUE
        """),
        {"tipo": tipo, "eid": entidad_id},
    )
    total = count.scalar() or 0
    return PaginatedResponse(
        total=total, page=page, page_size=page_size,
        pages=-(-total // page_size),
        items=[dict(r._mapping) for r in rows],
    )



@router.get("/tipos")
async def listar_tipos_vinculo(
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Lista todos los tipos de vínculo disponibles."""
    result = await db.execute(text("""
        SELECT id, codigo, nombre, categoria, descripcion
        FROM core.tipos_vinculo ORDER BY categoria, nombre
    """))
    return [dict(r._mapping) for r in result.fetchall()]

@router.post("", response_model=VinculoResumen, status_code=201)
async def crear_vinculo(
    body: VinculoCreate,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_nivel(2)),
):
    """Crea un vínculo entre dos entidades."""
    if body.origen_tipo == body.destino_tipo and body.origen_id == body.destino_id:
        raise HTTPException(status_code=400, detail="Una entidad no puede vincularse consigo misma")

    vinculo_id = uuid4()
    upsert_result = await db.execute(
        text("""
            INSERT INTO intel.vinculos (
                id, origen_tipo, origen_id, destino_tipo, destino_id,
                tipo_vinculo_id, tipo_vinculo_custom, descripcion,
                bidireccional, intensidad, frecuencia, fecha_inicio, fecha_fin,
                fuente, confianza, nivel_acceso, created_by
            ) VALUES (
                :id, :origen_tipo, :origen_id, :destino_tipo, :destino_id,
                :tipo_vinculo_id, :tipo_vinculo_custom, :descripcion,
                :bidireccional, :intensidad, :frecuencia, :fecha_inicio, :fecha_fin,
                :fuente, :confianza, :nivel_acceso, :created_by
            )
            ON CONFLICT (origen_tipo, origen_id, destino_tipo, destino_id, tipo_vinculo_id, COALESCE(tipo_vinculo_custom, '')) DO UPDATE SET
                vigente = TRUE,
                intensidad = EXCLUDED.intensidad,
                descripcion = EXCLUDED.descripcion,
                confianza = EXCLUDED.confianza,
                updated_at = NOW()
            RETURNING id
        """),
        {**body.model_dump(), "id": vinculo_id, "created_by": current_user.id},
    )
    returned = upsert_result.fetchone()
    vinculo_id = returned[0] if returned else vinculo_id

    try:
        await sync_vinculo_neo4j(vinculo_id, body)
    except Exception as e:
        log.warning("Neo4j vinculo sync falló", error=str(e))

    result = await db.execute(
        text("SELECT * FROM intel.v_grafo WHERE id = :id"),
        {"id": vinculo_id},
    )
    row = result.fetchone()
    return dict(row._mapping) if row else {"id": vinculo_id}


@router.delete("/{vinculo_id}", response_model=SuccessResponse)
async def eliminar_vinculo(
    vinculo_id: UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_nivel(2)),
):
    result = await db.execute(
        text("UPDATE intel.vinculos SET vigente = FALSE, updated_at = NOW() WHERE id = :id RETURNING id"),
        {"id": vinculo_id},
    )
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="Vínculo no encontrado")
    log.info("Vínculo eliminado", vinculo_id=str(vinculo_id), user=str(current_user.id))
    return SuccessResponse(message="Vínculo desactivado")


@router.patch("/{vinculo_id}", response_model=SuccessResponse)
async def editar_vinculo(
    vinculo_id: UUID,
    body: dict,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_nivel(2)),
):
    """Edita un vínculo existente."""
    allowed = {"tipo_vinculo_id", "tipo_vinculo_custom", "descripcion",
               "intensidad", "frecuencia", "fecha_inicio", "fecha_fin",
               "fuente", "confianza", "bidireccional"}
    datos = {k: v for k, v in body.items() if k in allowed}
    if not datos:
        raise HTTPException(status_code=400, detail="Sin campos válidos")
    set_clauses = ", ".join(f"{k} = :{k}" for k in datos)
    await db.execute(
        text(f"UPDATE intel.vinculos SET {set_clauses}, updated_at = NOW() WHERE id = :id"),
        {**datos, "id": vinculo_id},
    )
    return SuccessResponse(message="Vínculo actualizado")
