#!/bin/bash
# crear_admin.sh — Crea el primer usuario administrador del sistema
set -e
set -a; source .env; set +a

BOLD='\033[1m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

echo ""
echo -e "${BOLD}Crear usuario administrador — SIGINT DataCenter Pro${NC}"
echo ""

# Leer datos del administrador
read -p "Username: " ADMIN_USERNAME
read -p "Email: " ADMIN_EMAIL
read -p "Nombre completo: " ADMIN_NOMBRE
read -s -p "Contraseña (mín. 12 chars, mayúsculas, números y símbolo): " ADMIN_PASS
echo ""

# Crear usuario via Python/psycopg2 directamente en BD
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<SQL
DO \$\$
DECLARE
    v_hash TEXT;
    v_id UUID := gen_random_uuid();
BEGIN
    -- Hash de la contraseña (bcrypt simulado para bootstrap)
    -- En producción esto lo hace el backend via API
    INSERT INTO auth.usuarios (
        id, username, email, password_hash,
        nombre_completo, rol_id, activo
    )
    SELECT
        v_id,
        '$ADMIN_USERNAME',
        '$ADMIN_EMAIL',
        -- Placeholder: se debe cambiar por hash real via API /auth/change-password
        'CAMBIAR_VIA_API_\$2b\$12\$placeholder',
        '$ADMIN_NOMBRE',
        (SELECT id FROM auth.roles WHERE codigo = 'root'),
        TRUE
    WHERE NOT EXISTS (
        SELECT 1 FROM auth.usuarios WHERE username = '$ADMIN_USERNAME'
    );

    IF FOUND THEN
        RAISE NOTICE 'Usuario % creado con ID %', '$ADMIN_USERNAME', v_id;
    ELSE
        RAISE NOTICE 'El usuario % ya existe', '$ADMIN_USERNAME';
    END IF;
END;
\$\$;
SQL

echo ""
echo -e "${YELLOW}IMPORTANTE: El usuario se creó con hash placeholder.${NC}"
echo -e "Para establecer la contraseña real, usa la API:"
echo ""
echo -e "  ${BOLD}curl -X POST http://localhost:${BACKEND_PORT:-8000}/api/v1/auth/login \\${NC}"
echo -e "  ${BOLD}  -H 'Content-Type: application/json' \\${NC}"
echo -e "  ${BOLD}  -d '{\"username\": \"$ADMIN_USERNAME\", \"password\": \"...\"}'${NC}"
echo ""
echo -e "O mejor aún, usa la interfaz Swagger en:"
echo -e "  ${BOLD}http://localhost:${BACKEND_PORT:-8000}/docs${NC}"
echo ""

# Alternativa: crear el usuario directamente vía API del backend con hash real
echo -e "${YELLOW}Creando usuario con hash correcto vía backend...${NC}"
RESPONSE=$(curl -sf -X POST "http://localhost:${BACKEND_PORT:-8000}/api/v1/usuarios/bootstrap" \
    -H "Content-Type: application/json" \
    -d "{
        \"username\": \"$ADMIN_USERNAME\",
        \"email\": \"$ADMIN_EMAIL\",
        \"password\": \"$ADMIN_PASS\",
        \"nombre_completo\": \"$ADMIN_NOMBRE\",
        \"rol_id\": 6,
        \"bootstrap_secret\": \"$SECRET_KEY\"
    }" 2>/dev/null || echo "ERROR")

if echo "$RESPONSE" | grep -q "ERROR\|error"; then
    echo -e "${YELLOW}El endpoint de bootstrap no está disponible.${NC}"
    echo -e "Usa la interfaz Swagger para crear usuarios manualmente."
else
    echo -e "${GREEN}Usuario administrador creado correctamente.${NC}"
fi
