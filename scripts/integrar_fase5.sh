#!/bin/bash
# integrar_fase5.sh — Integra el pipeline OSINT completo
set -e
BOLD='\033[1m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
set -a; source .env; set +a

echo ""
echo -e "${BOLD}Integrando Fase 5 — Pipeline OSINT${NC}"
echo ""

# 1. Ejecutar migración 002
echo -e "${YELLOW}[1/4] Aplicando migración 002 (tablas pipeline)...${NC}"
docker compose exec -T postgres psql \
    -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -f /docker-entrypoint-initdb.d/002_pipeline_osint.sql 2>/dev/null || \
docker compose exec -T postgres psql \
    -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    < database/migrations/002_pipeline_osint.sql
echo -e "  Migración aplicada ${GREEN}OK${NC}"

# 2. Añadir pipeline al docker-compose
echo -e "${YELLOW}[2/4] Añadiendo servicio pipeline...${NC}"
if ! grep -q "sigint_pipeline" docker-compose.yml; then
    python3 - <<'PYEOF'
with open('docker-compose.yml', 'r') as f:
    content = f.read()

pipeline_svc = """
  pipeline:
    build:
      context: ./pipeline
      dockerfile: Dockerfile
    container_name: sigint_pipeline
    restart: unless-stopped
    env_file: .env
    environment:
      POSTGRES_HOST: postgres
      REDIS_HOST: redis
      OLLAMA_HOST: ollama
    volumes:
      - ./pipeline:/app
      - ./data/uploads:/app/data/uploads
      - ./logs:/app/logs
    networks:
      - sigint_net
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    command: ["python", "runner.py", "--modo", "daemon"]

"""
content = content.replace('\nvolumes:', pipeline_svc + '\nvolumes:', 1)
with open('docker-compose.yml', 'w') as f:
    f.write(content)
print("  docker-compose.yml actualizado")
PYEOF
    echo -e "  Pipeline añadido ${GREEN}OK${NC}"
else
    echo -e "  Pipeline ya configurado ${GREEN}OK${NC}"
fi

# 3. Actualizar backend con endpoint OSINT
echo -e "${YELLOW}[3/4] Actualizando backend con endpoints OSINT...${NC}"
docker compose build backend
docker compose up -d backend
echo -e "  Backend actualizado ${GREEN}OK${NC}"

# 4. Actualizar frontend con página OSINT
echo -e "${YELLOW}[4/4] Actualizando frontend con panel OSINT...${NC}"
docker compose build frontend
docker compose up -d frontend
echo -e "  Frontend actualizado ${GREEN}OK${NC}"

echo ""
echo -e "${GREEN}${BOLD}============================================${NC}"
echo -e "${GREEN}${BOLD}  Fase 5 — Pipeline OSINT integrado${NC}"
echo -e "${GREEN}${BOLD}============================================${NC}"
echo ""
echo -e "Endpoints nuevos:"
echo -e "  GET  /api/v1/osint/fuentes              — Listar fuentes"
echo -e "  POST /api/v1/osint/fuentes              — Crear fuente"
echo -e "  POST /api/v1/osint/fuentes/{id}/ejecutar — Ejecutar manualmente"
echo -e "  GET  /api/v1/osint/ejecuciones          — Historial"
echo -e "  GET  /api/v1/osint/datos-pendientes     — Cola de revisión"
echo -e "  POST /api/v1/osint/importar-csv         — Importación masiva"
echo -e "  GET  /api/v1/osint/stats                — Estadísticas pipeline"
echo ""
echo -e "Panel OSINT en el dashboard: http://localhost:${FRONTEND_PORT:-3000}/osint"
echo ""
echo -e "${YELLOW}Para arrancar el pipeline manualmente:${NC}"
echo -e "  docker compose up -d pipeline"
echo ""
echo -e "${YELLOW}Para ejecutar una fuente específica:${NC}"
echo -e "  docker compose exec pipeline python runner.py --fuente <ID>"
echo ""
