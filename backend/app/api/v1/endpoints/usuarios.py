# app/api/v1/endpoints/usuarios.py
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.dependencies import get_db_session, get_current_user, require_nivel, CurrentUser
from app.schemas import UsuarioCreate, UsuarioPublico
import bcrypt as _bcrypt

router = APIRouter(prefix="/usuarios", tags=["Usuarios"])


@router.get("")
async def listar_usuarios(
    activo: bool | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_nivel(4)),
):
    """Lista usuarios del sistema. Requiere nivel 4+."""
    offset = (page - 1) * page_size
    where = "WHERE 1=1"
    params: dict = {"limit": page_size, "offset": offset}
    if activo is not None:
        where += " AND u.activo = :activo"
        params["activo"] = activo

    result = await db.execute(
        text(f"""
            SELECT u.id, u.username, u.email, u.nombre_completo,
                   u.rol_id, u.nivel_acceso, u.activo, u.bloqueado,
                   u.totp_activo, u.ultimo_login, u.created_at,
                   r.nombre AS rol_nombre
            FROM auth.usuarios u
            JOIN auth.roles r ON u.rol_id = r.id
            {where}
            ORDER BY u.created_at DESC
            LIMIT :limit OFFSET :offset
        """),
        params,
    )
    rows = result.fetchall()

    count = await db.execute(
        text(f"SELECT COUNT(*) FROM auth.usuarios u {where}"),
        {k: v for k, v in params.items() if k not in ('limit', 'offset')},
    )
    total = count.scalar() or 0

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": -(-total // page_size),
        "items": [dict(r._mapping) for r in rows],
    }


@router.post("", status_code=201)
async def crear_usuario(
    body: UsuarioCreate,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_nivel(4)),
):
    """Crea un nuevo usuario. Requiere nivel 4+."""
    # Check username/email not taken
    existing = await db.execute(
        text("SELECT id FROM auth.usuarios WHERE username = :u OR email = :e"),
        {"u": body.username, "e": str(body.email)},
    )
    if existing.fetchone():
        raise HTTPException(status_code=400, detail="El username o email ya existe")

    pw_hash = _bcrypt.hashpw(body.password.encode(), _bcrypt.gensalt(12)).decode()

    result = await db.execute(
        text("""
            INSERT INTO auth.usuarios
                (username, email, password_hash, nombre_completo, rol_id, activo)
            VALUES (:username, :email, :password_hash, :nombre_completo, :rol_id, TRUE)
            RETURNING id, username, email, nombre_completo, rol_id, nivel_acceso,
                      activo, ultimo_login, created_at
        """),
        {
            "username": body.username,
            "email": str(body.email),
            "password_hash": pw_hash,
            "nombre_completo": body.nombre_completo,
            "rol_id": body.rol_id,
        },
    )
    row = result.fetchone()
    return dict(row._mapping)


@router.patch("/{usuario_id}")
async def actualizar_usuario(
    usuario_id: UUID,
    body: dict,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_nivel(4)),
):
    """Actualiza un usuario. Requiere nivel 4+."""
    allowed = {'nombre_completo', 'email', 'activo', 'bloqueado', 'rol_id', 'idioma', 'zona_horaria'}
    datos = {k: v for k, v in body.items() if k in allowed}
    if not datos:
        raise HTTPException(status_code=400, detail="Sin campos válidos")

    set_clauses = ", ".join(f"{k} = :{k}" for k in datos)
    await db.execute(
        text(f"UPDATE auth.usuarios SET {set_clauses} WHERE id = :id"),
        {**datos, "id": usuario_id},
    )
    result = await db.execute(
        text("SELECT id, username, email, nombre_completo, rol_id, nivel_acceso, activo, bloqueado, ultimo_login, created_at FROM auth.usuarios WHERE id = :id"),
        {"id": usuario_id},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return dict(row._mapping)


@router.get("/roles")
async def listar_roles(
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_nivel(4)),
):
    """Lista los roles disponibles."""
    result = await db.execute(
        text("SELECT id, codigo, nombre, nivel_acceso FROM auth.roles WHERE activo = TRUE ORDER BY nivel_acceso")
    )
    return [dict(r._mapping) for r in result.fetchall()]


@router.get("/kpis")
async def usuarios_kpis(
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_nivel(4)),
):
    result = await db.execute(text("""
        SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE activo = TRUE) AS activos,
            COUNT(*) FILTER (WHERE activo = FALSE) AS inactivos,
            COUNT(*) FILTER (WHERE u.nivel_acceso = 5) AS admins,
            COUNT(*) FILTER (WHERE ultimo_login >= NOW() - INTERVAL '24h') AS conectados_hoy
        FROM auth.usuarios u
    """))
    return dict(result.fetchone()._mapping)


@router.delete("/{usuario_id}")
async def eliminar_usuario(
    usuario_id: UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_nivel(5)),
):
    if str(usuario_id) == str(current_user.id):
        raise HTTPException(status_code=400, detail="No puedes eliminarte a ti mismo")
    await db.execute(
        text("UPDATE auth.usuarios SET activo = FALSE WHERE id = :id"),
        {"id": usuario_id}
    )
    return {"message": "Usuario desactivado"}


@router.post("/{usuario_id}/reset-password")
async def reset_password(
    usuario_id: UUID,
    body: dict,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_nivel(4)),
):
    nueva = body.get("nueva_password", "")
    if len(nueva) < 8:
        raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 8 caracteres")
    pw_hash = _bcrypt.hashpw(nueva.encode(), _bcrypt.gensalt(12)).decode()
    await db.execute(
        text("UPDATE auth.usuarios SET password_hash = :hash WHERE id = :id"),
        {"hash": pw_hash, "id": usuario_id}
    )
    return {"message": "Contraseña actualizada"}


@router.patch("/roles/{rol_id}/permisos")
async def actualizar_permisos_rol(
    rol_id: int,
    body: dict,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_nivel(5)),
):
    """Actualiza los permisos JSONB de un rol."""
    import json
    await db.execute(
        text("UPDATE auth.roles SET permisos = :permisos::jsonb WHERE id = :id"),
        {"permisos": json.dumps(body.get("permisos", {})), "id": rol_id}
    )
    result = await db.execute(
        text("SELECT id, codigo, nombre, nivel_acceso, permisos FROM auth.roles WHERE id = :id"),
        {"id": rol_id}
    )
    row = result.fetchone()
    return dict(row._mapping)


@router.get("/roles/detalle")
async def roles_con_permisos(
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_nivel(4)),
):
    """Lista roles con sus permisos completos."""
    result = await db.execute(text("""
        SELECT r.id, r.codigo, r.nombre, r.nivel_acceso, r.descripcion, r.permisos,
               COUNT(u.id) AS total_usuarios
        FROM auth.roles r
        LEFT JOIN auth.usuarios u ON u.rol_id = r.id AND u.activo = TRUE
        WHERE r.activo = TRUE
        GROUP BY r.id ORDER BY r.nivel_acceso
    """))
    return [dict(r._mapping) for r in result.fetchall()]
