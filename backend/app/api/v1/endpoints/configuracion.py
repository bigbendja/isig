# app/api/v1/endpoints/configuracion.py
# ============================================================
# Configuración dinámica del sistema — almacenada en BD
# ============================================================
import json
import smtplib
from email.mime.text import MIMEText
from pathlib import Path
from uuid import uuid4

import structlog
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import CurrentUser, get_current_user, get_db_session, require_nivel
from app.schemas import SuccessResponse

log = structlog.get_logger()
router = APIRouter(prefix="/configuracion", tags=["Configuración"])

LOGO_DIR = Path("/app/uploads/logos")
LOGO_DIR.mkdir(parents=True, exist_ok=True)

# ── DEFAULTS ─────────────────────────────────────────────────
DEFAULTS: dict = {
    "general": {
        "nombre_sistema": "SIGINT DataCenter Pro",
        "nombre_organizacion": "GEPETROL SEGUROS, S.A.",
        "descripcion": "Plataforma de inteligencia corporativa",
        "pais": "GQ",
        "sector": "Seguros",
        "web": "",
        "email_contacto": "",
        "telefono": "",
        "logo_url": None,
    },
    "apariencia": {
        "color_primario": "#6366f1",
        "color_acento": "#8b5cf6",
        "modo_default": "dark",
        "nombre_en_sidebar": "SIGINT Pro",
    },
    "smtp": {
        "host": "",
        "puerto": 587,
        "usuario": "",
        "password": "",
        "tls": True,
        "email_remitente": "",
        "nombre_remitente": "SIGINT DataCenter Pro",
        "activo": False,
    },
    "seguridad": {
        "timeout_sesion_minutos": 480,
        "max_intentos_login": 5,
        "requerir_2fa_nivel": 4,
        "password_longitud_minima": 8,
        "password_caducidad_dias": 0,
        "bloqueo_ip_automatico": False,
    },
    "osint": {
        "nivel_max_api_externa": 2,
        "timeout_crawler_segundos": 20,
        "max_resultados_busqueda": 50,
        "respetar_robots_txt": True,
        "user_agent": "SIGINT-Intelligence/1.0",
    },
    "ia": {
        "ollama_url": "http://host.docker.internal:1234",
        "modelo_default": "qwen2.5:7b",
        "modelo_analisis": "qwen2.5:14b",
        "modelo_rapido": "mistral:7b",
        "nivel_max_api_externa": 2,
        "temperatura": 0.3,
        "max_tokens": 2048,
        "openai_api_key": "",
        "anthropic_api_key": "",
    },
    "notificaciones": {
        "alertas_criticas_email": False,
        "resumen_diario": False,
        "resumen_hora": "08:00",
        "umbral_score_alerta": 0.75,
        "email_destino_alertas": "",
    },
}


async def ensure_config_table(db: AsyncSession):
    await db.execute(text("""
        CREATE TABLE IF NOT EXISTS core.configuracion (
            seccion     VARCHAR(50) PRIMARY KEY,
            datos       JSONB NOT NULL DEFAULT '{}',
            updated_at  TIMESTAMPTZ DEFAULT NOW(),
            updated_by  UUID
        )
    """))


async def get_seccion(db: AsyncSession, seccion: str) -> dict:
    await ensure_config_table(db)
    result = await db.execute(
        text("SELECT datos FROM core.configuracion WHERE seccion = :s"),
        {"s": seccion}
    )
    row = result.fetchone()
    defaults = DEFAULTS.get(seccion, {})
    if not row:
        return defaults.copy()
    # Merge with defaults (defaults fill missing keys)
    merged = defaults.copy()
    merged.update(row.datos or {})
    return merged


# ── ENDPOINTS ─────────────────────────────────────────────────

@router.get("")
async def obtener_toda_configuracion(
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_nivel(4)),
):
    """Devuelve toda la configuración organizada por secciones."""
    result = {}
    for seccion in DEFAULTS.keys():
        result[seccion] = await get_seccion(db, seccion)
    return result


