#!/bin/bash
# ============================================================
# SIGINT DataCenter Pro — Script de instalación (Modo local)
# Compatible con: macOS, Ubuntu/Debian, Windows (WSL2)
# ============================================================
set -e

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo ""
echo -e "${BOLD}============================================${NC}"
echo -e "${BOLD}  SIGINT DataCenter Pro — Instalación${NC}"
echo -e "${BOLD}============================================${NC}"
echo ""

# ── 1. VERIFICAR DOCKER ───────────────────────────────────────
echo -e "${YELLOW}[1/6] Verificando Docker...${NC}"
if ! command -v docker &> /dev/null; then
    echo -e "${RED}ERROR: Docker no está instalado.${NC}"
    echo "Instálalo desde: https://docs.docker.com/get-docker/"
    exit 1
fi
if ! docker info &> /dev/null; then
    echo -e "${RED}ERROR: Docker no está corriendo. Inícialo e inténtalo de nuevo.${NC}"
    exit 1
fi
DOCKER_VERSION=$(docker --version | grep -oP '\d+\.\d+' | head -1)
echo -e "  Docker $DOCKER_VERSION detectado ${GREEN}OK${NC}"

# ── 2. VERIFICAR DOCKER COMPOSE ───────────────────────────────
echo -e "${YELLOW}[2/6] Verificando Docker Compose...${NC}"
if ! docker compose version &> /dev/null; then
    echo -e "${RED}ERROR: Docker Compose v2 no está disponible.${NC}"
    echo "Actualiza Docker Desktop o instala el plugin: https://docs.docker.com/compose/install/"
    exit 1
fi
echo -e "  Docker Compose v2 detectado ${GREEN}OK${NC}"

# ── 3. CREAR ARCHIVO .ENV ─────────────────────────────────────
echo -e "${YELLOW}[3/6] Configurando entorno...${NC}"
if [ ! -f .env ]; then
    cp .env.example .env

    # Generar secrets aleatorios automáticamente
    SECRET_KEY=$(openssl rand -hex 32 2>/dev/null || python3 -c "import secrets; print(secrets.token_hex(32))")
    JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || python3 -c "import secrets; print(secrets.token_hex(32))")
    DB_PASS=$(openssl rand -base64 16 | tr -d "=+/" | cut -c1-20)
    NEO4J_PASS=$(openssl rand -base64 16 | tr -d "=+/" | cut -c1-20)
    REDIS_PASS=$(openssl rand -base64 16 | tr -d "=+/" | cut -c1-20)

    # Sustituir placeholders en .env
    sed -i.bak "s/<<CAMBIAR_openssl_rand_hex_32>>\/\*SECRET_KEY\*\//$SECRET_KEY/" .env 2>/dev/null || \
        python3 -c "
import re
with open('.env','r') as f: content=f.read()
content=content.replace('<<CAMBIAR_openssl_rand_hex_32>>', '$SECRET_KEY', 1)
content=content.replace('<<CAMBIAR_openssl_rand_hex_32>>', '$JWT_SECRET', 1)
with open('.env','w') as f: f.write(content)
"
    # Sustitución más robusta con python
    python3 - <<PYEOF
import re

with open('.env', 'r') as f:
    content = f.read()

replacements = [
    ('<<CAMBIAR_openssl_rand_hex_32>>', '$SECRET_KEY', 1),
    ('<<CAMBIAR_openssl_rand_hex_32>>', '$JWT_SECRET', 1),
]

for old, new, count in replacements:
    content = content.replace(old, new, count)

content = content.replace('POSTGRES_PASSWORD=<<CAMBIAR_password_seguro>>', 'POSTGRES_PASSWORD=$DB_PASS')
content = content.replace('NEO4J_PASSWORD=<<CAMBIAR_password_seguro>>', 'NEO4J_PASSWORD=$NEO4J_PASS')
content = content.replace('REDIS_PASSWORD=<<CAMBIAR_password_seguro>>', 'REDIS_PASSWORD=$REDIS_PASS')

with open('.env', 'w') as f:
    f.write(content)

print('Secrets generados y guardados en .env')
PYEOF

    echo -e "  Archivo .env creado con secrets generados automáticamente ${GREEN}OK${NC}"
    echo ""
    echo -e "  ${YELLOW}IMPORTANTE: Guarda estas credenciales en un lugar seguro:${NC}"
    echo -e "  PostgreSQL password: ${BOLD}$DB_PASS${NC}"
    echo -e "  Neo4j password:      ${BOLD}$NEO4J_PASS${NC}"
    echo -e "  Redis password:      ${BOLD}$REDIS_PASS${NC}"
    echo ""
else
    echo -e "  Archivo .env ya existe, usando configuración existente ${GREEN}OK${NC}"
fi

# ── 4. CREAR DIRECTORIOS DE DATOS ─────────────────────────────
echo -e "${YELLOW}[4/6] Creando estructura de directorios...${NC}"
mkdir -p data/uploads data/exports logs
echo -e "  Directorios creados ${GREEN}OK${NC}"

# ── 5. DESCARGAR IMÁGENES DOCKER ──────────────────────────────
echo -e "${YELLOW}[5/6] Descargando imágenes Docker (puede tardar unos minutos)...${NC}"
docker compose pull --quiet
echo -e "  Imágenes descargadas ${GREEN}OK${NC}"

# ── 6. VERIFICAR MODELOS OLLAMA ───────────────────────────────
echo -e "${YELLOW}[6/6] Preparando modelos LLM locales...${NC}"
echo -e "  ${YELLOW}Nota: Los modelos se descargan al primer arranque.${NC}"
echo -e "  Modelos configurados: qwen2.5:7b (4.7GB), nomic-embed-text (274MB)"
echo -e "  Se descargarán automáticamente al ejecutar ./start.sh"

echo ""
echo -e "${GREEN}${BOLD}============================================${NC}"
echo -e "${GREEN}${BOLD}  Instalación completada.${NC}"
echo -e "${GREEN}${BOLD}============================================${NC}"
echo ""
echo -e "Próximo paso: ${BOLD}./scripts/start.sh${NC}"
echo ""
