#!/bin/bash
# scripts/deploy_servidor.sh
# ============================================================
# Despliegue completo en servidor Ubuntu 22.04 desde cero
# Ejecutar como root o con sudo
# ============================================================
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
BOLD='\033[1m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

step() { echo -e "\n${BOLD}[$(date +%H:%M:%S)] $*${NC}"; }
ok()   { echo -e "  ${GREEN}✓${NC} $*"; }
warn() { echo -e "  ${YELLOW}!${NC} $*"; }
err()  { echo -e "  ${RED}✗${NC} $*"; exit 1; }

echo -e "${BOLD}"
echo "╔══════════════════════════════════════════════╗"
echo "║   SIGINT DataCenter Pro — Deploy Servidor    ║"
echo "╚══════════════════════════════════════════════╝"
echo -e "${NC}"

[ -z "$DOMAIN" ] && err "Uso: $0 <dominio> <email>"
[ -z "$EMAIL"  ] && err "Uso: $0 <dominio> <email>"

# Verificar que .env existe
[ -f ".env" ] || err "Falta .env — cópialo desde .env.example y rellénalo"

# ── 1. DEPENDENCIAS DEL SISTEMA ───────────────────────────────
step "Instalando dependencias del sistema..."

apt-get update -qq
apt-get install -y -qq \
    curl wget git unzip \
    ca-certificates gnupg lsb-release \
    ufw fail2ban \
    htop iotop nethogs \
    logrotate cron

ok "Dependencias instaladas"

# ── 2. DOCKER ─────────────────────────────────────────────────
step "Instalando Docker..."

if ! command -v docker &>/dev/null; then
    curl -fsSL https://get.docker.com | sh
    usermod -aG docker "${SUDO_USER:-$(whoami)}" 2>/dev/null || true
    ok "Docker instalado"
else
    ok "Docker ya instalado: $(docker --version)"
fi

if ! command -v docker-compose &>/dev/null && ! docker compose version &>/dev/null 2>&1; then
    apt-get install -y docker-compose-plugin
fi
ok "Docker Compose: $(docker compose version --short 2>/dev/null || echo 'instalado')"

# ── 3. FIREWALL ───────────────────────────────────────────────
step "Configurando firewall UFW..."

ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp      # HTTP (para redirect y certbot)
ufw allow 443/tcp     # HTTPS
ufw allow 8080/tcp    # Monitoreo interno (limitar a IP de admin si es posible)
ufw --force enable

ok "Firewall configurado"

# ── 4. FAIL2BAN ───────────────────────────────────────────────
step "Configurando fail2ban..."

cat > /etc/fail2ban/jail.local <<'EOF'
[DEFAULT]
bantime  = 1h
findtime = 10m
maxretry = 5
ignoreip = 127.0.0.1/8 ::1

[sshd]
enabled = true
port    = ssh
logpath = %(sshd_log)s
maxretry = 3

[nginx-http-auth]
enabled = true
logpath = /var/log/nginx/error.log

[nginx-req-limit]
enabled = true
filter  = nginx-req-limit
logpath = /var/log/nginx/error.log
maxretry = 10
EOF

systemctl enable fail2ban
systemctl restart fail2ban
ok "fail2ban configurado"

# ── 5. SWAP ───────────────────────────────────────────────────
step "Configurando swap (4GB)..."

if [ ! -f /swapfile ]; then
    fallocate -l 4G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    sysctl vm.swappiness=10
    echo 'vm.swappiness=10' >> /etc/sysctl.conf
    ok "Swap de 4GB creado"
else
    ok "Swap ya configurado"
fi

# ── 6. LÍMITES DEL SISTEMA ───────────────────────────────────
step "Ajustando límites del sistema..."

cat >> /etc/security/limits.conf <<'EOF'
* soft nofile 65535
* hard nofile 65535
root soft nofile 65535
root hard nofile 65535
EOF

sysctl -w net.core.somaxconn=65535
sysctl -w net.ipv4.tcp_max_syn_backlog=65535
echo 'net.core.somaxconn=65535' >> /etc/sysctl.conf
echo 'net.ipv4.tcp_max_syn_backlog=65535' >> /etc/sysctl.conf
ok "Límites del sistema ajustados"

# ── 7. LOGROTATE ──────────────────────────────────────────────
step "Configurando rotación de logs..."

