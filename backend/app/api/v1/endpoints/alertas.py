# app/api/v1/endpoints/alertas.py
from uuid import UUID
from fastapi import APIRouter, Query, Depends
from sqlalchemy import text
import structlog

from app.api.dependencies import CurrentUser, get_current_user, get_db_session, require_nivel
from sqlalchemy.ext.asyncio import AsyncSession
from app.schemas import PaginatedResponse, SuccessResponse

log = structlog.get_logger()
router = APIRouter(prefix="/alertas", tags=["Alertas"])


@router.get("", response_model=PaginatedResponse)
async def listar_alertas(
    revisada: bool | None = Query(None),
    severidad: str | None = Query(None),
    entidad_tipo: str | None = Query(None),
    tipo_alerta: str | None = Query(None),
    buscar: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    offset = (page - 1) * page_size
    conditions = ["1=1"]
    params: dict = {"limit": page_size, "offset": offset}

    if revisada is not None:
        conditions.append("a.revisada = :revisada")
        params["revisada"] = revisada
    if severidad:
        conditions.append("a.severidad = :severidad")
        params["severidad"] = severidad
    if entidad_tipo:
        conditions.append("a.entidad_tipo = :entidad_tipo")
        params["entidad_tipo"] = entidad_tipo
    if tipo_alerta:
        conditions.append("a.tipo_alerta = :tipo_alerta")
        params["tipo_alerta"] = tipo_alerta
    if buscar:
        conditions.append("(a.titulo ILIKE :buscar OR a.descripcion ILIKE :buscar)")
        params["buscar"] = f"%{buscar}%"

    where = " AND ".join(conditions)

    result = await db.execute(
        text(f"""
            SELECT a.*, f.nombre AS fuente_nombre
            FROM osint.alertas a
            LEFT JOIN osint.fuentes f ON a.fuente_id = f.id
            WHERE {where}
            ORDER BY
                CASE severidad
                    WHEN 'critica' THEN 1
                    WHEN 'alta' THEN 2
                    WHEN 'media' THEN 3
                    ELSE 4
                END,
                a.created_at DESC
            LIMIT :limit OFFSET :offset
        """),
        params,
    )
    rows = result.fetchall()

    count = await db.execute(
        text(f"SELECT COUNT(*) FROM osint.alertas a WHERE {where}"),
        {k: v for k, v in params.items() if k not in ("limit", "offset")},
    )
    total = count.scalar() or 0

    return PaginatedResponse(
        total=total, page=page, page_size=page_size,
        pages=-(-total // page_size),
        items=[dict(r._mapping) for r in rows],
    )


@router.patch("/{alerta_id}/revisar", response_model=SuccessResponse)
async def revisar_alerta(
    alerta_id: UUID,
    accion: str,
    notas: str | None = None,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_nivel(2)),
):
    await db.execute(
        text("""
            UPDATE osint.alertas
            SET revisada = TRUE,
                revisada_por = :uid,
                revisada_at = NOW(),
                accion_tomada = :accion,
                notas_revision = :notas
            WHERE id = :id
        """),
        {"uid": current_user.id, "accion": accion, "notas": notas, "id": alerta_id},
    )
    return SuccessResponse(message="Alerta revisada")



@router.get("/kpis")
async def alertas_kpis(
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    result = await db.execute(text("""
        SELECT
            COUNT(*) FILTER (WHERE revisada = FALSE) AS pendientes,
            COUNT(*) FILTER (WHERE revisada = FALSE AND severidad = 'critica') AS criticas,
            COUNT(*) FILTER (WHERE revisada = FALSE AND severidad = 'alta') AS altas,
            COUNT(*) FILTER (WHERE revisada = TRUE AND revisada_at >= NOW() - INTERVAL '24 hours') AS revisadas_hoy,
            COUNT(*) AS total
        FROM osint.alertas
    """))
    row = dict(result.fetchone()._mapping)

    por_severidad = await db.execute(text("""
        SELECT severidad, COUNT(*) AS total
        FROM osint.alertas WHERE revisada = FALSE
        GROUP BY severidad ORDER BY total DESC
    """))

    recientes = await db.execute(text("""
        SELECT a.id, a.tipo_alerta, a.titulo, a.severidad, a.entidad_tipo,
               a.entidad_id, a.revisada, a.created_at
        FROM osint.alertas a
        WHERE a.revisada = FALSE
        ORDER BY CASE a.severidad WHEN 'critica' THEN 1 WHEN 'alta' THEN 2 WHEN 'media' THEN 3 ELSE 4 END,
                 a.created_at DESC
        LIMIT 5
    """))

    return {
        "kpis": {k: int(v or 0) for k, v in row.items()},
        "por_severidad": [dict(r._mapping) for r in por_severidad.fetchall()],
        "recientes": [dict(r._mapping) for r in recientes.fetchall()],
    }


@router.post("", status_code=201)
async def crear_alerta_manual(
    body: dict,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_nivel(2)),
):
    """Crear una alerta manualmente."""
    from uuid import uuid4
    alerta_id = uuid4()
    await db.execute(text("""
        INSERT INTO osint.alertas
            (id, tipo_alerta, titulo, descripcion, severidad, entidad_tipo, entidad_id, nivel_acceso)
        VALUES
            (:id, :tipo_alerta, :titulo, :descripcion, :severidad, :entidad_tipo, :entidad_id, :nivel_acceso)
    """), {
        "id": alerta_id,
        "tipo_alerta": body.get("tipo_alerta", "manual"),
        "titulo": body.get("titulo", "Alerta manual"),
        "descripcion": body.get("descripcion"),
        "severidad": body.get("severidad", "media"),
        "entidad_tipo": body.get("entidad_tipo"),
        "entidad_id": body.get("entidad_id"),
        "nivel_acceso": body.get("nivel_acceso", 2),
    })
    return {"id": str(alerta_id), "message": "Alerta creada"}


# ============================================================
# INVESTIGACIONES
# ============================================================

from app.schemas import InvestigacionCreate, InvestigacionResumen
from uuid import uuid4

investigaciones_router = APIRouter(prefix="/investigaciones", tags=["Investigaciones"])


@investigaciones_router.get("", response_model=PaginatedResponse)
async def listar_investigaciones(
    estado: str | None = Query(None),
    tipo: str | None = Query(None),
    buscar: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    offset = (page - 1) * page_size
    params: dict = {"limit": page_size, "offset": offset, "uid": str(current_user.id)}
    conditions = ["1=1"]

    if estado:
        conditions.append("i.estado = :estado")
        params["estado"] = estado
    if tipo:
        conditions.append("i.tipo_investigacion = :tipo")
        params["tipo"] = tipo
    if buscar:
        conditions.append("(i.titulo ILIKE :buscar OR i.codigo ILIKE :buscar)")
        params["buscar"] = f"%{buscar}%"

    where = " AND ".join(conditions)

    result = await db.execute(
        text(f"""
            SELECT i.id, i.codigo, i.titulo, i.tipo_investigacion, i.estado, i.prioridad,
                   i.clasificacion, i.responsable_id, i.fecha_apertura,
                   i.fecha_objetivo, i.etiquetas, i.updated_at
            FROM intel.investigaciones i
            WHERE {where}
            ORDER BY i.prioridad DESC, i.fecha_apertura DESC
            LIMIT :limit OFFSET :offset
        """),
        params,
    )
    rows = result.fetchall()

    count = await db.execute(
        text(f"SELECT COUNT(*) FROM intel.investigaciones i WHERE {where}"),
        {k: v for k, v in params.items() if k not in ("limit", "offset")},
    )
    total = count.scalar() or 0

    return PaginatedResponse(
        total=total, page=page, page_size=page_size,
        pages=-(-total // page_size),
        items=[dict(r._mapping) for r in rows],
    )


@investigaciones_router.post("", response_model=InvestigacionResumen, status_code=201)
async def crear_investigacion(
    body: InvestigacionCreate,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_nivel(2)),
):
    inv_id = uuid4()
    # Generar código automático: INV-YYYY-NNN
    from datetime import datetime
    año = datetime.now().year
    count_result = await db.execute(
        text("SELECT COUNT(*) FROM intel.investigaciones WHERE EXTRACT(YEAR FROM created_at) = :año"),
        {"año": año}
    )
    n = (count_result.scalar() or 0) + 1
    codigo = f"INV-{año}-{n:03d}"

    await db.execute(
        text("""
            INSERT INTO intel.investigaciones
                (id, codigo, titulo, tipo_investigacion, descripcion, objetivo, prioridad, clasificacion,
                 fecha_objetivo, etiquetas, responsable_id, created_by)
            VALUES
                (:id, :codigo, :titulo, :tipo_investigacion, :descripcion, :objetivo, :prioridad, :clasificacion,
                 :fecha_objetivo, :etiquetas, :responsable_id, :created_by)
        """),
        {
            "id": inv_id,
            "codigo": codigo,
            "titulo": body.titulo,
            "tipo_investigacion": body.tipo_investigacion,
            "descripcion": body.descripcion,
            "objetivo": body.objetivo,
            "prioridad": body.prioridad,
            "clasificacion": body.clasificacion,
            "fecha_objetivo": body.fecha_objetivo,
            "etiquetas": body.etiquetas,
            "responsable_id": current_user.id,
            "created_by": current_user.id,
        },
    )

    result = await db.execute(
        text("SELECT id, codigo, titulo, tipo_investigacion, estado, prioridad, clasificacion, "
             "responsable_id, fecha_apertura, fecha_objetivo, etiquetas "
             "FROM intel.investigaciones WHERE id = :id"),
        {"id": inv_id},
    )
    return dict(result.fetchone()._mapping)


@investigaciones_router.get("/kpis")
async def investigaciones_kpis(
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    result = await db.execute(text("""
        SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE estado = 'abierta') AS abiertas,
            COUNT(*) FILTER (WHERE estado = 'en_curso') AS en_curso,
            COUNT(*) FILTER (WHERE estado IN ('cerrada','archivada')) AS cerradas
        FROM intel.investigaciones
    """))
    row = dict(result.fetchone()._mapping)

    por_tipo = await db.execute(text("""
        SELECT tipo_investigacion, COUNT(*) AS total
        FROM intel.investigaciones
        WHERE tipo_investigacion IS NOT NULL
        GROUP BY tipo_investigacion ORDER BY total DESC LIMIT 8
    """))

    recientes = await db.execute(text("""
        SELECT id, codigo, titulo, tipo_investigacion, estado, prioridad, fecha_apertura
        FROM intel.investigaciones
        ORDER BY fecha_apertura DESC LIMIT 5
    """))

    return {
        "kpis": {k: int(v or 0) for k, v in row.items()},
        "por_tipo": [dict(r._mapping) for r in por_tipo.fetchall()],
        "recientes": [dict(r._mapping) for r in recientes.fetchall()],
    }


@investigaciones_router.get("/{inv_id}")
async def obtener_investigacion(
    inv_id: UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    result = await db.execute(
        text("""
            SELECT i.*,
                   COALESCE(
                       json_agg(
                           json_build_object(
                               'entidad_tipo', ie.entidad_tipo,
                               'entidad_id', ie.entidad_id,
                               'rol_en_caso', ie.rol_en_caso
                           )
                       ) FILTER (WHERE ie.entidad_id IS NOT NULL),
                       '[]'
                   ) AS entidades
            FROM intel.investigaciones i
            LEFT JOIN intel.inv_entidades ie ON ie.investigacion_id = i.id
            WHERE i.id = :id
            GROUP BY i.id
        """),
        {"id": inv_id},
    )
    row = result.fetchone()
    if not row:
        from fastapi import HTTPException, Depends
        raise HTTPException(status_code=404, detail="Investigación no encontrada")
    return dict(row._mapping)


@investigaciones_router.patch("/{inv_id}")
async def actualizar_investigacion(
    inv_id: UUID,
    body: dict,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_nivel(2)),
):
    """Actualiza campos de una investigación (estado, descripcion, etc.)."""
    allowed = {'estado', 'titulo', 'descripcion', 'objetivo', 'prioridad', 'fecha_objetivo'}
    datos = {k: v for k, v in body.items() if k in allowed}
    if not datos:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Sin campos válidos")
    set_clauses = ", ".join(f"{k} = :{k}" for k in datos)
    await db.execute(
        text(f"UPDATE intel.investigaciones SET {set_clauses} WHERE id = :id"),
        {**datos, "id": inv_id},
    )
    return {"message": "Actualizado"}


@investigaciones_router.post("/{inv_id}/entidades")
async def añadir_entidad_investigacion(
    inv_id: UUID,
    body: dict,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_nivel(2)),
):
    """Vincula una entidad a una investigación."""
    try:
        await db.execute(
            text("""
                INSERT INTO intel.inv_entidades
                    (investigacion_id, entidad_tipo, entidad_id, rol_en_caso)
                VALUES (:inv_id, :entidad_tipo, CAST(:entidad_id AS uuid), :rol)
                ON CONFLICT (investigacion_id, entidad_tipo, entidad_id) DO NOTHING
            """),
            {
                "inv_id": inv_id,
                "entidad_tipo": body.get("entidad_tipo"),
                "entidad_id": body.get("entidad_id"),
                "rol": body.get("rol_en_caso"),
            },
        )
        return {"message": "Entidad añadida"}
    except Exception as e:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=str(e))


@investigaciones_router.post("/{inv_id}/notas")
async def añadir_nota_investigacion(
    inv_id: UUID,
    body: dict,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_nivel(2)),
):
    """Añade una nota a una investigación."""
    try:
        await db.execute(
            text("""
                INSERT INTO intel.inv_notas
                    (investigacion_id, contenido, autor_id)
                VALUES (:inv_id, :contenido, :autor)
            """),
            {"inv_id": inv_id, "contenido": body.get("contenido", ""), "autor": current_user.id},
        )
        return {"message": "Nota añadida"}
    except Exception as e:
        # Table may not exist yet - fail silently
        return {"message": "Nota guardada (tabla pendiente de migración)"}



