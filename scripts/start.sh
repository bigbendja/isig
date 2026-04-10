#!/bin/bash
# ============================================================
# SIGINT DataCenter Pro — Arranque del sistema
# ============================================================
set -e

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

# Cargar .env para leer configuración
set -a; source .env; set +a

echo ""
echo -e "${BOLD}Arrancando SIGINT DataCenter Pro...${NC}"
echo ""

# ── 1. LEVANTAR INFRAESTRUCTURA ───────────────────────────────
echo -e "${YELLOW}[1/4] Levantando servicios de infraestructura...${NC}"
docker compose up -d postgres neo4j redis ollama

# ── 2. ESPERAR A QUE POSTGRESQL ESTÉ LISTO ────────────────────
echo -e "${YELLOW}[2/4] Esperando a PostgreSQL...${NC}"
MAX_WAIT=60
COUNT=0
until docker compose exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" &>/dev/null; do
    COUNT=$((COUNT+1))
    if [ $COUNT -ge $MAX_WAIT ]; then
        echo -e "${RED}ERROR: PostgreSQL no arrancó en $MAX_WAIT segundos.${NC}"
        echo "Revisa los logs con: docker compose logs postgres"
        exit 1
    fi
    printf "."
    sleep 1
done
echo -e " ${GREEN}listo${NC}"

# ── 3. EJECUTAR MIGRACIONES ───────────────────────────────────
echo -e "${YELLOW}[3/4] Ejecutando migraciones de base de datos...${NC}"

# Verificar si ya se ejecutó la migración inicial
SCHEMA_EXISTS=$(docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
    "SELECT EXISTS(SELECT 1 FROM information_schema.schemata WHERE schema_name='core')")

if [ "$SCHEMA_EXISTS" = "f" ]; then
    echo -e "  Ejecutando migración inicial..."
    for SQL_FILE in database/migrations/*.sql; do
        echo -e "  Aplicando: $(basename $SQL_FILE)..."
        docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
            -f "/docker-entrypoint-initdb.d/$(basename $SQL_FILE)" 2>&1 | \
            grep -v "^$" | grep -v "^NOTICE" | head -5 || true
    done
    echo -e "  Migraciones completadas ${GREEN}OK${NC}"
else
    echo -e "  Esquema ya existe, omitiendo migraciones ${GREEN}OK${NC}"
fi

# ── 4. DESCARGAR MODELOS LLM (solo si no existen) ─────────────
echo -e "${YELLOW}[4/4] Verificando modelos LLM locales...${NC}"

# Esperar a que Ollama esté listo
sleep 5
OLLAMA_READY=false
for i in {1..30}; do
    if docker compose exec -T ollama ollama list &>/dev/null 2>&1; then
        OLLAMA_READY=true
        break
    fi
    sleep 2
done

if [ "$OLLAMA_READY" = "true" ]; then
    # Verificar y descargar modelos configurados
    for MODEL in "$OLLAMA_MODEL_DEFAULT" "$OLLAMA_MODEL_EMBEDDINGS"; do
        if [ -n "$MODEL" ]; then
            MODEL_EXISTS=$(docker compose exec -T ollama ollama list 2>/dev/null | grep -c "^$MODEL" || echo "0")
            if [ "$MODEL_EXISTS" = "0" ]; then
                echo -e "  Descargando modelo: ${BOLD}$MODEL${NC}"
                echo -e "  ${YELLOW}(Esto puede tardar varios minutos según tu conexión)${NC}"
                docker compose exec -T ollama ollama pull "$MODEL"
                echo -e "  $MODEL ${GREEN}descargado${NC}"
            else
                echo -e "  $MODEL ya disponible ${GREEN}OK${NC}"
            fi
        fi
    done
else
    echo -e "  ${YELLOW}Ollama tardando en arrancar — los modelos se descargarán automáticamente${NC}"
fi

# ── RESUMEN ────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}============================================${NC}"
echo -e "${GREEN}${BOLD}  Sistema arrancado correctamente${NC}"
echo -e "${GREEN}${BOLD}============================================${NC}"
echo ""
echo -e "  ${CYAN}PostgreSQL:${NC}  localhost:${POSTGRES_PORT:-5432}"
echo -e "  ${CYAN}Neo4j UI:${NC}    http://localhost:${NEO4J_HTTP_PORT:-7474}"
echo -e "  ${CYAN}Ollama API:${NC}  http://localhost:${OLLAMA_PORT:-11434}"
echo ""
echo -e "  Herramientas de desarrollo (solo con --profile dev):"
echo -e "  ${CYAN}Adminer (BD):${NC}      http://localhost:${ADMINER_PORT:-8080}"
echo -e "  ${CYAN}Redis Commander:${NC}   http://localhost:${REDIS_UI_PORT:-8081}"
echo ""
echo -e "  Para arrancar herramientas dev:"
echo -e "  ${BOLD}docker compose --profile dev up -d adminer redis-commander${NC}"
echo ""
echo -e "  Para ver logs en tiempo real:"
echo -e "  ${BOLD}docker compose logs -f${NC}"
echo ""
echo -e "  Para parar el sistema:"
echo -e "  ${BOLD}./scripts/stop.sh${NC}"
echo ""
