# app/api/v1/endpoints/entidades.py
# ============================================================
# CRUD completo de Personas e Instituciones
# RLS activo en cada operación via DBSession
# ============================================================
import time
from typing import Annotated
from uuid import UUID, uuid4

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text

from app.api.dependencies import CurrentUser, get_current_user, get_db_session, require_nivel
from sqlalchemy.ext.asyncio import AsyncSession
from app.schemas import (
    ErrorResponse,
    InstitucionCreate,
    InstitucionDetalle,
    InstitucionResumen,
    InstitucionUpdate,
    PaginatedResponse,
    PersonaCreate,
    PersonaDetalle,
    PersonaResumen,
    PersonaUpdate,
    ScoreResponse,
    SearchResponse,
    SuccessResponse,
)
from app.services.scoring import recalcular_score_persona, recalcular_score_institucion
from app.services.neo4j_sync import sync_entidad_neo4j

log = structlog.get_logger()

router = APIRouter(tags=["Entidades"])


# ============================================================
# BÚSQUEDA GLOBAL
# ============================================================

@router.get("/search", response_model=SearchResponse)
async def busqueda_global(
    q: str = Query(min_length=2, max_length=200, description="Término de búsqueda"),
    tipo: str | None = Query(None, pattern="^(persona|institucion)$"),
    limite: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Búsqueda global sobre personas e instituciones.
    Usa pg_trgm para búsqueda fuzzy. RLS filtra según nivel del usuario.
    """
    t0 = time.monotonic()

    result = await db.execute(
        text("SELECT * FROM core.buscar(:termino, :tipo, :limite, :offset)"),
        {"termino": q, "tipo": tipo, "limite": limite, "offset": offset},
    )
    rows = result.fetchall()

    # Contar total sin límite para paginación
    count_result = await db.execute(
        text("""
            SELECT COUNT(*) FROM core.buscar(:termino, :tipo, 9999, 0)
        """),
        {"termino": q, "tipo": tipo},
    )
    total = count_result.scalar() or 0

    tiempo_ms = int((time.monotonic() - t0) * 1000)

    await _log_accion(db, current_user.id, "search", None, None, {"query": q})

    return SearchResponse(
        query=q,
        total=total,
        tiempo_ms=tiempo_ms,
        resultados=[
            {
                "tipo": r.tipo,
                "id": r.id,
                "nombre": r.nombre,
                "subtitulo": r.subtitulo,
                "ciudad": r.ciudad,
                "score_riesgo": float(r.score_riesgo or 0),
                "nivel_acceso_requerido": r.nivel_acceso_req,
                "relevancia": float(r.relevancia or 0),
            }
            for r in rows
        ],
    )


# ============================================================
# PERSONAS
# ============================================================

@router.get("/personas", response_model=PaginatedResponse)
async def listar_personas(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    sector: str | None = None,
    pais: str | None = None,
    es_pep: bool | None = None,
    vigilancia: bool | None = None,
    riesgo_min: float | None = Query(None, ge=0, le=1),
    buscar: str | None = Query(None, description="Búsqueda por nombre, cargo, empresa"),
    etiqueta_ids: str | None = Query(None, description="IDs de etiquetas separados por coma"),
    orden: str = Query("score_riesgo_desc",
                       pattern="^(nombre_asc|nombre_desc|score_riesgo_desc|created_at_desc)$"),
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Lista personas con filtros. RLS aplica automáticamente."""
    offset = (page - 1) * page_size

    # Construir WHERE dinámico
    conditions = ["p.deleted_at IS NULL", "p.activo = TRUE"]
    params: dict = {"limit": page_size, "offset": offset}

    if sector:
        conditions.append("p.sector_principal ILIKE :sector")
        params["sector"] = f"%{sector}%"
    if pais:
        conditions.append("p.pais_residencia = :pais")
        params["pais"] = pais
    if es_pep is not None:
        conditions.append("p.es_pep = :es_pep")
        params["es_pep"] = es_pep
    if vigilancia is not None:
        conditions.append("p.en_lista_vigilancia = :vigilancia")
        params["vigilancia"] = vigilancia
    if riesgo_min is not None:
        conditions.append("p.score_riesgo >= :riesgo_min")
        params["riesgo_min"] = riesgo_min
    if buscar:
        conditions.append("""(
            p.nombre_completo ILIKE :buscar OR
            p.cargo_actual ILIKE :buscar OR
            i.nombre ILIKE :buscar OR
            p.pais_residencia ILIKE :buscar OR
            p.ciudad_residencia ILIKE :buscar
        )""")
        params["buscar"] = f"%{buscar}%"
    if etiqueta_ids:
        ids = [int(x) for x in etiqueta_ids.split(',') if x.strip().isdigit()]
        if ids:
            placeholders = ','.join(f':etq_{i}' for i in range(len(ids)))
            conditions.append(f"""EXISTS (
                SELECT 1 FROM core.entidad_etiquetas ee
                WHERE ee.entidad_tipo = 'persona'
                AND ee.entidad_id = p.id
                AND ee.etiqueta_id IN ({placeholders})
            )""")
            for i, eid in enumerate(ids):
                params[f'etq_{i}'] = eid

    where_clause = " AND ".join(conditions)

    order_map = {
        "nombre_asc":         "p.nombre_completo ASC",
        "nombre_desc":        "p.nombre_completo DESC",
        "score_riesgo_desc":  "p.score_riesgo DESC",
        "created_at_desc":    "p.created_at DESC",
    }
    order_clause = order_map[orden]

    result = await db.execute(
        text(f"""
            SELECT p.id, p.nombre_completo, p.alias, p.cargo_actual,
                   p.empresa_actual, i.nombre AS empresa_nombre,
                   p.ciudad_residencia, p.pais_residencia, p.es_pep,
                   p.en_lista_vigilancia, p.score_riesgo, p.nivel_prioridad,
                   p.completitud, p.nivel_acceso_requerido,
                   p.created_at, p.updated_at
            FROM core.personas p
            LEFT JOIN core.instituciones i ON p.empresa_actual = i.id
            WHERE {where_clause}
            ORDER BY {order_clause}
            LIMIT :limit OFFSET :offset
        """),
        params,
    )
    rows = result.fetchall()

    count_result = await db.execute(
        text(f"""SELECT COUNT(*) FROM core.personas p
            LEFT JOIN core.instituciones i ON p.empresa_actual = i.id
            WHERE {where_clause}"""),
        {k: v for k, v in params.items() if k not in ("limit", "offset")},
    )
    total = count_result.scalar() or 0

    return PaginatedResponse(
        total=total,
        page=page,
        page_size=page_size,
        pages=-(-total // page_size),
        items=[dict(r._mapping) for r in rows],
    )


@router.post("/personas", response_model=PersonaResumen, status_code=status.HTTP_201_CREATED)
async def crear_persona(
    body: PersonaCreate,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_nivel(2)),
):
    """Crea una nueva persona. Requiere nivel 2+."""
    persona_id = uuid4()

    await db.execute(
        text("""
            INSERT INTO core.personas (
                id, nombre_completo, nombres, apellidos, alias, genero,
                fecha_nacimiento, lugar_nacimiento, nacionalidad, otras_nacs,
                estado_civil, idiomas, email_principal, telefono_principal,
                pais_residencia, ciudad_residencia, direccion_principal,
                cargo_actual, empresa_actual, sector_principal,
                es_pep, nivel_pep, nivel_acceso_requerido,
                fuente_primaria, perfil_extendido,
                created_by, updated_by
            ) VALUES (
                :id, :nombre_completo, :nombres, :apellidos, :alias, :genero,
                :fecha_nacimiento, :lugar_nacimiento, :nacionalidad, :otras_nacs,
                :estado_civil, :idiomas, :email_principal, :telefono_principal,
                :pais_residencia, :ciudad_residencia, :direccion_principal,
                :cargo_actual, :empresa_actual, :sector_principal,
                :es_pep, :nivel_pep, :nivel_acceso_requerido,
                :fuente_primaria, CAST(:perfil_extendido AS jsonb),
                :created_by, :updated_by
            )
        """),
        {
            "id": persona_id,
            **body.model_dump(exclude={"perfil_extendido"}),
            "perfil_extendido": _jsonb(body.perfil_extendido),
            "alias": body.alias,
            "otras_nacs": body.otras_nacs,
            "idiomas": body.idiomas,
            "created_by": current_user.id,
            "updated_by": current_user.id,
        },
    )

    # Recalcular score tras crear
    try:
        await recalcular_score_persona(db, persona_id)
    except Exception as e:
        log.warning("Score persona falló — no crítico", error=str(e))

    try:
        await sync_entidad_neo4j("persona", persona_id, body.nombre_completo)
    except Exception as e:
        log.warning("Neo4j sync falló — no es crítico", error=str(e))

    try:
        await _log_accion(db, current_user.id, "create", "persona", persona_id)
    except Exception as e:
        log.warning("Log accion falló — no crítico", error=str(e))

    result = await db.execute(
        text("SELECT * FROM core.v_personas WHERE id = :id"),
        {"id": persona_id},
    )
    row = result.fetchone()
    return dict(row._mapping)


@router.get("/personas/{persona_id}", response_model=PersonaDetalle)
async def obtener_persona(
    persona_id: UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Obtiene el expediente completo de una persona.
    Los campos sensibles se filtran según el nivel del usuario.
    """
    result = await db.execute(
        text("SELECT * FROM core.v_personas WHERE id = :id"),
        {"id": persona_id},
    )
    row = result.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Persona no encontrada")

    persona = dict(row._mapping)

    # Filtrar campos según nivel de acceso del usuario
    if current_user.nivel_acceso < 3:
        for campo in ("nivel_riqueza", "patrimonio_est", "ingresos_anuales_est",
                      "patrimonio_moneda"):
            persona.pop(campo, None)

    if current_user.nivel_acceso < 4:
        for campo in ("listas_externas",):
            persona.pop(campo, None)

    await _log_accion(db, current_user.id, "view", "persona", persona_id)
    return persona


@router.patch("/personas/{persona_id}", response_model=PersonaResumen)
async def actualizar_persona(
    persona_id: UUID,
    body: PersonaUpdate,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_nivel(2)),
):
    """Actualiza campos de una persona. Solo los campos enviados."""
    # Verificar que existe y es accesible (RLS lo garantiza)
    result = await db.execute(
        text("SELECT id FROM core.personas WHERE id = :id AND deleted_at IS NULL"),
        {"id": persona_id},
    )
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="Persona no encontrada")

    # Campos para proteger según nivel
    datos = body.model_dump(exclude_none=True)

    if current_user.nivel_acceso < 3:
        for campo_restringido in ("patrimonio_est", "ingresos_anuales_est"):
            datos.pop(campo_restringido, None)

    if current_user.nivel_acceso < 4:
        for campo_secreto in ("en_lista_vigilancia", "listas_externas"):
            datos.pop(campo_secreto, None)

    if not datos:
        raise HTTPException(status_code=400, detail="No hay campos válidos para actualizar")

    # Construir UPDATE dinámico
    set_clauses = [f"{k} = :{k}" for k in datos]
    set_clauses.append("updated_by = :updated_by")
    params = {**datos, "updated_by": current_user.id, "id": persona_id}

    # JSONB necesita cast especial
    if "perfil_extendido" in datos:
        set_clauses = [
            f"{k} = :{k}::jsonb" if k == "perfil_extendido" else f"{k} = :{k}"
            for k in datos
        ] + ["updated_by = :updated_by"]

    await db.execute(
        text(f"""
            UPDATE core.personas
            SET {', '.join(set_clauses)}
            WHERE id = :id
        """),
        params,
    )

    # Recalcular score si cambiaron campos relevantes
    score_campos = {"es_pep", "nivel_pep", "en_lista_vigilancia",
                    "listas_externas", "patrimonio_est", "nivel_prioridad"}
    if score_campos.intersection(datos.keys()):
        await recalcular_score_persona(db, persona_id)

    # Re-sync Neo4j si cambió el nombre
    if "nombre_completo" in datos:
        try:
            await sync_entidad_neo4j("persona", persona_id, datos["nombre_completo"])
        except Exception:
            pass

    await _log_accion(db, current_user.id, "update", "persona", persona_id,
                      {"campos": list(datos.keys())})

    result = await db.execute(
        text("SELECT * FROM core.v_personas WHERE id = :id"),
        {"id": persona_id},
    )
    return dict(result.fetchone()._mapping)


@router.delete("/personas/{persona_id}", response_model=SuccessResponse)
async def eliminar_persona(
    persona_id: UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_nivel(4)),
):
    """Soft delete. Requiere nivel 4+."""
    await db.execute(
        text("""
            UPDATE core.personas
            SET deleted_at = NOW(), updated_by = :uid
            WHERE id = :id AND deleted_at IS NULL
        """),
        {"id": persona_id, "uid": current_user.id},
    )
    await _log_accion(db, current_user.id, "delete", "persona", persona_id)
    return SuccessResponse(message="Persona eliminada (soft delete)")


@router.get("/personas/{persona_id}/eventos")
async def listar_eventos_persona(
    persona_id: UUID,
    limite: int = 50,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Lista eventos registrados para una persona."""
    try:
        result = await db.execute(
            text("""
                SELECT id, tipo_evento, titulo, descripcion, fecha_evento,
                       pais_evento, fuente, confianza, created_at
                FROM intel.eventos
                WHERE entidad_tipo = 'persona' AND entidad_id = :id
                ORDER BY fecha_evento DESC NULLS LAST, created_at DESC
                LIMIT :limite
            """),
            {"id": persona_id, "limite": limite},
        )
        return [dict(r._mapping) for r in result.fetchall()]
    except Exception:
        return []


@router.post("/personas/{persona_id}/recalcular-score", response_model=ScoreResponse)
async def recalcular_score_endpoint(
    persona_id: UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_nivel(2)),
):
    """Fuerza el recálculo del score de riesgo para una persona."""
    score = await recalcular_score_persona(db, persona_id)

    result = await db.execute(
        text("SELECT score_riesgo, score_influencia, score_version, score_at FROM core.personas WHERE id = :id"),
        {"id": persona_id},
    )
    row = result.fetchone()

    return ScoreResponse(
        entidad_tipo="persona",
        entidad_id=persona_id,
        score_riesgo=float(row.score_riesgo),
        score_influencia=float(row.score_influencia or 0),
        version=row.score_version,
        calculado_at=row.score_at,
    )


# ============================================================
# INSTITUCIONES
# ============================================================

@router.get("/instituciones", response_model=PaginatedResponse)
async def listar_instituciones(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    sector: str | None = None,
    pais: str | None = None,
    estado_legal: str | None = None,
    vigilancia: bool | None = None,
    buscar: str | None = Query(None),
    etiqueta_ids: str | None = Query(None),
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    offset = (page - 1) * page_size
    conditions = ["i.deleted_at IS NULL", "i.activo = TRUE"]
    params: dict = {"limit": page_size, "offset": offset}

    if sector:
        conditions.append("i.sector ILIKE :sector")
        params["sector"] = f"%{sector}%"
    if pais:
        conditions.append("i.pais_registro = :pais")
        params["pais"] = pais
    if estado_legal:
        conditions.append("i.estado_legal = :estado_legal")
        params["estado_legal"] = estado_legal
    if vigilancia is not None:
        conditions.append("i.en_lista_vigilancia = :vigilancia")
        params["vigilancia"] = vigilancia
    if buscar:
        conditions.append("(i.nombre ILIKE :buscar OR i.sector ILIKE :buscar OR i.pais_registro ILIKE :buscar OR i.sede_ciudad ILIKE :buscar)")
        params["buscar"] = f"%{buscar}%"
    if etiqueta_ids:
        ids = [int(x) for x in etiqueta_ids.split(',') if x.strip().isdigit()]
        if ids:
            placeholders = ','.join(f':etq_{i}' for i in range(len(ids)))
            conditions.append(f"""EXISTS (
                SELECT 1 FROM core.entidad_etiquetas ee
                WHERE ee.entidad_tipo = 'institucion'
                AND ee.entidad_id = i.id
                AND ee.etiqueta_id IN ({placeholders})
            )""")
            for i, eid in enumerate(ids):
                params[f'etq_{i}'] = eid

    where_clause = " AND ".join(conditions)

    result = await db.execute(
        text(f"""
            SELECT id, nombre, nombre_corto, alias, sector, tipo_entidad,
                   pais_registro, sede_ciudad, estado_legal, score_riesgo,
                   nivel_prioridad, completitud, nivel_acceso_requerido, created_at
            FROM core.instituciones i
            WHERE {where_clause}
            ORDER BY score_riesgo DESC
            LIMIT :limit OFFSET :offset
        """),
        params,
    )
    rows = result.fetchall()

    count_result = await db.execute(
        text(f"SELECT COUNT(*) FROM core.instituciones i WHERE {where_clause}"),
        {k: v for k, v in params.items() if k not in ("limit", "offset")},
    )
    total = count_result.scalar() or 0

    return PaginatedResponse(
        total=total, page=page, page_size=page_size,
        pages=-(-total // page_size),
        items=[dict(r._mapping) for r in rows],
    )


@router.post("/instituciones", response_model=InstitucionResumen, status_code=201)
async def crear_institucion(
    body: InstitucionCreate,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_nivel(2)),
):
    inst_id = uuid4()
    await db.execute(
        text("""
            INSERT INTO core.instituciones (
                id, nombre, nombre_corto, alias, tipo_entidad, sector, subsector,
                actividad_desc, numero_registro, cif_nif, pais_registro,
                fecha_fundacion, estado_legal, web_principal, email_contacto,
                telefono_central, sede_pais, sede_ciudad, sede_direccion,
                paises_operacion, tipo_propiedad, cotiza_bolsa, numero_empleados,
                nivel_acceso_requerido, fuente_primaria, perfil_extendido,
                created_by, updated_by
            ) VALUES (
                :id, :nombre, :nombre_corto, :alias, :tipo_entidad, :sector, :subsector,
                :actividad_desc, :numero_registro, :cif_nif, :pais_registro,
                :fecha_fundacion, :estado_legal, :web_principal, :email_contacto,
                :telefono_central, :sede_pais, :sede_ciudad, :sede_direccion,
                :paises_operacion, :tipo_propiedad, :cotiza_bolsa, :numero_empleados,
                :nivel_acceso_requerido, :fuente_primaria, CAST(:perfil_extendido AS jsonb),
                :created_by, :updated_by
            )
        """),
        {
            "id": inst_id,
            **body.model_dump(exclude={"perfil_extendido"}),
            "perfil_extendido": _jsonb(body.perfil_extendido),
            "alias": body.alias,
            "paises_operacion": body.paises_operacion,
            "created_by": current_user.id,
            "updated_by": current_user.id,
        },
    )

    try:
        await recalcular_score_institucion(db, inst_id)
    except Exception as e:
        log.warning("Score institucion falló — no crítico", error=str(e))

    try:
        await sync_entidad_neo4j("institucion", inst_id, body.nombre)
    except Exception as e:
        log.warning("Neo4j sync falló", error=str(e))

    try:
        await _log_accion(db, current_user.id, "create", "institucion", inst_id)
    except Exception as e:
        log.warning("Log accion falló — no crítico", error=str(e))

    result = await db.execute(
        text("""
            SELECT id, nombre, nombre_corto, alias, sector, tipo_entidad,
                   pais_registro, sede_ciudad, estado_legal, score_riesgo,
                   nivel_prioridad, completitud, nivel_acceso_requerido, created_at
            FROM core.instituciones WHERE id = :id
        """),
        {"id": inst_id},
    )
    return dict(result.fetchone()._mapping)


@router.get("/instituciones/{inst_id}", response_model=InstitucionDetalle)
async def obtener_institucion(
    inst_id: UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    result = await db.execute(
        text("SELECT * FROM core.instituciones WHERE id = :id AND deleted_at IS NULL"),
        {"id": inst_id},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Institución no encontrada")

    inst = dict(row._mapping)

    if current_user.nivel_acceso < 3:
        for campo in ("capital_social", "patrimonio_neto", "facturacion_anual",
                      "endeudamiento", "cuentas_bancarias_corp"):
            inst.pop(campo, None)
    if current_user.nivel_acceso < 4:
        inst.pop("listas_externas", None)

    await _log_accion(db, current_user.id, "view", "institucion", inst_id)
    return inst


@router.patch("/instituciones/{inst_id}", response_model=InstitucionResumen)
async def actualizar_institucion(
    inst_id: UUID,
    body: InstitucionUpdate,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_nivel(2)),
):
    datos = body.model_dump(exclude_none=True)
    if not datos:
        raise HTTPException(status_code=400, detail="Sin campos para actualizar")

    set_clauses = [
        f"{k} = :{k}::jsonb" if k == "perfil_extendido" else f"{k} = :{k}"
        for k in datos
    ] + ["updated_by = :updated_by"]

    await db.execute(
        text(f"UPDATE core.instituciones SET {', '.join(set_clauses)} WHERE id = :id"),
        {**datos, "updated_by": current_user.id, "id": inst_id},
    )

    score_campos = {"en_lista_vigilancia", "listas_externas", "nivel_prioridad"}
    if score_campos.intersection(datos.keys()):
        await recalcular_score_institucion(db, inst_id)

    await _log_accion(db, current_user.id, "update", "institucion", inst_id)

    result = await db.execute(
        text("""
            SELECT id, nombre, nombre_corto, alias, sector, tipo_entidad,
                   pais_registro, sede_ciudad, estado_legal, score_riesgo,
                   nivel_prioridad, completitud, nivel_acceso_requerido, created_at
            FROM core.instituciones WHERE id = :id
        """),
        {"id": inst_id},
    )
    return dict(result.fetchone()._mapping)


# ── HELPERS ───────────────────────────────────────────────────

import json

def _jsonb(obj) -> str:
    """Serializa un dict a JSON string para parámetros JSONB."""
    if obj is None:
        return "{}"
    return json.dumps(obj, default=str)


async def _log_accion(db, usuario_id, accion, recurso_tipo, recurso_id, extra=None):
    """Registra en audit.log_accesos sin bloquear."""
    try:
        extra_str = json.dumps(extra or {})
        await db.execute(
            text(f"""
                INSERT INTO audit.log_accesos
                    (usuario_id, accion, recurso_tipo, recurso_id, datos_extra)
                VALUES (:uid, :accion, :rtipo, :rid, CAST(:extra AS jsonb))
            """),
            {
                "uid": str(usuario_id),
                "accion": accion,
                "rtipo": recurso_tipo,
                "rid": str(recurso_id) if recurso_id else None,
                "extra": extra_str,
            },
        )
    except Exception as e:
        log.warning("Audit log falló", error=str(e))
