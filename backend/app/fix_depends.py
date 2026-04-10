#!/usr/bin/env python3
"""
fix_depends.py
Ejecutar con: docker compose exec backend python /app/fix_depends.py
Arregla el error: non-default argument follows default argument
"""
import ast
import re
import os
import sys

ENDPOINTS_DIR = "/app/app/api/v1/endpoints"

def fix_file(path):
    with open(path, 'r', encoding='utf-8') as f:
        original = f.read()

    lines = original.split('\n')
    new_lines = []
    changed = False

    for i, line in enumerate(lines):
        # Detectar líneas de parámetros de función que son dependencias FastAPI
        # sin valor por defecto. Patrón: exactamente 4 espacios + param: Tipo,
        match = re.match(
            r'^(    )(db: DBSession'
            r'|current_user: AuthUser'
            r'|current_user: Nivel2User'
            r'|current_user: Nivel3User'
            r'|current_user: Nivel4User'
            r'|current_user: Nivel5User'
            r'|background_tasks: BackgroundTasks'
            r')(,?)$',
            line
        )
        if match:
            indent = match.group(1)
            param = match.group(2)
            # Añadir = Depends() si no lo tiene ya
            new_line = f"{indent}{param} = Depends(),"
            if new_line != line:
                new_lines.append(new_line)
                changed = True
                continue

        new_lines.append(line)

    new_content = '\n'.join(new_lines)

    # Verificar sintaxis
    try:
        ast.parse(new_content)
    except SyntaxError as e:
        print(f"  ERROR de sintaxis después del parche: {e}")
        return False

    if changed:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"  FIXED: {os.path.basename(path)}")
    else:
        print(f"  OK (sin cambios): {os.path.basename(path)}")

    return True


def main():
    print("\n=== Fix FastAPI Depends — SIGINT DataCenter Pro ===\n")

    if not os.path.isdir(ENDPOINTS_DIR):
        print(f"ERROR: No se encuentra {ENDPOINTS_DIR}")
        print("Asegúrate de ejecutar este script dentro del contenedor:")
        print("  docker compose exec backend python /app/fix_depends.py")
        sys.exit(1)

    files = [f for f in os.listdir(ENDPOINTS_DIR) if f.endswith('.py')]
    errors = 0

    for fname in sorted(files):
        path = os.path.join(ENDPOINTS_DIR, fname)
        print(f"Procesando: {fname}")
        if not fix_file(path):
            errors += 1

    print(f"\n{'='*50}")
    if errors == 0:
        print("Todos los archivos corregidos y verificados.")
        print("\nAhora reinicia el backend:")
        print("  (desde Git Bash en C:\\SIGINT)  docker compose restart backend")
        print("  docker compose logs backend 2>&1 | tail -5")
    else:
        print(f"ATENCIÓN: {errors} archivo(s) con errores. Revisa arriba.")

    sys.exit(errors)


if __name__ == '__main__':
    main()
