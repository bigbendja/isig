// ============================================================
// SIGINT DataCenter Pro — Neo4j Inicialización
// Constraints, índices y estructura del grafo de vínculos
// ============================================================
// Ejecutar en Neo4j Browser: http://localhost:7474
// O via: docker exec sigint_neo4j cypher-shell -u neo4j -p PASSWORD < neo4j_init.cypher
// ============================================================

// ── CONSTRAINTS (unicidad + índice implícito) ─────────────
CREATE CONSTRAINT persona_id IF NOT EXISTS
    FOR (p:Persona) REQUIRE p.pg_id IS UNIQUE;

CREATE CONSTRAINT institucion_id IF NOT EXISTS
    FOR (i:Institucion) REQUIRE i.pg_id IS UNIQUE;

// ── ÍNDICES ADICIONALES ────────────────────────────────────
CREATE INDEX persona_nombre IF NOT EXISTS
    FOR (p:Persona) ON (p.nombre_completo);

CREATE INDEX persona_score IF NOT EXISTS
    FOR (p:Persona) ON (p.score_riesgo);

CREATE INDEX institucion_nombre IF NOT EXISTS
    FOR (i:Institucion) ON (i.nombre);

CREATE INDEX institucion_sector IF NOT EXISTS
    FOR (i:Institucion) ON (i.sector);

// ── ESTRUCTURA DE NODOS ────────────────────────────────────
// Nodo Persona: propiedades sincronizadas desde PostgreSQL
// Ejemplo de nodo:
// (:Persona {
//   pg_id: "uuid",
//   nombre_completo: "Juan Pérez",
//   score_riesgo: 0.75,
//   nivel_prioridad: 3,
//   ciudad: "Malabo",
//   pais: "GQ",
//   activo: true,
//   sync_at: datetime()
// })

// Nodo Institución:
// (:Institucion {
//   pg_id: "uuid",
//   nombre: "GEPETROL S.A.",
//   sector: "Energía",
//   score_riesgo: 0.30,
//   pais: "GQ",
//   activo: true,
//   sync_at: datetime()
// })

// ── TIPOS DE RELACIONES ────────────────────────────────────
// Todos los vínculos tienen propiedades base:
// {
//   pg_id: "uuid del vínculo en PostgreSQL",
//   intensidad: 0.8,        // 0.0 a 1.0
//   vigente: true,
//   fecha_inicio: date(),
//   confianza: 4,           // 1 a 5
//   fuente: "Manual"
// }

// Relaciones disponibles (espejadas desde tipos_vinculo de PostgreSQL):
// -[:CONYUGUE]->
// -[:SOCIO]->
// -[:EMPLEADO_DE]->
// -[:ACCIONISTA_DE]->
// -[:CONSEJERO_DE]->
// -[:CLIENTE_DE]->
// -[:CONOCIDO]->
// -[:ALIADO_POLITICO]->
// -[:FAMILIAR_DE]->
// -[:REPRESENTANTE_DE]->
// Y cualquier tipo personalizado: -[:VINCULO {tipo: "custom_type"}]->

// ── QUERIES ÚTILES DE EJEMPLO ─────────────────────────────
// Todos los contactos de 2º grado de una persona:
// MATCH (p:Persona {pg_id: "uuid"})-[:SOCIO|CONOCIDO*1..2]->(q)
// WHERE p <> q
// RETURN DISTINCT q.nombre_completo, q.score_riesgo
// ORDER BY q.score_riesgo DESC

// Camino más corto entre dos personas:
// MATCH path = shortestPath(
//   (a:Persona {pg_id: "uuid1"})-[*..6]-(b:Persona {pg_id: "uuid2"})
// )
// RETURN path

// Detectar comunidades con GDS:
// CALL gds.louvain.stream({
//   nodeProjection: ['Persona', 'Institucion'],
//   relationshipProjection: {
//     VINCULO: {type: '*', orientation: 'UNDIRECTED', properties: ['intensidad']}
//   },
//   relationshipWeightProperty: 'intensidad'
// })
// YIELD nodeId, communityId
// RETURN gds.util.asNode(nodeId).nombre_completo AS nombre, communityId
// ORDER BY communityId

// PageRank de influencia:
// CALL gds.pageRank.stream({
//   nodeProjection: ['Persona', 'Institucion'],
//   relationshipProjection: '*'
// })
// YIELD nodeId, score
// RETURN gds.util.asNode(nodeId).nombre_completo AS nombre, score
// ORDER BY score DESC LIMIT 20
