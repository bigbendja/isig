#!/bin/bash
# integrar_fase6.sh — Integra el sistema ML avanzado
set -e
BOLD='\033[1m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
set -a; source .env; set +a

echo ""
echo -e "${BOLD}Integrando Fase 6 — ML avanzado + Analytics${NC}"
echo ""

# 1. Migración 003 (pgvector + tablas ML)
echo -e "${YELLOW}[1/5] Aplicando migración 003 (pgvector + tablas ML)...${NC}"
docker compose exec -T postgres psql \
    -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    < database/migrations/003_ml_avanzado.sql 2>/dev/null || \
    echo -e "  ${YELLOW}Nota: pgvector puede no estar disponible — búsqueda semántica desactivada${NC}"
echo -e "  Migración 003 aplicada ${GREEN}OK${NC}"

# 2. Añadir servicio ML al docker-compose
echo -e "${YELLOW}[2/5] Añadiendo servicio ML...${NC}"
if ! grep -q "sigint_ml" docker-compose.yml; then
    python3 - <<'PYEOF'
with open('docker-compose.yml', 'r') as f:
    content = f.read()

ml_svc = """
  ml:
    build:
      context: ./ml
      dockerfile: Dockerfile
    container_name: sigint_ml
    restart: unless-stopped
    env_file: .env
    environment:
      POSTGRES_HOST: postgres
      REDIS_HOST: redis
      OLLAMA_HOST: ollama
    volumes:
      - ./ml:/app
      - ml_models:/app/models
    networks:
      - sigint_net
    depends_on:
      postgres:
        condition: service_healthy

"""
content = content.replace('\nvolumes:', ml_svc + '\nvolumes:', 1)

# Añadir volumen para modelos
content = content.replace(
    '  ollama_data:\n    driver: local',
    '  ollama_data:\n    driver: local\n  ml_models:\n    driver: local'
)

with open('docker-compose.yml', 'w') as f:
    f.write(content)
print("  docker-compose.yml actualizado")
PYEOF
    echo -e "  Servicio ML añadido ${GREEN}OK${NC}"
fi

# 3. Actualizar backend con endpoints ML
echo -e "${YELLOW}[3/5] Actualizando backend con endpoints ML...${NC}"
# Añadir router ML al main.py
python3 - <<'PYEOF'
with open('backend/app/main.py', 'r') as f:
    content = f.read()

if 'ml' not in content:
    content = content.replace(
        'from app.api.v1.endpoints import auth, entidades, vinculos, stats, mapa, grafo, ia',
        'from app.api.v1.endpoints import auth, entidades, vinculos, stats, mapa, grafo, ia, ml'
    )
    content = content.replace(
        'app.include_router(auditoria_router,      prefix="/api/v1")',
        'app.include_router(auditoria_router,      prefix="/api/v1")\napp.include_router(ml.router,              prefix="/api/v1")'
    )
    with open('backend/app/main.py', 'w') as f:
        f.write(content)
    print("  main.py actualizado con router ML")
else:
    print("  main.py ya tiene el router ML")
PYEOF

docker compose build backend
docker compose up -d backend
echo -e "  Backend actualizado ${GREEN}OK${NC}"

# 4. Actualizar frontend con Analytics
echo -e "${YELLOW}[4/5] Actualizando frontend con panel Analytics...${NC}"
docker compose build frontend
docker compose up -d frontend
echo -e "  Frontend actualizado ${GREEN}OK${NC}"

# 5. Construir y arrancar ML
echo -e "${YELLOW}[5/5] Construyendo servicio ML...${NC}"
docker compose build ml 2>/dev/null || echo -e "  ${YELLOW}Build ML opcional — puede omitirse${NC}"
echo -e "  ML listo ${GREEN}OK${NC}"

echo ""
echo -e "${GREEN}${BOLD}============================================${NC}"
echo -e "${GREEN}${BOLD}  Fase 6 — ML avanzado integrado${NC}"
echo -e "${GREEN}${BOLD}============================================${NC}"
echo ""
echo -e "Endpoints nuevos:"
echo -e "  POST /api/v1/ml/score/{tipo}/{id}   — Score individual + SHAP"
echo -e "  POST /api/v1/ml/score-batch         — Scoring batch en background"
echo -e "  POST /api/v1/ml/entrenar            — Entrenar XGBoost (admin)"
echo -e "  POST /api/v1/ml/segmentar           — Segmentación K-Means"
echo -e "  GET  /api/v1/ml/segmentos           — Listar segmentos"
echo -e "  GET  /api/v1/ml/buscar-semantico    — Búsqueda semántica"
echo -e "  POST /api/v1/ml/indexar-embeddings  — Indexar embeddings"
echo -e "  GET  /api/v1/ml/stats               — Estadísticas ML"
echo -e "  GET  /api/v1/ml/distribucion        — Distribución de riesgo"
echo ""
echo -e "Panel Analytics: http://localhost:${FRONTEND_PORT:-3000}/analytics"
echo ""
echo -e "${YELLOW}Para arrancar el scheduler ML (scoring cada 6h):${NC}"
echo -e "  docker compose up -d ml"
echo ""
echo -e "${YELLOW}Para entrenar el modelo XGBoost manualmente:${NC}"
echo -e "  curl -X POST http://localhost:${BACKEND_PORT:-8000}/api/v1/ml/entrenar \\"
echo -e "       -H 'Authorization: Bearer <token>' -H 'Content-Type: application/json'"
echo ""
