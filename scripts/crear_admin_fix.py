#!/usr/bin/env python3
# scripts/crear_admin_fix.py
# ============================================================
# Crea o repara el usuario administrador con hash bcrypt real
# Ejecutar: docker compose exec backend python /app/scripts/crear_admin_fix.py
# O desde fuera: python scripts/crear_admin_fix.py
# ============================================================
import asyncio
import os
import sys
import getpass

# Añadir el path del backend
sys.path.insert(0, '/app')
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

async def crear_admin():
    print("\n=== Crear/Reparar usuario administrador — SIGINT DataCenter Pro ===\n")

    # Pedir datos
    username = input("Username [admin]: ").strip() or "admin"
    email    = input("Email: ").strip()
    nombre   = input("Nombre completo: ").strip()

    while True:
        password = getpass.getpass("Contraseña (mín. 12 chars, mayúsculas, números y símbolo): ")
        if len(password) < 12:
            print("  La contraseña debe tener al menos 12 caracteres")
            continue
        if not any(c.isupper() for c in password):
            print("  Debe contener al menos una mayúscula")
            continue
        if not any(c.isdigit() for c in password):
            print("  Debe contener al menos un número")
            continue
        break

    # Hashear con bcrypt
    try:
        from passlib.context import CryptContext
        pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=12)
        password_hash = pwd_ctx.hash(password)
        print(f"  Hash generado correctamente")
    except ImportError:
        # Si passlib no está disponible, usar bcrypt directamente
        import subprocess
        result = subprocess.run(
            ['python3', '-c', f'''
import bcrypt
h = bcrypt.hashpw(b"{password}", bcrypt.gensalt(rounds=12))
print(h.decode())
'''], capture_output=True, text=True)
        password_hash = result.stdout.strip()
        if not password_hash:
            print("ERROR: No se pudo generar el hash de la contraseña")
            sys.exit(1)

    # Conectar a PostgreSQL
    try:
        import asyncpg
    except ImportError:
        print("ERROR: asyncpg no disponible. Ejecuta este script desde dentro del contenedor backend:")
        print("  docker compose exec backend python /app/scripts/crear_admin_fix.py")
        sys.exit(1)

    pg_url = (
        f"postgresql://{os.getenv('POSTGRES_USER', 'sigint_admin')}:"
        f"{os.getenv('POSTGRES_PASSWORD', '')}@"
        f"{os.getenv('POSTGRES_HOST', 'localhost')}:"
        f"{os.getenv('POSTGRES_PORT', '5432')}/"
        f"{os.getenv('POSTGRES_DB', 'sigint')}"
    )

    try:
        conn = await asyncpg.connect(pg_url)
    except Exception as e:
        print(f"ERROR conectando a PostgreSQL: {e}")
        print("\nAsegúrate de que PostgreSQL está corriendo:")
        print("  docker compose ps postgres")
        sys.exit(1)

    try:
        # Obtener rol root
        rol_id = await conn.fetchval(
            "SELECT id FROM auth.roles WHERE codigo = 'root' LIMIT 1"
        )
        if not rol_id:
            # Crear rol root si no existe
            rol_id = await conn.fetchval("""
                INSERT INTO auth.roles (nombre, codigo, nivel_acceso, permisos)
                VALUES ('Administrador', 'root', 5, '{"all": true}'::jsonb)
                ON CONFLICT (codigo) DO UPDATE SET nivel_acceso = 5
                RETURNING id
            """)

        # Verificar si el usuario ya existe
        existing = await conn.fetchrow(
            "SELECT id, username FROM auth.usuarios WHERE username = $1 OR email = $2",
            username, email
        )

        if existing:
            # Actualizar contraseña del usuario existente
            await conn.execute("""
                UPDATE auth.usuarios
                SET password_hash = $1,
                    activo = TRUE,
                    bloqueado = FALSE,
                    intentos_fallidos = 0,
                    rol_id = $2,
                    nombre_completo = $3,
                    email = $4
                WHERE id = $5
            """, password_hash, rol_id, nombre or existing['username'], email, existing['id'])
            print(f"\n  ✓ Usuario '{existing['username']}' actualizado con contraseña correcta")
        else:
            # Crear nuevo usuario
            import uuid
            user_id = str(uuid.uuid4())
            await conn.execute("""
                INSERT INTO auth.usuarios
                    (id, username, email, password_hash, nombre_completo,
                     rol_id, activo, bloqueado, intentos_fallidos)
                VALUES ($1, $2, $3, $4, $5, $6, TRUE, FALSE, 0)
            """, user_id, username, email, password_hash, nombre, rol_id)
            print(f"\n  ✓ Usuario '{username}' creado correctamente")

        # Verificar
        user = await conn.fetchrow(
            "SELECT id, username, email, nivel_acceso FROM auth.usuarios u "
            "JOIN auth.roles r ON u.rol_id = r.id "
            "WHERE u.username = $1",
            username
        )
        if user:
            print(f"  ID:            {user['id']}")
            print(f"  Username:      {user['username']}")
            print(f"  Email:         {user['email']}")
            print(f"  Nivel acceso:  {user['nivel_acceso']}")
            print(f"\n  Ahora puedes hacer login en http://localhost:3000")
        else:
            print("  AVISO: No se pudo verificar el usuario")

    except Exception as e:
        print(f"ERROR en la base de datos: {e}")
        import traceback
        traceback.print_exc()
    finally:
        await conn.close()


if __name__ == '__main__':
    asyncio.run(crear_admin())
