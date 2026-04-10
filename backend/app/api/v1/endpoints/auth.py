# app/api/v1/endpoints/auth.py
# ============================================================
# Autenticación: login, logout, refresh, 2FA
# ============================================================
import base64
from datetime import UTC, datetime, timedelta

import structlog
from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import text

from app.api.dependencies import AuthUser, DBSession
from app.core.config import settings
from app.core.database import AsyncSessionLocal, get_redis_sessions
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    generate_totp_qr,
    generate_totp_secret,
    hash_password,
    verify_password,
    verify_totp,
    verify_token_type,
)
from app.schemas import (
    ChangePasswordRequest,
    LoginRequest,
    RefreshRequest,
    Setup2FAResponse,
    SuccessResponse,
    TokenResponse,
    Verify2FARequest,
)

router = APIRouter(prefix="/auth", tags=["Autenticación"])
log = structlog.get_logger()


@router.post("/login", response_model=TokenResponse)
async def login(request: Request, body: LoginRequest):
    """
    Login con username/password. Si el usuario tiene 2FA activo,
    también requiere el código TOTP.
    """
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            text("""
                SELECT u.id, u.username, u.email, u.password_hash,
                       u.totp_activo, u.totp_secret, u.activo, u.bloqueado,
                       u.intentos_fallidos, u.nombre_completo,
                       u.rol_id, u.nivel_acceso,
                       r.permisos
                FROM auth.usuarios u
                JOIN auth.roles r ON u.rol_id = r.id
                WHERE u.username = :username OR u.email = :username
            """),
            {"username": body.username},
        )
        usuario = result.fetchone()

    if not usuario:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales incorrectas",
        )

    if not usuario.activo:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Usuario desactivado",
        )

    if usuario.bloqueado:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cuenta bloqueada. Contacta con el administrador.",
        )

    # Verificar contraseña
    if not verify_password(body.password, usuario.password_hash):
        async with AsyncSessionLocal() as db:
            await db.execute(
                text("""
                    UPDATE auth.usuarios
                    SET intentos_fallidos = intentos_fallidos + 1,
                        bloqueado = (intentos_fallidos + 1 >= 10)
                    WHERE id = :uid
                """),
                {"uid": usuario.id},
            )
            await db.commit()

        await _log_acceso(
            usuario_id=str(usuario.id),
            accion="login_fallido",
            ip=request.client.host if request.client else None,
            exito=False,
            razon="contraseña_incorrecta",
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales incorrectas",
        )

    # Verificar 2FA si está activo
    if usuario.totp_activo:
        if not body.totp_code:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Se requiere código 2FA",
                headers={"X-2FA-Required": "true"},
            )
        if not verify_totp(usuario.totp_secret, body.totp_code):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Código 2FA incorrecto",
            )

    # Generar tokens
    token_data = {
        "sub": str(usuario.id),
        "username": usuario.username,
        "nivel": usuario.nivel_acceso,
    }
    access_token = create_access_token(token_data)
    refresh_token = create_refresh_token(str(usuario.id))

    # Guardar sesión en Redis
    redis = get_redis_sessions()
    session_key = f"session:{usuario.id}:{access_token[-16:]}"
    await redis.setex(
        session_key,
        timedelta(minutes=settings.JWT_EXPIRE_MINUTES),
        "1",
    )

    # Actualizar último login y resetear intentos fallidos
    async with AsyncSessionLocal() as db:
        await db.execute(
            text("""
                UPDATE auth.usuarios
                SET ultimo_login = NOW(),
                    intentos_fallidos = 0,
                    ultimo_ip = :ip
                WHERE id = :uid
            """),
            {"uid": usuario.id, "ip": request.client.host if request.client else None},
        )
        await db.commit()

    await _log_acceso(
        usuario_id=str(usuario.id),
        accion="login",
        ip=request.client.host if request.client else None,
        exito=True,
    )

    log.info("Login exitoso", username=usuario.username, nivel=usuario.nivel_acceso)

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=settings.JWT_EXPIRE_MINUTES * 60,
        usuario={
            "id": usuario.id,
            "username": usuario.username,
            "email": usuario.email,
            "nombre_completo": usuario.nombre_completo,
            "rol_id": usuario.rol_id,
            "nivel_acceso": usuario.nivel_acceso,
            "activo": usuario.activo,
            "ultimo_login": datetime.now(UTC),
            "created_at": datetime.now(UTC),
        },
    )


