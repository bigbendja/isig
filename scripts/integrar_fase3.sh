#!/bin/bash
# integrar_fase3.sh — Integra el dashboard React en el sistema
set -e
BOLD='\033[1m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
set -a; source .env; set +a

echo ""
echo -e "${BOLD}Integrando Fase 3 — Dashboard React${NC}"
echo ""

# 1. Verificar que backend está corriendo
echo -e "${YELLOW}[1/4] Verificando backend Fase 2...${NC}"
if ! curl -sf http://localhost:${BACKEND_PORT:-8000}/health &>/dev/null; then
    echo -e "${RED}ERROR: El backend no está corriendo. Ejecuta ./scripts/integrar_fase2.sh primero.${NC}"
    exit 1
fi
echo -e "  Backend activo ${GREEN}OK${NC}"

# 2. Añadir frontend al docker-compose
echo -e "${YELLOW}[2/4] Actualizando docker-compose.yml...${NC}"
if ! grep -q "sigint_frontend" docker-compose.yml; then
    python3 - <<'PYEOF'
with open('docker-compose.yml', 'r') as f:
    content = f.read()

frontend_service = """
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    container_name: sigint_frontend
    restart: unless-stopped
    ports:
      - "${FRONTEND_PORT:-3000}:3000"
    networks:
      - sigint_net
    depends_on:
      - backend

"""
content = content.replace('\nvolumes:', frontend_service + '\nvolumes:', 1)
with open('docker-compose.yml', 'w') as f:
    f.write(content)
print("  docker-compose.yml actualizado")
PYEOF
fi
echo -e "  Frontend añadido ${GREEN}OK${NC}"

# 3. Añadir variable al .env
if ! grep -q "FRONTEND_PORT" .env; then
    echo "FRONTEND_PORT=3000" >> .env
fi

# 4. Build y arranque
echo -e "${YELLOW}[3/4] Construyendo imagen del frontend (puede tardar 2-3 min)...${NC}"
docker compose build frontend
echo -e "  Imagen construida ${GREEN}OK${NC}"

echo -e "${YELLOW}[4/4] Arrancando frontend...${NC}"
docker compose up -d frontend

# Esperar
COUNT=0
echo -n "  Esperando al frontend..."
until curl -sf http://localhost:${FRONTEND_PORT:-3000} &>/dev/null; do
    COUNT=$((COUNT+1))
    if [ $COUNT -ge 60 ]; then
        echo -e "\n${RED}Timeout esperando al frontend. Revisa: docker compose logs frontend${NC}"
        exit 1
    fi
    printf "."
    sleep 1
done
echo -e " ${GREEN}listo${NC}"

echo ""
echo -e "${GREEN}${BOLD}============================================${NC}"
echo -e "${GREEN}${BOLD}  Fase 3 — Dashboard activo${NC}"
echo -e "${GREEN}${BOLD}============================================${NC}"
echo ""
echo -e "  ${BOLD}Dashboard:${NC}  http://localhost:${FRONTEND_PORT:-3000}"
echo -e "  ${BOLD}API docs:${NC}   http://localhost:${BACKEND_PORT:-8000}/docs"
echo ""
echo -e "  Inicia sesión con el usuario admin que creaste."
echo -e "  Si no lo has creado: ${BOLD}./scripts/crear_admin.sh${NC}"
echo ""