@router.get("/publica")
async def configuracion_publica(
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Configuración pública — apariencia y nombre del sistema."""
    apariencia = await get_seccion(db, "apariencia")
    general    = await get_seccion(db, "general")
    return {
        "nombre_sistema":       general.get("nombre_sistema"),
        "nombre_organizacion":  general.get("nombre_organizacion"),
        "logo_url":             general.get("logo_url"),
        "color_primario":       apariencia.get("color_primario"),
        "color_acento":         apariencia.get("color_acento"),
        "modo_default":         apariencia.get("modo_default"),
        "nombre_en_sidebar":    apariencia.get("nombre_en_sidebar"),
    }


@router.get("/{seccion}")
async def obtener_seccion(
    seccion: str,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_nivel(4)),
):
    if seccion not in DEFAULTS:
        raise HTTPException(status_code=404, detail=f"Sección '{seccion}' no existe")
    data = await get_seccion(db, seccion)
    # Hide sensitive fields for non-root
    if seccion == "smtp" and current_user.nivel_acceso < 5:
        data = {k: ("***" if k == "password" and v else v) for k, v in data.items()}
    if seccion == "ia" and current_user.nivel_acceso < 5:
        data = {k: ("***" if "api_key" in k and v else v) for k, v in data.items()}
    return data


@router.patch("/{seccion}")
async def actualizar_seccion(
    seccion: str,
    body: dict,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_nivel(4)),
):
    if seccion not in DEFAULTS:
        raise HTTPException(status_code=404, detail=f"Sección '{seccion}' no existe")

    await ensure_config_table(db)
    current = await get_seccion(db, seccion)

    # Don't overwrite passwords with placeholder
    for k, v in body.items():
        if isinstance(v, str) and v == "***":
            body[k] = current.get(k, "")

    updated = {**current, **body}

    await db.execute(text("""
        INSERT INTO core.configuracion (seccion, datos, updated_at, updated_by)
        VALUES (:s, CAST(:d AS jsonb), NOW(), :uid)
        ON CONFLICT (seccion) DO UPDATE
        SET datos = CAST(:d AS jsonb), updated_at = NOW(), updated_by = :uid
    """), {"s": seccion, "d": json.dumps(updated), "uid": str(current_user.id)})

    return updated


@router.post("/smtp/test")
async def test_smtp(
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_nivel(4)),
):
    """Envía un email de prueba con la configuración SMTP actual."""
    smtp_cfg = await get_seccion(db, "smtp")

    if not smtp_cfg.get("host") or not smtp_cfg.get("activo"):
        raise HTTPException(status_code=400, detail="SMTP no configurado o inactivo")

    try:
        msg = MIMEText(f"Email de prueba desde SIGINT DataCenter Pro.\nUsuario: {current_user.username}")
        msg["Subject"] = "✓ SIGINT — Prueba de email"
        msg["From"]    = f"{smtp_cfg['nombre_remitente']} <{smtp_cfg['email_remitente']}>"
        msg["To"]      = current_user.email

        if smtp_cfg.get("tls"):
            server = smtplib.SMTP(smtp_cfg["host"], int(smtp_cfg["puerto"]))
            server.starttls()
        else:
            server = smtplib.SMTP_SSL(smtp_cfg["host"], int(smtp_cfg["puerto"]))

        if smtp_cfg.get("usuario") and smtp_cfg.get("password"):
            server.login(smtp_cfg["usuario"], smtp_cfg["password"])

        server.send_message(msg)
        server.quit()
        return {"ok": True, "mensaje": f"Email enviado a {current_user.email}"}

    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error SMTP: {str(e)}")


@router.post("/logo")
async def subir_logo(
    archivo: UploadFile = File(...),
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_nivel(4)),
):
    """Sube el logo de la organización."""
    if not archivo.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Solo se permiten imágenes")

    contenido = await archivo.read()
    if len(contenido) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Logo demasiado grande (máx. 5MB)")

    ext = Path(archivo.filename or "logo.png").suffix.lower()
    filename = f"logo_{uuid4().hex[:8]}{ext}"
    path = LOGO_DIR / filename

    with open(path, "wb") as f:
        f.write(contenido)

    logo_url = f"/api/v1/configuracion/logo/{filename}"

    # Save URL in general config
    general = await get_seccion(db, "general")
    general["logo_url"] = logo_url
    await db.execute(text("""
        INSERT INTO core.configuracion (seccion, datos, updated_at, updated_by)
        VALUES ('general', CAST(:d AS jsonb), NOW(), :uid)
        ON CONFLICT (seccion) DO UPDATE
        SET datos = CAST(:d AS jsonb), updated_at = NOW(), updated_by = :uid
    """), {"d": json.dumps(general), "uid": str(current_user.id)})

    return {"logo_url": logo_url}
