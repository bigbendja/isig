# app/core/encryption.py
# ============================================================
# Cifrado AES-256-GCM para campos sensibles
# Campos cifrados: cuentas_bancarias, totp_secret, config de fuentes OSINT
# El cifrado se aplica a nivel de aplicación ANTES de llegar a la BD
# ============================================================
import base64
import json
import os
import secrets
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core.config import settings


# ── CLAVE DE CIFRADO ──────────────────────────────────────────
# Se deriva de SECRET_KEY — en producción usar una clave dedicada
# almacenada en un gestor de secretos (Vault, AWS Secrets Manager)

def _derive_key() -> bytes:
    """Deriva una clave AES-256 (32 bytes) desde el SECRET_KEY configurado."""
    import hashlib
    key_material = settings.SECRET_KEY.encode('utf-8')
    # SHA-256 del SECRET_KEY como clave AES
    return hashlib.sha256(key_material).digest()


_ENCRYPTION_KEY = _derive_key()
_AES = AESGCM(_ENCRYPTION_KEY)


# ── FUNCIONES PRINCIPALES ─────────────────────────────────────

def encrypt_field(plaintext: str | dict | Any) -> str:
    """
    Cifra un valor con AES-256-GCM.
    Devuelve una cadena base64 con formato: nonce|ciphertext
    """
    if plaintext is None:
        return None

    # Serializar si es dict/list
    if isinstance(plaintext, (dict, list)):
        text_bytes = json.dumps(plaintext, ensure_ascii=False).encode('utf-8')
    else:
        text_bytes = str(plaintext).encode('utf-8')

    # Nonce aleatorio de 12 bytes (recomendado para GCM)
    nonce = secrets.token_bytes(12)

    # Cifrar
    ciphertext = _AES.encrypt(nonce, text_bytes, associated_data=None)

    # Empaquetar: base64(nonce) + "." + base64(ciphertext)
    return (
        base64.b64encode(nonce).decode('ascii') +
        '.' +
        base64.b64encode(ciphertext).decode('ascii')
    )


def decrypt_field(encrypted: str) -> str | None:
    """
    Descifra un valor cifrado con encrypt_field.
    Devuelve None si el campo está vacío o si falla el descifrado.
    """
    if not encrypted:
        return None

    try:
        nonce_b64, cipher_b64 = encrypted.split('.', 1)
        nonce      = base64.b64decode(nonce_b64)
        ciphertext = base64.b64decode(cipher_b64)
        plaintext  = _AES.decrypt(nonce, ciphertext, associated_data=None)
        return plaintext.decode('utf-8')
    except Exception:
        # Si falla (campo no cifrado, clave incorrecta, etc.)
        return None


def decrypt_json_field(encrypted: str) -> dict | list | None:
    """Descifra un campo que originalmente era JSON."""
    text = decrypt_field(encrypted)
    if text is None:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text  # Devolver como string si no es JSON válido


def is_encrypted(value: str) -> bool:
    """Verifica si un valor tiene el formato de campo cifrado."""
    if not isinstance(value, str):
        return False
    parts = value.split('.', 1)
    if len(parts) != 2:
        return False
    try:
        base64.b64decode(parts[0])
        base64.b64decode(parts[1])
        return len(base64.b64decode(parts[0])) == 12  # nonce de 12 bytes
    except Exception:
        return False


# ── CAMPOS QUE SE CIFRAN AUTOMÁTICAMENTE ─────────────────────

# Estos campos se cifran al escribir y se descifran al leer
CAMPOS_CIFRADOS = {
    'auth.usuarios':        ['totp_secret'],
    'core.personas':        ['cuentas_bancarias'],   # dentro de perfil_extendido
    'core.instituciones':   ['cuentas_bancarias_corp'],
    'osint.fuentes':        ['config'],              # credenciales de scrapers
}


# ── HELPER PARA RUTAS DE API ──────────────────────────────────

def cifrar_datos_sensibles(datos: dict, tabla: str) -> dict:
    """
    Cifra los campos sensibles de un dict antes de enviarlo a la BD.
    Usar en los endpoints antes de INSERT/UPDATE.
    """
    campos = CAMPOS_CIFRADOS.get(tabla, [])
    resultado = dict(datos)
    for campo in campos:
        if campo in resultado and resultado[campo] is not None:
            resultado[campo] = encrypt_field(resultado[campo])
    return resultado


def descifrar_datos_sensibles(datos: dict, tabla: str) -> dict:
    """
    Descifra los campos sensibles de un dict leído de la BD.
    Usar en los endpoints después de SELECT.
    """
    campos = CAMPOS_CIFRADOS.get(tabla, [])
    resultado = dict(datos)
    for campo in campos:
        if campo in resultado and resultado[campo]:
            descifrado = decrypt_json_field(resultado[campo])
            resultado[campo] = descifrado if descifrado is not None else resultado[campo]
    return resultado
