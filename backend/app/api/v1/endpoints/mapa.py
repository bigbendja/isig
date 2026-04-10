# app/api/v1/endpoints/mapa.py
# ============================================================
# Endpoints del mapa — entidades con coordenadas
# Optimizado para Leaflet: devuelve solo lo necesario
# ============================================================
from fastapi import APIRouter, Query, Depends
from sqlalchemy import text
import structlog

from app.api.dependencies import CurrentUser, get_current_user, get_db_session, require_nivel
from sqlalchemy.ext.asyncio import AsyncSession

log = structlog.get_logger()
router = APIRouter(prefix="/mapa", tags=["Mapa"])


@router.get("/entidades")
async def entidades_mapa(
    norte: float | None = Query(None, description="Límite norte del viewport"),
    sur:   float | None = Query(None),
    este:  float | None = Query(None),
    oeste: float | None = Query(None),
    tipo:  str   | None = Query(None, pattern="^(persona|institucion)$"),
    riesgo_min: float   = Query(0.0, ge=0, le=1),
    limite: int         = Query(500, ge=1, le=2000),
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Entidades con coordenadas para mostrar en el mapa.
    Si se pasan bounds (norte/sur/este/oeste), filtra por viewport.
    El RLS garantiza que solo se ven entidades del nivel del usuario.
    """
    # Filtro geográfico — si hay bounds, aplicar PostGIS
    geo_filter_p = ""
    geo_filter_i = ""
    params: dict = {"riesgo_min": riesgo_min, "limite": limite, "tipo": tipo}

    if all(v is not None for v in [norte, sur, este, oeste]):
        geo_filter_p = """
            AND ST_Within(
                ubicacion_actual::geometry,
                ST_MakeEnvelope(:oeste, :sur, :este, :norte, 4326)
            )
        """
        geo_filter_i = """
            AND ST_Within(
                sede_coords::geometry,
                ST_MakeEnvelope(:oeste, :sur, :este, :norte, 4326)
            )
        """
        params.update({"norte": norte, "sur": sur, "este": este, "oeste": oeste})

    personas_query = "" if tipo == "institucion" else f"""
        SELECT
            'persona'::text AS tipo,
            p.id::text,
            p.nombre_completo AS nombre,
            ST_Y(p.ubicacion_actual::geometry)::float AS lat,
            ST_X(p.ubicacion_actual::geometry)::float AS lng,
            p.score_riesgo::float,
            p.es_pep,
            p.en_lista_vigilancia,
            p.ciudad_residencia AS ciudad,
            p.pais_residencia AS pais,
            p.cargo_actual AS subtitulo
        FROM core.personas p
        WHERE p.deleted_at IS NULL
          AND p.activo = TRUE
          AND p.ubicacion_actual IS NOT NULL
          AND p.score_riesgo >= :riesgo_min
          {geo_filter_p}
    """

    inst_query = "" if tipo == "persona" else f"""
        SELECT
            'institucion'::text AS tipo,
            i.id::text,
            i.nombre,
            ST_Y(i.sede_coords::geometry)::float AS lat,
            ST_X(i.sede_coords::geometry)::float AS lng,
            i.score_riesgo::float,
            FALSE AS es_pep,
            i.en_lista_vigilancia,
            i.sede_ciudad AS ciudad,
            i.pais_registro AS pais,
            i.sector AS subtitulo
        FROM core.instituciones i
        WHERE i.deleted_at IS NULL
          AND i.activo = TRUE
          AND i.sede_coords IS NOT NULL
          AND i.score_riesgo >= :riesgo_min
          {geo_filter_i}
    """

    # Combinar queries según filtro de tipo
    if tipo == "persona":
        full_query = personas_query
    elif tipo == "institucion":
        full_query = inst_query
    else:
        full_query = f"{personas_query} UNION ALL {inst_query}"

    full_query = f"""
        SELECT * FROM ({full_query}) entidades
        ORDER BY score_riesgo DESC
        LIMIT :limite
    """

    result = await db.execute(text(full_query), params)
    rows = result.fetchall()

    return [
        {
            "tipo":               r.tipo,
            "id":                 r.id,
            "nombre":             r.nombre,
            "lat":                r.lat,
            "lng":                r.lng,
            "score_riesgo":       round(r.score_riesgo, 3),
            "es_pep":             r.es_pep,
            "en_lista_vigilancia": r.en_lista_vigilancia,
            "ciudad":             r.ciudad,
            "pais":               r.pais,
            "subtitulo":          r.subtitulo,
        }
        for r in rows
        if r.lat is not None and r.lng is not None
    ]


@router.get("/heatmap")
async def heatmap_data(
    tipo: str | None = Query(None),
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Datos para el heatmap — lat/lng con intensidad (score_riesgo).
    Formato compatible con Leaflet.heat.
    """
    personas_q = "" if tipo == "institucion" else """
        SELECT ST_Y(ubicacion_actual::geometry) AS lat,
               ST_X(ubicacion_actual::geometry) AS lng,
               score_riesgo AS intensidad
        FROM core.personas
        WHERE deleted_at IS NULL AND activo = TRUE AND ubicacion_actual IS NOT NULL
    """
    inst_q = "" if tipo == "persona" else """
        SELECT ST_Y(sede_coords::geometry) AS lat,
               ST_X(sede_coords::geometry) AS lng,
               score_riesgo AS intensidad
        FROM core.instituciones
        WHERE deleted_at IS NULL AND activo = TRUE AND sede_coords IS NOT NULL
    """

    if tipo == "persona":
        query = personas_q
    elif tipo == "institucion":
        query = inst_q
    else:
        query = f"{personas_q} UNION ALL {inst_q}"

    result = await db.execute(text(query))
    # Formato: [[lat, lng, intensidad], ...]
    return [[float(r.lat), float(r.lng), float(r.intensidad)] for r in result.fetchall()]


@router.get("/geocodificar")
async def geocodificar_entidad(
    entidad_tipo: str = Query(..., pattern="^(persona|institucion)$"),
    entidad_id: str = Query(...),
    direccion: str = Query(..., min_length=5),
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Geocodifica una dirección y actualiza la ubicación de la entidad.
    Usa Nominatim (OpenStreetMap) — sin coste.
    """
    import httpx

    async with httpx.AsyncClient() as client:
        try:
            r = await client.get(
                "https://nominatim.openstreetmap.org/search",
                params={"q": direccion, "format": "json", "limit": 1},
                headers={"User-Agent": "SIGINT-DataCenter/1.0"},
                timeout=10,
            )
            data = r.json()
        except Exception as e:
            return {"error": f"Error de geocodificación: {e}"}

    if not data:
        return {"error": "Dirección no encontrada"}

    lat = float(data[0]["lat"])
    lng = float(data[0]["lon"])

    # Actualizar en BD
    tabla = "personas" if entidad_tipo == "persona" else "instituciones"
    campo = "ubicacion_actual" if entidad_tipo == "persona" else "sede_coords"
    ciudad_campo = "ciudad_residencia" if entidad_tipo == "persona" else "sede_ciudad"

    await db.execute(
        text(f"""
            UPDATE core.{tabla}
            SET {campo} = ST_SetSRID(ST_MakePoint(:lng, :lat), 4326),
                updated_by = :uid
            WHERE id = :eid
        """),
        {"lat": lat, "lng": lng, "eid": entidad_id, "uid": str(current_user.id)},
    )

    log.info("Entidad geocodificada", tipo=entidad_tipo, id=entidad_id, lat=lat, lng=lng)

    return {
        "lat": lat,
        "lng": lng,
        "display_name": data[0].get("display_name"),
        "actualizado": True,
    }


@router.get("/paises")
async def entidades_por_pais(
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Cuenta entidades por país para el choropleth del mapa."""
    result = await db.execute(text("""
        SELECT pais, COUNT(*) as total, AVG(score_riesgo) as score_medio
        FROM (
            SELECT pais_residencia AS pais, score_riesgo
            FROM core.personas WHERE deleted_at IS NULL AND activo = TRUE AND pais_residencia IS NOT NULL
            UNION ALL
            SELECT pais_registro AS pais, score_riesgo
            FROM core.instituciones WHERE deleted_at IS NULL AND activo = TRUE AND pais_registro IS NOT NULL
        ) t
        GROUP BY pais
        ORDER BY total DESC
    """))
    return [{"pais": r.pais, "total": r.total, "score_medio": float(r.score_medio or 0)} for r in result.fetchall()]