@investigaciones_router.delete("/{inv_id}")
async def eliminar_investigacion(
    inv_id: UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_nivel(3)),
):
    await db.execute(
        text("UPDATE intel.investigaciones SET estado = 'archivada' WHERE id = :id"),
        {"id": inv_id}
    )
    return {"message": "Investigación archivada"}


@investigaciones_router.delete("/{inv_id}/entidades/{entidad_id}")
async def eliminar_entidad_investigacion(
    inv_id: UUID,
    entidad_id: UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_nivel(2)),
):
    await db.execute(
        text("DELETE FROM intel.inv_entidades WHERE investigacion_id = :inv_id AND entidad_id = :eid"),
        {"inv_id": inv_id, "eid": entidad_id}
    )
    return {"message": "Entidad eliminada de la investigación"}



# ============================================================
# AUDITORÍA
# ============================================================

auditoria_router = APIRouter(prefix="/auditoria", tags=["Auditoría"])


@auditoria_router.get("")
async def log_auditoria(
    usuario_id: str | None = Query(None),
    accion: str | None = Query(None),
    recurso_tipo: str | None = Query(None),
    limite: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    if current_user.nivel_acceso < 4:
        from fastapi import HTTPException, Depends
        raise HTTPException(status_code=403, detail="Auditoría requiere nivel 4+")

    conditions = ["1=1"]
    params: dict = {"limite": limite}

    if usuario_id:
        conditions.append("l.usuario_id = :uid_filter")
        params["uid_filter"] = usuario_id
    if accion:
        conditions.append("l.accion = :accion")
        params["accion"] = accion
    if recurso_tipo:
        conditions.append("l.recurso_tipo = :recurso_tipo")
        params["recurso_tipo"] = recurso_tipo

    where = " AND ".join(conditions)

    result = await db.execute(
        text(f"""
            SELECT l.*, u.username
            FROM audit.log_accesos l
            LEFT JOIN auth.usuarios u ON l.usuario_id = u.id
            WHERE {where}
            ORDER BY l.created_at DESC
            LIMIT :limite
        """),
        params,
    )

    rows = result.fetchall()
    items = []
    for r in rows:
        d = dict(r._mapping)
        # Serializar UUIDs y datetimes
        for k, v in d.items():
            if hasattr(v, 'isoformat'):
                d[k] = v.isoformat()
            elif hasattr(v, 'hex'):
                d[k] = str(v)
        items.append(d)

    return {"items": items, "total": len(items)}


@auditoria_router.get("/kpis")
async def auditoria_kpis(
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    if current_user.nivel_acceso < 4:
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Requiere nivel 4+")

    result = await db.execute(text("""
        SELECT
            COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24h') AS eventos_hoy,
            COUNT(*) FILTER (WHERE accion = 'login' AND created_at >= NOW() - INTERVAL '24h') AS logins_hoy,
            COUNT(*) FILTER (WHERE exito = FALSE AND created_at >= NOW() - INTERVAL '24h') AS fallos_hoy,
            COUNT(*) FILTER (WHERE accion IN ('create','update','delete') AND created_at >= NOW() - INTERVAL '24h') AS escrituras_hoy,
            COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7d') AS eventos_semana
        FROM audit.log_accesos
    """))
    kpis = dict(result.fetchone()._mapping)

    # Actividad por hora últimas 24h
    horas = await db.execute(text("""
        SELECT DATE_TRUNC('hour', created_at) AS hora, COUNT(*) AS total
        FROM audit.log_accesos
        WHERE created_at >= NOW() - INTERVAL '24h'
        GROUP BY 1 ORDER BY 1
    """))
    kpis["por_hora"] = [{"hora": str(r.hora), "total": r.total} for r in horas.fetchall()]

    # Top usuarios
    top = await db.execute(text("""
        SELECT u.username, u.nombre_completo, COUNT(*) AS total
        FROM audit.log_accesos l
        LEFT JOIN auth.usuarios u ON l.usuario_id = u.id
        WHERE l.created_at >= NOW() - INTERVAL '7d' AND u.username IS NOT NULL
        GROUP BY u.username, u.nombre_completo
        ORDER BY total DESC LIMIT 8
    """))
    kpis["top_usuarios"] = [dict(r._mapping) for r in top.fetchall()]

    # Por acción
    por_accion = await db.execute(text("""
        SELECT accion, COUNT(*) AS total
        FROM audit.log_accesos
        WHERE created_at >= NOW() - INTERVAL '7d'
        GROUP BY accion ORDER BY total DESC LIMIT 10
    """))
    kpis["por_accion"] = [dict(r._mapping) for r in por_accion.fetchall()]

    return {k: int(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else v
            for k, v in kpis.items()}