cat > /etc/logrotate.d/sigint <<'EOF'
/home/sigint/sigint/logs/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    sharedscripts
    postrotate
        docker compose -f /home/sigint/sigint/docker-compose.yml kill -s USR1 nginx 2>/dev/null || true
    endscript
}

/home/sigint/sigint/backups/backup.log {
    weekly
    rotate 8
    compress
    missingok
}
EOF
ok "Logrotate configurado"

# ── 8. DIRECTORIOS ────────────────────────────────────────────
step "Creando directorios de datos..."

mkdir -p \
    ./backups \
    ./data/uploads \
    ./logs \
    ./nginx/conf.d \
    ./ml/models

chmod 700 ./backups
ok "Directorios creados"

# ── 9. CRON DE BACKUPS ────────────────────────────────────────
step "Configurando cron de backups..."

CRON_JOB="0 2 * * * cd $(pwd) && ./scripts/backup.sh >> ./backups/backup.log 2>&1"
(crontab -l 2>/dev/null | grep -v "backup.sh"; echo "$CRON_JOB") | crontab -
ok "Cron de backup a las 02:00 configurado"

# ── 10. ARRANCAR LOS SERVICIOS ────────────────────────────────
step "Arrancando servicios base (sin SSL aún)..."

docker compose up -d postgres redis neo4j ollama
sleep 15

# Aplicar migraciones
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    < database/migrations/001_schema_inicial.sql 2>/dev/null || warn "Migración 001 ya aplicada"
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    < database/migrations/002_pipeline_osint.sql 2>/dev/null || warn "Migración 002 ya aplicada"
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    < database/migrations/003_ml_avanzado.sql 2>/dev/null || warn "Migración 003 ya aplicada"

docker compose up -d backend frontend pipeline ml
ok "Servicios base arrancados"

# ── 11. CERTIFICADO SSL ──────────────────────────────────────
step "Obteniendo certificado SSL para $DOMAIN..."

# Arrancar nginx en modo HTTP primero (sin SSL)
cat > ./nginx/conf.d/pre-ssl.conf <<EOF
server {
    listen 80;
    server_name $DOMAIN;
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    location / {
        return 200 'SIGINT DataCenter Pro — Configurando SSL...';
        add_header Content-Type text/plain;
    }
}
EOF

docker compose -f docker-compose.prod.yml up -d nginx

# Esperar a que Nginx esté listo
sleep 5

# Solicitar certificado
docker compose -f docker-compose.prod.yml run --rm certbot \
    certonly \
    --webroot \
    --webroot-path=/var/www/certbot \
    --email "$EMAIL" \
    --agree-tos \
    --no-eff-email \
    -d "$DOMAIN" \
    && ok "Certificado SSL obtenido" \
    || warn "Certificado SSL fallido — verifica que el dominio apunte a este servidor"

# Activar config completa con SSL
rm -f ./nginx/conf.d/pre-ssl.conf

# Actualizar DOMAIN en nginx.conf
sed -i "s/\${DOMAIN}/$DOMAIN/g" ./nginx/nginx.conf

docker compose -f docker-compose.prod.yml up -d

ok "Nginx con SSL activo"

# ── 12. MONITOREO ─────────────────────────────────────────────
step "Arrancando monitoreo..."
docker compose -f docker-compose.prod.yml up -d prometheus grafana loki promtail
ok "Monitoreo activo"

# ── RESUMEN FINAL ─────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}"
echo "╔══════════════════════════════════════════════╗"
echo "║           DESPLIEGUE COMPLETADO              ║"
echo "╚══════════════════════════════════════════════╝"
echo -e "${NC}"
echo -e "  ${BOLD}Dashboard:${NC}   https://$DOMAIN"
echo -e "  ${BOLD}API docs:${NC}    https://$DOMAIN/docs"
echo -e "  ${BOLD}Grafana:${NC}     http://$(hostname -I | awk '{print $1}'):8080/grafana"
echo -e "  ${BOLD}Prometheus:${NC}  http://$(hostname -I | awk '{print $1}'):8080/prometheus"
echo ""
echo -e "  ${YELLOW}Próximos pasos:${NC}"
echo -e "  1. Crear usuario administrador: ./scripts/crear_admin.sh"
echo -e "  2. Verificar salud del sistema: docker compose ps"
echo -e "  3. Ver logs: docker compose logs -f backend"
echo -e "  4. Configurar Grafana: acceder y añadir datasources (auto-provisioned)"
echo ""
