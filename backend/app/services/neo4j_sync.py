# app/services/neo4j_sync.py
# ============================================================
# Sincronización PostgreSQL → Neo4j
# Mantiene el grafo actualizado cuando cambian entidades
# ============================================================
from uuid import UUID
import structlog
from app.core.database import get_neo4j_driver

log = structlog.get_logger()


async def sync_entidad_neo4j(tipo: str, entidad_id: UUID, nombre: str, extra: dict = None):
    """
    Crea o actualiza un nodo en Neo4j.
    tipo: 'persona' | 'institucion'
    """
    driver = await get_neo4j_driver()
    label = "Persona" if tipo == "persona" else "Institucion"

    props = {"pg_id": str(entidad_id), "nombre_completo" if tipo == "persona" else "nombre": nombre}
    if extra:
        props.update(extra)

    async with driver.session() as session:
        await session.run(
            f"""
            MERGE (n:{label} {{pg_id: $pg_id}})
            SET n += $props, n.sync_at = datetime()
            """,
            pg_id=str(entidad_id),
            props=props,
        )
    log.debug("Neo4j nodo sincronizado", tipo=tipo, id=entidad_id)


async def sync_vinculo_neo4j(vinculo_id: UUID, body):
    """Crea o actualiza una relación en Neo4j."""
    driver = await get_neo4j_driver()

    origen_label  = "Persona" if body.origen_tipo  == "persona" else "Institucion"
    destino_label = "Persona" if body.destino_tipo == "persona" else "Institucion"

    # Determinar tipo de relación para Neo4j
    rel_type = "VINCULO"
    if body.tipo_vinculo_id:
        # Mapeo simplificado — en producción consultar tipos_vinculo
        rel_type = "VINCULO"

    async with driver.session() as session:
        await session.run(
            f"""
            MATCH (origen:{origen_label} {{pg_id: $origen_id}})
            MATCH (destino:{destino_label} {{pg_id: $destino_id}})
            MERGE (origen)-[r:{rel_type} {{pg_id: $vinculo_id}}]->(destino)
            SET r.intensidad = $intensidad,
                r.vigente = true,
                r.confianza = $confianza,
                r.sync_at = datetime()
            """,
            origen_id=str(body.origen_id),
            destino_id=str(body.destino_id),
            vinculo_id=str(vinculo_id),
            intensidad=float(body.intensidad),
            confianza=body.confianza,
        )

    if body.bidireccional:
        async with driver.session() as session:
            await session.run(
                f"""
                MATCH (destino:{destino_label} {{pg_id: $destino_id}})
                MATCH (origen:{origen_label} {{pg_id: $origen_id}})
                MERGE (destino)-[r:{rel_type} {{pg_id: $vinculo_id_rev}}]->(origen)
                SET r.intensidad = $intensidad, r.vigente = true, r.sync_at = datetime()
                """,
                origen_id=str(body.origen_id),
                destino_id=str(body.destino_id),
                vinculo_id_rev=str(vinculo_id) + "_rev",
                intensidad=float(body.intensidad),
            )

    log.debug("Neo4j vínculo sincronizado", id=vinculo_id)
