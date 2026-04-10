#!/bin/bash
# ============================================================
# SIGINT DataCenter Pro — Script de integración Fase 2
# Integra el backend en la infraestructura existente de Fase 1
# ============================================================
set -e

BOLD='\033[1m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
set -a; source .env; set +a

echo ""
echo -e "${BOLD}Integrando Fase 2 — Backend FastAPI${NC}"
echo ""

# ── 1. VERIFICAR QUE FASE 1 ESTÁ CORRIENDO ───────────────────
echo -e "${YELLOW}[1/5] Verificando infraestructura Fase 1...${NC}"
if ! docker compose ps | grep -q "sigint_postgres.*running"; then
    echo -e "${RED}ERROR: PostgreSQL no está corriendo. Ejecuta ./scripts/start.sh primero.${NC}"
    exit 1
fi
echo -e "  Infraestructura Fase 1 activa ${GREEN}OK${NC}"

# ── 2. AÑADIR BACKEND AL DOCKER COMPOSE ──────────────────────
echo -e "${YELLOW}[2/5] Actualizando docker-compose.yml...${NC}"

if grep -q "sigint_backend" docker-compose.yml; then
    echo -e "  Backend ya está en docker-compose.yml ${GREEN}OK${NC}"
else
    # Insertar el servicio backend antes de "volumes:"
    python3 - <<'PYEOF'
with open('docker-compose.yml', 'r') as f:
    content = f.read()

backend_service = """
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: sigint_backend
    restart: unless-stopped
    env_file: .env
    environment:
      POSTGRES_HOST: postgres
      NEO4J_HOST: neo4j
      REDIS_HOST: redis
      OLLAMA_HOST: ollama
    volumes:
      - ./backend:/app
      - ./data/uploads:/app/data/uploads
      - ./logs:/app/logs
    ports:
      - "${BACKEND_PORT:-8000}:8000"
    networks:
      - sigint_net
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    command: >
      uvicorn app.main:app
        --host 0.0.0.0
        --port 8000
        --reload
        --reload-dir /app/app
        --loop uvloop

"""

# Insertar antes de la sección volumes:
content = content.replace('\nvolumes:', backend_service + '\nvolumes:', 1)

with open('docker-compose.yml', 'w') as f:
    f.write(content)

print("  docker-compose.yml actualizado")
PYEOF
    echo -e "  Backend añadido a docker-compose.yml ${GREEN}OK${NC}"
fi

# ── 3. AÑADIR VARIABLES AL .ENV ───────────────────────────────
echo -e "${YELLOW}[3/5] Actualizando .env...${NC}"
if ! grep -q "BACKEND_PORT" .env; then
    echo "" >> .env
    echo "# ── BACKEND (Fase 2) ──────────────────────────────────────────" >> .env
    echo "BACKEND_PORT=8000" >> .env
    echo -e "  Variables de Fase 2 añadidas a .env ${GREEN}OK${NC}"
else
    echo -e "  .env ya tiene las variables de Fase 2 ${GREEN}OK${NC}"
fi

# ── 4. CONSTRUIR IMAGEN DEL BACKEND ──────────────────────────
echo -e "${YELLOW}[4/5] Construyendo imagen del backend (puede tardar unos minutos)...${NC}"
docker compose build backend
echo -e "  Imagen construida ${GREEN}OK${NC}"

# ── 5. ARRANCAR BACKEND ───────────────────────────────────────
echo -e "${YELLOW}[5/5] Arrancando backend...${NC}"
docker compose up -d backend

# Esperar a que el backend esté listo
MAX_WAIT=60
COUNT=0
echo -n "  Esperando a que el backend responda..."
until curl -sf http://localhost:${BACKEND_PORT:-8000}/health &>/dev/null; do
    COUNT=$((COUNT+1))
    if [ $COUNT -ge $MAX_WAIT ]; then
        echo ""
        echo -e "${RED}ERROR: El backend no respondió en $MAX_WAIT segundos.${NC}"
        echo "Revisa los logs: docker compose logs backend"
        exit 1
    fi
    printf "."
    sleep 1
done
echo -e " ${GREEN}listo${NC}"

echo ""
echo -e "${GREEN}${BOLD}============================================${NC}"
echo -e "${GREEN}${BOLD}  Fase 2 integrada correctamente${NC}"
echo -e "${GREEN}${BOLD}============================================${NC}"
echo ""
echo -e "  ${BOLD}API REST:${NC}        http://localhost:${BACKEND_PORT:-8000}"
echo -e "  ${BOLD}Documentación:${NC}   http://localhost:${BACKEND_PORT:-8000}/docs"
echo -e "  ${BOLD}ReDoc:${NC}           http://localhost:${BACKEND_PORT:-8000}/redoc"
echo -e "  ${BOLD}Health check:${NC}    http://localhost:${BACKEND_PORT:-8000}/health"
echo ""
echo -e "  Para crear el primer usuario administrador:"
echo -e "  ${BOLD}./scripts/crear_admin.sh${NC}"
echo ""
