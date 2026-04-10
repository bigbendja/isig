#!/bin/bash
# scripts/backup.sh — Backup automatizado con retención
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
set -a; source "$PROJECT_DIR/.env"; set +a

BACKUP_BASE="${BACKUP_DIR:-$PROJECT_DIR/backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR_HOY="$BACKUP_BASE/$(date +%Y%m%d)"
LOG="$BACKUP_BASE/backup.log"
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

mkdir -p "$BACKUP_DIR_HOY"
log()      { echo "$(date '+%H:%M:%S') $*" | tee -a "$LOG"; }
log_ok()   { log "${GREEN}OK${NC}  $*"; }
log_warn() { log "${YELLOW}WARN${NC} $*"; }
log_err()  { log "${RED}ERR${NC}  $*"; }

ERRORES=0
log "=== Backup SIGINT DataCenter Pro — $TIMESTAMP ==="

# 1. PostgreSQL
log "Backup PostgreSQL..."
PG_FILE="$BACKUP_DIR_HOY/postgres_${TIMESTAMP}.sql.gz"
docker compose -f "$PROJECT_DIR/docker-compose.yml" exec -T postgres \
    pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-password \
    2>>"$LOG" | gzip -9 > "$PG_FILE" \
    && gunzip -t "$PG_FILE" 2>/dev/null \
    && log_ok "PostgreSQL: $PG_FILE ($(du -sh "$PG_FILE" | cut -f1))" \
    || { log_err "PostgreSQL backup fallido"; ERRORES=$((ERRORES+1)); }

# 2. Neo4j
log "Backup Neo4j..."
NEO4J_FILE="$BACKUP_DIR_HOY/neo4j_${TIMESTAMP}.gz"
docker compose -f "$PROJECT_DIR/docker-compose.yml" exec -T neo4j \
    neo4j-admin database dump --database=neo4j --to-stdout \
    2>>"$LOG" | gzip -9 > "$NEO4J_FILE" \
    && log_ok "Neo4j: $NEO4J_FILE ($(du -sh "$NEO4J_FILE" | cut -f1))" \
    || { log_warn "Neo4j admin dump no disponible, omitiendo"; }

# 3. Uploads + ML models
for dir_rel in "data/uploads" "ml/models"; do
    full="$PROJECT_DIR/$dir_rel"
    name=$(echo "$dir_rel" | tr '/' '_')
    if [ -d "$full" ] && [ -n "$(ls -A "$full" 2>/dev/null)" ]; then
        out="$BACKUP_DIR_HOY/${name}_${TIMESTAMP}.tar.gz"
        tar -czf "$out" -C "$PROJECT_DIR" "$dir_rel" 2>>"$LOG" \
            && log_ok "$dir_rel: $out ($(du -sh "$out" | cut -f1))" \
            || log_warn "$dir_rel: fallo comprimiendo"
    fi
done

# 4. Config
cp "$PROJECT_DIR/.env" "$BACKUP_DIR_HOY/.env.bak" && chmod 600 "$BACKUP_DIR_HOY/.env.bak"
log_ok ".env guardado"

# 5. Checksums
find "$BACKUP_DIR_HOY" -type f ! -name "*.sha256" -exec sha256sum {} \; \
    > "$BACKUP_DIR_HOY/checksums.sha256"
log_ok "Checksums generados"

# 6. Retención: borrar diarios con más de 7 días (excepto lunes y día 1)
find "$BACKUP_BASE" -maxdepth 1 -type d -name "20??????" -mtime +7 | while read d; do
    dom=$(date -d "$(basename $d)" +%d 2>/dev/null || echo "00")
    dow=$(date -d "$(basename $d)" +%u 2>/dev/null || echo "0")
    if [ "$dom" != "01" ] && [ "$dow" != "1" ]; then
        rm -rf "$d" && log "Eliminado backup antiguo: $(basename $d)"
    fi
done
# Mensuales > 90 días
find "$BACKUP_BASE" -maxdepth 1 -type d -name "20??????" -mtime +90 | while read d; do
    rm -rf "$d" && log "Eliminado backup mensual antiguo: $(basename $d)"
done

TOTAL=$(du -sh "$BACKUP_DIR_HOY" 2>/dev/null | cut -f1 || echo "?")
log "=== Completado: $TOTAL | Errores: $ERRORES ==="
[ $ERRORES -eq 0 ] && exit 0 || exit 1
