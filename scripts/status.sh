#!/bin/bash
# status.sh — Estado de todos los servicios
set -a; [ -f .env ] && source .env; set +a

BOLD='\033[1m'; GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'

echo ""
echo -e "${BOLD}Estado de servicios SIGINT DataCenter Pro${NC}"
echo "─────────────────────────────────────────────"

check_service() {
    local name=$1; local container=$2; local check_cmd=$3
    if docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
        if eval "$check_cmd" &>/dev/null 2>&1; then
            echo -e "  ${name}: ${GREEN}Corriendo y saludable${NC}"
        else
            echo -e "  ${name}: ${YELLOW}Corriendo pero no responde${NC}"
        fi
    else
        echo -e "  ${name}: ${RED}Detenido${NC}"
    fi
}

check_service "PostgreSQL" "sigint_postgres" \
    "docker exec sigint_postgres pg_isready -U ${POSTGRES_USER:-sigint_admin} -q"

check_service "Neo4j    " "sigint_neo4j" \
    "curl -sf http://localhost:${NEO4J_HTTP_PORT:-7474}/"

check_service "Redis    " "sigint_redis" \
    "docker exec sigint_redis redis-cli -a ${REDIS_PASSWORD} ping"

check_service "Ollama   " "sigint_ollama" \
    "curl -sf http://localhost:${OLLAMA_PORT:-11434}/api/tags"

echo "─────────────────────────────────────────────"

# Modelos Ollama disponibles
if docker ps --format '{{.Names}}' | grep -q "^sigint_ollama$"; then
    echo ""
    echo -e "${BOLD}Modelos LLM disponibles:${NC}"
    docker exec sigint_ollama ollama list 2>/dev/null | tail -n +2 | \
        awk '{printf "  %-30s %s %s\n", $1, $3, $4}' || echo "  (ninguno descargado aún)"
fi

echo ""
# Uso de disco de volúmenes
echo -e "${BOLD}Uso de almacenamiento:${NC}"
docker system df --format "table {{.Type}}\t{{.Size}}\t{{.Reclaimable}}" 2>/dev/null || true

echo ""
