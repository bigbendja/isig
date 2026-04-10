# app/api/v1/endpoints/grafo.py
# ============================================================
# Endpoints del grafo de vínculos — Neo4j
# PageRank, camino más corto, comunidades, vecindad
# ============================================================
from uuid import UUID
from fastapi import APIRouter, HTTPException, Query, Depends
import structlog

from app.api.dependencies import CurrentUser, get_current_user, get_db_session, require_nivel
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_neo4j_driver

log = structlog.get_logger()
router = APIRouter(prefix="/grafo", tags=["Grafo de vínculos"])


# ── HELPERS ───────────────────────────────────────────────────

async def neo4j_session():
    driver = await get_neo4j_driver()
    return driver


def node_to_dict(node) -> dict:
    """Convierte un nodo Neo4j a dict serializable."""
    props = dict(node.items())
    return {
        "id":          props.get("pg_id", ""),
        "nombre":      props.get("nombre_completo") or props.get("nombre", ""),
        "tipo":        "persona" if "Persona" in node.labels else "institucion",
        "score_riesgo": float(props.get("score_riesgo", 0)),
        "nivel_prioridad": int(props.get("nivel_prioridad", 1)),
    }


def rel_to_dict(rel, origen_id: str, destino_id: str) -> dict:
    props = dict(rel.items())
    return {
        "id":         props.get("pg_id", f"{origen_id}_{destino_id}"),
        "origen_id":  origen_id,
        "destino_id": destino_id,
        "tipo":       rel.type,
        "intensidad": float(props.get("intensidad", 0.5)),
        "confianza":  int(props.get("confianza", 3)),
        "vigente":    bool(props.get("vigente", True)),
    }


# ── GRAFO GLOBAL ──────────────────────────────────────────────

