# app/core/security.py
# ============================================================
# JWT, bcrypt, 2FA TOTP, y utilidades de seguridad
# ============================================================
import io
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

import pyotp
import qrcode
from jose import JWTError, jwt
import bcrypt as _bcrypt

from app.core.config import settings

# ── CONTRASEÑAS ───────────────────────────────────────────────



def hash_password(password: str) -> str:
    return _bcrypt.hashpw(password.encode(), _bcrypt.gensalt(rounds=12)).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return _bcrypt.checkpw(plain.encode(), hashed.encode())


def check_password_strength(password: str) -> tuple[bool, str]:
    """Valida que la contraseña cumpla los requisitos mínimos."""
    if len(password) < 12:
        return False, "La contraseña debe tener al menos 12 caracteres"
    if not any(c.isupper() for c in password):
        return False, "Debe contener al menos una mayúscula"
    if not any(c.islower() for c in password):
        return False, "Debe contener al menos una minúscula"
    if not any(c.isdigit() for c in password):
        return False, "Debe contener al menos un número"
    if not any(c in "!@#$%^&*()_+-=[]{}|;:,.<>?" for c in password):
        return False, "Debe contener al menos un carácter especial"
    return True, "OK"


# ── JWT ───────────────────────────────────────────────────────

def create_access_token(
    data: dict[str, Any],
    expires_delta: timedelta | None = None,
) -> str:
    to_encode = data.copy()
    expire = datetime.now(UTC) + (
        expires_delta or timedelta(minutes=settings.JWT_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire, "type": "access"})
    return jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    expire = datetime.now(UTC) + timedelta(days=settings.JWT_REFRESH_EXPIRE_DAYS)
    return jwt.encode(
        {"sub": user_id, "exp": expire, "type": "refresh"},
        settings.JWT_SECRET,
        algorithm=settings.JWT_ALGORITHM,
    )


def decode_token(token: str) -> dict[str, Any]:
    """Decodifica y valida un JWT. Lanza JWTError si inválido."""
    return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])


def verify_token_type(payload: dict, expected_type: str) -> bool:
    return payload.get("type") == expected_type


# ── 2FA TOTP ──────────────────────────────────────────────────

def generate_totp_secret() -> str:
    """Genera un secret TOTP aleatorio."""
    return pyotp.random_base32()


def get_totp_uri(secret: str, username: str) -> str:
    """URI para configurar el autenticador (Google Authenticator, Authy, etc.)."""
    return pyotp.totp.TOTP(secret).provisioning_uri(
        name=username,
        issuer_name=settings.APP_NAME,
    )


def generate_totp_qr(secret: str, username: str) -> bytes:
    """Genera un PNG con el QR para configurar 2FA."""
    uri = get_totp_uri(secret, username)
    qr = qrcode.QRCode(version=1, box_size=10, border=4)
    qr.add_data(uri)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def verify_totp(secret: str, code: str) -> bool:
    """Verifica un código TOTP. Acepta ±1 ventana de 30s para clock drift."""
    totp = pyotp.TOTP(secret)
    return totp.verify(code, valid_window=1)


# ── TOKENS VARIOS ─────────────────────────────────────────────

def generate_reset_token() -> str:
    """Token seguro para reseteo de contraseña."""
    return secrets.token_urlsafe(32)


def generate_api_key() -> str:
    """API key para acceso programático."""
    return f"sk_{secrets.token_urlsafe(40)}"
