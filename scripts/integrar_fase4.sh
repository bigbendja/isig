#!/bin/bash
# integrar_fase4.sh — Integra endpoints del backend y frontend actualizado
set -e
BOLD='\033[1m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
set -a; source .env; set +a

echo ""
echo -e "${BOLD}Integrando Fase 4 — Grafo Neo4j + Mapa + Endpoints completos${NC}"
echo ""

echo -e "${YELLOW}[1/3] Reconstruyendo backend con nuevos endpoints...${NC}"
docker compose build backend
docker compose up -d backend
echo -e "  Backend actualizado ${GREEN}OK${NC}"

echo -e "${YELLOW}[2/3] Reconstruyendo frontend con grafo v2...${NC}"
docker compose build frontend
docker compose up -d frontend
echo -e "  Frontend actualizado ${GREEN}OK${NC}"

echo -e "${YELLOW}[3/3] Inicializando constraints en Neo4j...${NC}"
NEO4J_PASS=$(grep NEO4J_PASSWORD .env | cut -d= -f2)
docker compose exec -T neo4j cypher-shell \
    -u neo4j -p "$NEO4J_PASS" \
    "CREATE CONSTRAINT persona_id IF NOT EXISTS FOR (p:Persona) REQUIRE p.pg_id IS UNIQUE;" 2>/dev/null || true
docker compose exec -T neo4j cypher-shell \
    -u neo4j -p "$NEO4J_PASS" \
    "CREATE CONSTRAINT inst_id IF NOT EXISTS FOR (i:Institucion) REQUIRE i.pg_id IS UNIQUE;" 2>/dev/null || true
echo -e "  Neo4j inicializado ${GREEN}OK${NC}"

echo ""
echo -e "${GREEN}${BOLD}Fase 4 integrada${NC}"
echo ""
echo -e "Endpoints nuevos disponibles:"
echo -e "  GET  /api/v1/grafo/global          — Grafo completo"
echo -e "  GET  /api/v1/grafo/vecindad/{tipo}/{id} — Vecindad de entidad"
echo -e "  GET  /api/v1/grafo/camino-corto    — Camino más corto"
echo -e "  GET  /api/v1/grafo/pagerank        — Ranking de influencia"
echo -e "  GET  /api/v1/grafo/comunidades     — Detección comunidades"
echo -e "  GET  /api/v1/mapa/entidades        — Marcadores del mapa"
echo -e "  GET  /api/v1/mapa/heatmap          — Datos heatmap"
echo -e "  GET  /api/v1/mapa/geocodificar     — Geocodificar dirección"
echo -e "  GET  /api/v1/stats/overview        — Estadísticas globales"
echo -e "  POST /api/v1/ia/chat               — Chat con el asistente"
echo -e "  POST /api/v1/ia/analizar-expediente — Análisis IA"
echo -e "  POST /api/v1/ia/extraer-entidades  — NER de documento"
echo ""
echo -e "  Documentación completa: http://localhost:${BACKEND_PORT:-8000}/docs"
echo ""