@router.post("/logout", response_model=SuccessResponse)
async def logout(current_user: AuthUser):
    """Invalida la sesión actual en Redis."""
    redis = get_redis_sessions()
    # Borrar todas las sesiones del usuario (logout global)
    keys = await redis.keys(f"session:{current_user.id}:*")
    if keys:
        await redis.delete(*keys)

    await _log_acceso(
        usuario_id=str(current_user.id),
        accion="logout",
        exito=True,
    )
    return SuccessResponse(message="Sesión cerrada correctamente")


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(body: RefreshRequest):
    """Renueva el access token usando el refresh token."""
    try:
        payload = decode_token(body.refresh_token)
        if not verify_token_type(payload, "refresh"):
            raise ValueError("tipo incorrecto")
        user_id = payload.get("sub")
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token inválido o expirado",
        )

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            text("""
                SELECT u.id, u.username, u.email, u.nombre_completo,
                       u.rol_id, u.nivel_acceso, u.activo
                FROM auth.usuarios u
                WHERE u.id = :uid AND u.activo = TRUE AND u.bloqueado = FALSE
            """),
            {"uid": user_id},
        )
        usuario = result.fetchone()

    if not usuario:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuario no encontrado o desactivado",
        )

    access_token = create_access_token({
        "sub": str(usuario.id),
        "username": usuario.username,
        "nivel": usuario.nivel_acceso,
    })
    new_refresh = create_refresh_token(str(usuario.id))

    redis = get_redis_sessions()
    session_key = f"session:{usuario.id}:{access_token[-16:]}"
    await redis.setex(
        session_key,
        timedelta(minutes=settings.JWT_EXPIRE_MINUTES),
        "1",
    )

    return TokenResponse(
        access_token=access_token,
        refresh_token=new_refresh,
        expires_in=settings.JWT_EXPIRE_MINUTES * 60,
        usuario={
            "id": usuario.id,
            "username": usuario.username,
            "email": usuario.email,
            "nombre_completo": usuario.nombre_completo,
            "rol_id": usuario.rol_id,
            "nivel_acceso": usuario.nivel_acceso,
            "activo": usuario.activo,
            "ultimo_login": None,
            "created_at": datetime.now(UTC),
        },
    )


@router.post("/2fa/setup", response_model=Setup2FAResponse)
async def setup_2fa(current_user: AuthUser):
    """Genera un nuevo secret TOTP y devuelve el QR para configurar el autenticador."""
    secret = generate_totp_secret()
    qr_bytes = generate_totp_qr(secret, current_user.username)
    qr_b64 = base64.b64encode(qr_bytes).decode()

    # Guardar el secret en BD (aún no activo — se activa al verificar)
    async with AsyncSessionLocal() as db:
        await db.execute(
            text("UPDATE auth.usuarios SET totp_secret = :s WHERE id = :uid"),
            {"s": secret, "uid": current_user.id},
        )
        await db.commit()

    return Setup2FAResponse(qr_image_b64=qr_b64, secret=secret)


@router.post("/2fa/verify", response_model=SuccessResponse)
async def verify_2fa(body: Verify2FARequest, current_user: AuthUser):
    """Verifica el código TOTP y activa el 2FA definitivamente."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            text("SELECT totp_secret FROM auth.usuarios WHERE id = :uid"),
            {"uid": current_user.id},
        )
        row = result.fetchone()

    if not row or not row.totp_secret:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Primero configura el 2FA con /auth/2fa/setup",
        )

    if not verify_totp(row.totp_secret, body.code):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Código incorrecto",
        )

    async with AsyncSessionLocal() as db:
        await db.execute(
            text("""
                UPDATE auth.usuarios
                SET totp_activo = TRUE, totp_verificado_at = NOW()
                WHERE id = :uid
            """),
            {"uid": current_user.id},
        )
        await db.commit()

    return SuccessResponse(message="2FA activado correctamente")


@router.delete("/2fa", response_model=SuccessResponse)
async def disable_2fa(body: Verify2FARequest, current_user: AuthUser):
    """Desactiva el 2FA. Requiere el código actual para confirmar."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            text("SELECT totp_secret FROM auth.usuarios WHERE id = :uid"),
            {"uid": current_user.id},
        )
        row = result.fetchone()

    if not row or not row.totp_secret:
        raise HTTPException(status_code=400, detail="2FA no está activo")

    if not verify_totp(row.totp_secret, body.code):
        raise HTTPException(status_code=400, detail="Código incorrecto")

    async with AsyncSessionLocal() as db:
        await db.execute(
            text("""
                UPDATE auth.usuarios
                SET totp_activo = FALSE, totp_secret = NULL, totp_verificado_at = NULL
                WHERE id = :uid
            """),
            {"uid": current_user.id},
        )
        await db.commit()

    return SuccessResponse(message="2FA desactivado")


@router.post("/change-password", response_model=SuccessResponse)
async def change_password(body: ChangePasswordRequest, current_user: AuthUser):
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            text("SELECT password_hash FROM auth.usuarios WHERE id = :uid"),
            {"uid": current_user.id},
        )
        row = result.fetchone()

    if not verify_password(body.current_password, row.password_hash):
        raise HTTPException(status_code=400, detail="Contraseña actual incorrecta")

    async with AsyncSessionLocal() as db:
        await db.execute(
            text("UPDATE auth.usuarios SET password_hash = :h WHERE id = :uid"),
            {"h": hash_password(body.new_password), "uid": current_user.id},
        )
        await db.commit()

    # Invalidar todas las sesiones activas
    redis = get_redis_sessions()
    keys = await redis.keys(f"session:{current_user.id}:*")
    if keys:
        await redis.delete(*keys)

    return SuccessResponse(message="Contraseña cambiada. Vuelve a iniciar sesión.")


# ── HELPER ────────────────────────────────────────────────────

async def _log_acceso(
    usuario_id: str,
    accion: str,
    ip: str | None = None,
    exito: bool = True,
    razon: str | None = None,
):
    """Registra el acceso en la tabla de auditoría."""
    try:
        async with AsyncSessionLocal() as db:
            await db.execute(
                text("""
                    INSERT INTO audit.log_accesos
                        (usuario_id, accion, ip_address, exito, razon_fallo)
                    VALUES (:uid, :accion, :ip, :exito, :razon)
                """),
                {
                    "uid": usuario_id,
                    "accion": accion,
                    "ip": ip,
                    "exito": exito,
                    "razon": razon,
                },
            )
            await db.commit()
    except Exception:
        pass
