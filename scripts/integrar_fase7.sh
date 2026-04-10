#!/bin/bash
# integrar_fase7.sh — Hardening y producción
set -e
BOLD='\033[1m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
set -a; source .env; set +a

echo ""
echo -e "${BOLD}Integrando Fase 7 — Hardening y producción${NC}"
echo ""

# 1. Permisos de scripts
echo -e "${YELLOW}[1/5] Aplicando permisos...${NC}"
chmod +x scripts/*.sh
echo -e "  Scripts ejecutables ${GREEN}OK${NC}"

# 2. Actualizar backend con cifrado
echo -e "${YELLOW}[2/5] Actualizando backend con módulo de cifrado...${NC}"
docker compose build backend
docker compose up -d backend
echo -e "  Backend con cifrado ${GREEN}OK${NC}"

# 3. Crear directorios de monitoreo
echo -e "${YELLOW}[3/5] Preparando monitoreo...${NC}"
mkdir -p monitoring/{prometheus,grafana/{dashboards,datasources},loki}
mkdir -p nginx/conf.d
mkdir -p backups logs
echo -e "  Directorios creados ${GREEN}OK${NC}"

# 4. Verificar variables de entorno críticas
echo -e "${YELLOW}[4/5] Verificando configuración de seguridad...${NC}"
ERRORES=0
for var in SECRET_KEY JWT_SECRET POSTGRES_PASSWORD NEO4J_PASSWORD REDIS_PASSWORD; do
    val="${!var:-}"
    if [ -z "$val" ] || [ ${#val} -lt 16 ]; then
        echo -e "  ${YELLOW}WARN: $var muy corta o vacía (mín. 16 chars)${NC}"
        ERRORES=$((ERRORES+1))
    else
        echo -e "  $var: ${GREEN}OK${NC} (${#val} chars)"
    fi
done
[ $ERRORES -gt 0 ] && echo -e "  ${YELLOW}Corrige las variables antes de producción${NC}"

# 5. Configurar cron de backup
echo -e "${YELLOW}[5/5] Configurando cron de backup...${NC}"
CRON="0 2 * * * cd $(pwd) && ./scripts/backup.sh >> ./backups/backup.log 2>&1"
(crontab -l 2>/dev/null | grep -v "backup.sh"; echo "$CRON") | crontab - 2>/dev/null || \
    echo -e "  ${YELLOW}WARN: crontab requiere permisos de sistema${NC}"
echo -e "  Cron configurado ${GREEN}OK${NC}"

echo ""
echo -e "${GREEN}${BOLD}============================================${NC}"
echo -e "${GREEN}${BOLD}  Fase 7 — Hardening aplicado${NC}"
echo -e "${GREEN}${BOLD}============================================${NC}"
echo ""
echo -e "Para despliegue en servidor de producción:"
echo -e "  ${BOLD}./scripts/deploy_servidor.sh tu-dominio.com admin@tu-dominio.com${NC}"
echo ""
echo -e "Para levantar monitoreo en desarrollo:"
echo -e "  ${BOLD}docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d prometheus grafana loki${NC}"
echo ""
echo -e "Checklist de seguridad:"
echo -e "  ${BOLD}docs/SECURITY_CHECKLIST.md${NC}"
echo ""