@router.get("/global")
async def grafo_global(
    limite: int = Query(150, ge=10, le=500, description="Máx. vínculos a devolver"),
    riesgo_min: float = Query(0.0, ge=0, le=1),
    tipo: str | None = Query(None, pattern="^(persona|institucion)$"),
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Devuelve nodos y aristas para el grafo completo.
    Lee de PostgreSQL directamente (fuente de verdad).
    Formato compatible con Cytoscape.js elements.
    """
    from sqlalchemy import text

    # Build filter
    where_clauses = ["v.vigente = TRUE"]
    if tipo:
        where_clauses.append(f"(v.origen_tipo = '{tipo}' AND v.destino_tipo = '{tipo}')")

    where = " AND ".join(where_clauses)

    # Load ALL active nodes (personas + instituciones) regardless of edges
    personas_result = await db.execute(text("""
        SELECT id::text, nombre_completo AS nombre, 'persona' AS tipo, score_riesgo
        FROM core.personas WHERE deleted_at IS NULL AND activo = TRUE
        LIMIT :limite
    """), {"limite": limite})

    inst_result = await db.execute(text("""
        SELECT id::text, nombre, 'institucion' AS tipo, score_riesgo
        FROM core.instituciones WHERE deleted_at IS NULL AND activo = TRUE
        LIMIT :limite
    """), {"limite": limite})

    nodes: dict[str, dict] = {}
    for row in personas_result.fetchall():
        r = dict(row._mapping)
        if not tipo or tipo == 'persona':
            nodes[r["id"]] = {"id": r["id"], "nombre": r["nombre"], "tipo": "persona", "score_riesgo": float(r["score_riesgo"] or 0), "nivel_prioridad": 1}

    for row in inst_result.fetchall():
        r = dict(row._mapping)
        if not tipo or tipo == 'institucion':
            nodes[r["id"]] = {"id": r["id"], "nombre": r["nombre"], "tipo": "institucion", "score_riesgo": float(r["score_riesgo"] or 0), "nivel_prioridad": 1}

    # Load active edges
    result = await db.execute(
        text(f"""
            SELECT
                v.id, v.origen_tipo, v.origen_id, v.destino_tipo, v.destino_id,
                v.intensidad, v.confianza,
                tv.nombre AS tipo_vinculo_nombre
            FROM intel.vinculos v
            LEFT JOIN core.tipos_vinculo tv ON v.tipo_vinculo_id = tv.id
            WHERE {where}
            ORDER BY v.intensidad DESC
            LIMIT :limite
        """),
        {"limite": limite},
    )
    rows = result.fetchall()
    edges: list[dict] = []

    for row in rows:
        r = dict(row._mapping)
        a_id = str(r["origen_id"])
        b_id = str(r["destino_id"])
        if a_id and b_id:
            edges.append({
                "id": str(r["id"]),
                "origen_id": a_id,
                "destino_id": b_id,
                "tipo": r["tipo_vinculo_nombre"] or "vinculo",
                "intensidad": float(r["intensidad"] or 0.5),
                "confianza": int(r["confianza"] or 3),
                "vigente": True,
            })

    return {
        "nodos":   list(nodes.values()),
        "aristas": edges,
        "total_nodos":   len(nodes),
        "total_aristas": len(edges),
    }


# ── VECINDAD DE UNA ENTIDAD ───────────────────────────────────

@router.get("/vecindad/{tipo}/{entidad_id}")
async def vecindad_entidad(
    tipo: str,
    entidad_id: str,
    profundidad: int = Query(1, ge=1, le=3),
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Subgrafo centrado en una entidad — lee de PostgreSQL."""
    from sqlalchemy import text

    visited_nodes: dict[str, dict] = {}
    edges: list[dict] = []
    frontier = {entidad_id}

    for _ in range(profundidad):
        if not frontier:
            break
        placeholders = ','.join(f':id_{i}' for i in range(len(frontier)))
        params = {f'id_{i}': uid for i, uid in enumerate(frontier)}

        result = await db.execute(text(f"""
            SELECT v.id, v.origen_tipo, v.origen_id::text, v.destino_tipo, v.destino_id::text,
                   v.intensidad, tv.nombre AS tipo_vinculo,
                   CASE v.origen_tipo WHEN 'persona' THEN p.nombre_completo WHEN 'institucion' THEN i.nombre END AS origen_nombre,
                   CASE v.origen_tipo WHEN 'persona' THEN p.score_riesgo WHEN 'institucion' THEN i.score_riesgo END AS origen_score,
                   CASE v.destino_tipo WHEN 'persona' THEN p2.nombre_completo WHEN 'institucion' THEN i2.nombre END AS destino_nombre,
                   CASE v.destino_tipo WHEN 'persona' THEN p2.score_riesgo WHEN 'institucion' THEN i2.score_riesgo END AS destino_score
            FROM intel.vinculos v
            LEFT JOIN core.tipos_vinculo tv ON tv.id = v.tipo_vinculo_id
            LEFT JOIN core.personas p ON v.origen_tipo = 'persona' AND p.id = v.origen_id
            LEFT JOIN core.instituciones i ON v.origen_tipo = 'institucion' AND i.id = v.origen_id
            LEFT JOIN core.personas p2 ON v.destino_tipo = 'persona' AND p2.id = v.destino_id
            LEFT JOIN core.instituciones i2 ON v.destino_tipo = 'institucion' AND i2.id = v.destino_id
            WHERE v.vigente = TRUE
            AND (v.origen_id::text IN ({placeholders}) OR v.destino_id::text IN ({placeholders}))
        """), params)

        new_frontier = set()
        for row in result.fetchall():
            r = dict(row._mapping)
            eid  = str(r['id'])
            src  = r['origen_id']
            tgt  = r['destino_id']

            if src not in visited_nodes:
                visited_nodes[src] = {'id': src, 'nombre': r['origen_nombre'] or src[:8], 'tipo': r['origen_tipo'], 'score_riesgo': float(r['origen_score'] or 0)}
            if tgt not in visited_nodes:
                visited_nodes[tgt] = {'id': tgt, 'nombre': r['destino_nombre'] or tgt[:8], 'tipo': r['destino_tipo'], 'score_riesgo': float(r['destino_score'] or 0)}

            if not any(e['id'] == eid for e in edges):
                edges.append({'id': eid, 'source': src, 'target': tgt, 'tipo': r['tipo_vinculo'] or 'vínculo', 'intensidad': float(r['intensidad'] or 0.5)})

            if src not in frontier: new_frontier.add(src)
            if tgt not in frontier: new_frontier.add(tgt)

        # Next frontier = newly discovered nodes not yet visited
        frontier = new_frontier - set(visited_nodes.keys())

    # Ensure center node is included
    if entidad_id not in visited_nodes:
        if tipo == 'persona':
            res = await db.execute(text("SELECT id::text, nombre_completo AS nombre, score_riesgo FROM core.personas WHERE id::text = :id"), {"id": entidad_id})
        else:
            res = await db.execute(text("SELECT id::text, nombre, score_riesgo FROM core.instituciones WHERE id::text = :id"), {"id": entidad_id})
        row = res.fetchone()
        if row:
            r = dict(row._mapping)
            visited_nodes[entidad_id] = {'id': entidad_id, 'nombre': r['nombre'], 'tipo': tipo, 'score_riesgo': float(r['score_riesgo'] or 0)}

    return {'nodos': list(visited_nodes.values()), 'aristas': edges, 'centro_id': entidad_id}

# ── CAMINO MÁS CORTO ──────────────────────────────────────────

@router.get("/camino-corto")
async def camino_mas_corto(
    origen_id: str = Query(...),
    destino_id: str = Query(...),
    max_saltos: int = Query(6, ge=2, le=10),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Camino más corto entre dos entidades en el grafo.
    Responde: ¿cómo están conectados A y B?
    """
    driver = await get_neo4j_driver()

    async with driver.session() as session:
        result = await session.run(
            """
            MATCH (origen {pg_id: $origen}), (destino {pg_id: $destino})
            MATCH path = shortestPath((origen)-[*..%d]-(destino))
            RETURN [node in nodes(path) | {
                pg_id: node.pg_id,
                nombre: coalesce(node.nombre_completo, node.nombre),
                labels: labels(node)
            }] AS nodos_path,
            length(path) AS saltos
            """ % max_saltos,
            origen=origen_id,
            destino=destino_id,
        )
        record = await result.single()

    if not record:
        raise HTTPException(
            status_code=404,
            detail=f"No hay conexión entre las entidades en menos de {max_saltos} saltos"
        )

    nodos_path = record["nodos_path"]
    return {
        "saltos":       record["saltos"],
        "ruta": [
            {
                "id":     n["pg_id"],
                "nombre": n["nombre"],
                "tipo":   "persona" if "Persona" in n["labels"] else "institucion",
            }
            for n in nodos_path
        ],
    }


# ── PAGERANK ──────────────────────────────────────────────────

@router.get("/pagerank")
async def pagerank(
    top_n: int = Query(20, ge=5, le=100),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    """
    Top N entidades por PageRank (influencia en la red).
    Usa Neo4j GDS si está disponible; fallback a grado de conectividad.
    """
    driver = await get_neo4j_driver()

    try:
        # Intentar con GDS (Graph Data Science)
        async with driver.session() as session:
            result = await session.run(
                """
                CALL gds.pageRank.stream({
                    nodeProjection: ['Persona', 'Institucion'],
                    relationshipProjection: {
                        ALL: {
                            type: '*',
                            orientation: 'UNDIRECTED',
                            properties: {intensidad: {property: 'intensidad', defaultValue: 0.5}}
                        }
                    },
                    dampingFactor: 0.85,
                    maxIterations: 20,
                    relationshipWeightProperty: 'intensidad'
                })
                YIELD nodeId, score
                WITH gds.util.asNode(nodeId) AS node, score
                RETURN
                    node.pg_id AS id,
                    coalesce(node.nombre_completo, node.nombre) AS nombre,
                    labels(node) AS labels,
                    node.score_riesgo AS score_riesgo,
                    score AS pagerank_score
                ORDER BY score DESC
                LIMIT $top_n
                """,
                top_n=top_n,
            )
            records = await result.data()

        return [
            {
                "id":            r["id"],
                "nombre":        r["nombre"],
                "tipo":          "persona" if "Persona" in r["labels"] else "institucion",
                "score_riesgo":  float(r["score_riesgo"] or 0),
                "pagerank_score": float(r["pagerank_score"]),
                "metodo":        "gds_pagerank",
            }
            for r in records
        ]

    except Exception as gds_error:
        log.warning("GDS no disponible, usando fallback de grado", error=str(gds_error))

        # Fallback — ordenar por número de conexiones
        async with driver.session() as session:
            result = await session.run(
                """
                MATCH (n)-[r]-()
                WHERE r.vigente = true
                WITH n, COUNT(r) AS grado
                RETURN
                    n.pg_id AS id,
                    coalesce(n.nombre_completo, n.nombre) AS nombre,
                    labels(n) AS labels,
                    n.score_riesgo AS score_riesgo,
                    grado AS pagerank_score
                ORDER BY grado DESC
                LIMIT $top_n
                """,
                top_n=top_n,
            )
            records = await result.data()

        return [
            {
                "id":            r["id"],
                "nombre":        r["nombre"],
                "tipo":          "persona" if "Persona" in (r.get("labels") or []) else "institucion",
                "score_riesgo":  float(r["score_riesgo"] or 0),
                "pagerank_score": float(r["pagerank_score"]),
                "metodo":        "grado_conexiones",
            }
            for r in records
        ]


# ── DETECCIÓN DE COMUNIDADES ──────────────────────────────────

@router.get("/comunidades")
async def detectar_comunidades(
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Detecta comunidades (clusters) en el grafo usando algoritmo Louvain.
    Útil para identificar grupos de entidades relacionadas.
    """
    driver = await get_neo4j_driver()

    try:
        async with driver.session() as session:
            result = await session.run(
                """
                CALL gds.louvain.stream({
                    nodeProjection: ['Persona', 'Institucion'],
                    relationshipProjection: {
                        ALL: {type: '*', orientation: 'UNDIRECTED'}
                    }
                })
                YIELD nodeId, communityId
                WITH gds.util.asNode(nodeId) AS node, communityId
                RETURN
                    communityId,
                    COUNT(node) AS tamaño,
                    COLLECT({
                        id: node.pg_id,
                        nombre: coalesce(node.nombre_completo, node.nombre),
                        tipo: CASE WHEN 'Persona' IN labels(node) THEN 'persona' ELSE 'institucion' END,
                        score_riesgo: node.score_riesgo
                    })[..10] AS miembros_muestra
                ORDER BY tamaño DESC
                LIMIT 20
                """
            )
            records = await result.data()

        return [
            {
                "comunidad_id": r["communityId"],
                "tamaño":       r["tamaño"],
                "miembros":     r["miembros_muestra"],
            }
            for r in records
        ]

    except Exception as e:
        log.warning("GDS Louvain no disponible", error=str(e))
        return {"error": "Algoritmo de comunidades requiere Neo4j GDS. Instala el plugin.", "detalle": str(e)}


# ── ACTUALIZAR SCORES DE INFLUENCIA DESDE NEO4J → POSTGRESQL ──

@router.post("/sync-scores")
async def sync_scores_influencia(
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    """
    Calcula PageRank en Neo4j y actualiza score_influencia
    en PostgreSQL para todas las entidades.
    Solo admins.
    """
    if current_user.nivel_acceso < 4:
        raise HTTPException(status_code=403, detail="Requiere nivel 4+")

    scores = await pagerank(top_n=500, current_user=current_user, db=db)

    from sqlalchemy import text
    updated = 0

    for item in scores:
        if not item.get("id"):
            continue
        tabla = "personas" if item["tipo"] == "persona" else "instituciones"
        # Normalizar pagerank score a 0-1
        max_score = max(s["pagerank_score"] for s in scores) or 1
        score_norm = min(1.0, item["pagerank_score"] / max_score)

        await db.execute(
            text(f"""
                UPDATE core.{tabla}
                SET score_influencia = :score, score_at = NOW()
                WHERE id = :eid
            """),
            {"score": round(score_norm, 4), "eid": item["id"]},
        )
        updated += 1

    log.info("Scores de influencia sincronizados", actualizados=updated)
    return {"actualizados": updated, "metodo": scores[0].get("metodo", "unknown") if scores else "none"}
