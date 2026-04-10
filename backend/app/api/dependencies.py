# app/api/dependencies.py
# ============================================================
# Dependencias de FastAPI: autenticación, usuario actual, RLS
# ============================================================
from typing import Annotated
from uuid import UUID

import structlog
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import AsyncSessionLocal, get_redis_sessions
from app.core.security import decode_token, verify_token_type

log = structlog.get_logger()
bearer_scheme = HTTPBearer(auto_error=False)


# ── USUARIO ACTUAL ────────────────────────────────────────────

class CurrentUser:
    """Datos del usuario autenticado, disponibles en toda la request."""
    def __init__(
        self,
        id: UUID,
        username: str,
        email: str,
        rol_id: int,
        nivel_acceso: int,
        activo: bool,
        bloqueado: bool,
        permisos: dict,
    ):
        self.id = id
        self.username = username
        self.email = email
        self.rol_id = rol_id
        self.nivel_acceso = nivel_acceso
        self.activo = activo
        self.bloqueado = bloqueado
        self.permisos = permisos

    def puede(self, modulo: str, accion: str) -> bool:
        """Verifica si el usuario tiene permiso para una acción en un módulo."""
        mod_perms = self.permisos.get(modulo, {})
        if isinstance(mod_perms, dict):
            return bool(mod_perms.get(accion, False))
        return bool(mod_perms)

    def nivel_suficiente(self, nivel_requerido: int) -> bool:
        return self.nivel_acceso >= nivel_requerido


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
) -> CurrentUser:
    """
    Extrae y valida el JWT. Verifica que la sesión siga activa en Redis.
    Devuelve el usuario actual o lanza 401.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="No autenticado o token inválido",
        headers={"WWW-Authenticate": "Bearer"},
    )

    if not credentials:
        raise credentials_exception

    token = credentials.credentials

    try:
        payload = decode_token(token)
        if not verify_token_type(payload, "access"):
            raise credentials_exception
        user_id: str = payload.get("sub")
        if not user_id:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    # Verificar que la sesión sigue activa en Redis
    redis = get_redis_sessions()
    session_key = f"session:{user_id}:{token[-16:]}"  # sufijo del token como clave
    session_active = await redis.exists(session_key)
    if not session_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sesión expirada o cerrada",
        )

    # Cargar usuario desde BD
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            text("""
                SELECT u.id, u.username, u.email, u.rol_id,
                       u.nivel_acceso, u.activo, u.bloqueado,
                       r.permisos
                FROM auth.usuarios u
                JOIN auth.roles r ON u.rol_id = r.id
                WHERE u.id = :user_id
            """),
            {"user_id": user_id},
        )
        row = result.fetchone()

    if not row:
        raise credentials_exception

    if not row.activo:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Usuario desactivado",
        )
    if row.bloqueado:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Usuario bloqueado",
        )

    return CurrentUser(
        id=row.id,
        username=row.username,
        email=row.email,
        rol_id=row.rol_id,
        nivel_acceso=row.nivel_acceso,
        activo=row.activo,
        bloqueado=row.bloqueado,
        permisos=row.permisos or {},
    )


# ── SESIÓN DE BD CON RLS ACTIVO ───────────────────────────────

async def get_db_session(
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
) -> AsyncSession:
    """
    Provee una sesión PostgreSQL con el user_id inyectado.
    Las políticas RLS usan app.current_user_id para filtrar datos.
    """
    async with AsyncSessionLocal() as session:
        # Este SET LOCAL activa las políticas RLS para este usuario
        await session.execute(
            text(f"SET LOCAL app.current_user_id = '{str(current_user.id)}'"),
        )
        try:
            yield session
            await session.commit()
        except Exception as e:
            log.error("DB session error", error=str(e))
            await session.rollback()
            raise


# ── DEPENDENCIAS DE NIVEL DE ACCESO ───────────────────────────

def require_nivel(nivel: int):
    """Factory de dependencia que exige un nivel mínimo de clearance."""
    async def _check(
        current_user: Annotated[CurrentUser, Depends(get_current_user)]
    ) -> CurrentUser:
        if not current_user.nivel_suficiente(nivel):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requiere nivel de acceso {nivel} o superior",
            )
        return current_user
    return _check


def require_permiso(modulo: str, accion: str):
    """Factory que exige un permiso específico."""
    async def _check(
        current_user: Annotated[CurrentUser, Depends(get_current_user)]
    ) -> CurrentUser:
        if not current_user.puede(modulo, accion):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Sin permiso para {accion} en {modulo}",
            )
        return current_user
    return _check


# ── TIPOS ANOTADOS PARA INYECCIÓN ────────────────────────────

AuthUser = Annotated[CurrentUser, Depends(get_current_user)]
DBSession = Annotated[AsyncSession, Depends(get_db_session)]
Nivel2User = Annotated[CurrentUser, Depends(require_nivel(2))]
Nivel3User = Annotated[CurrentUser, Depends(require_nivel(3))]
Nivel4User = Annotated[CurrentUser, Depends(require_nivel(4))]
Nivel5User = Annotated[CurrentUser, Depends(require_nivel(5))]
