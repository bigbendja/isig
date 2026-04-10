from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.dependencies import CurrentUser, get_current_user, get_db_session, require_nivel
# app/api/v1/endpoints/ia.py
# ============================================================
# LLM Gateway — enruta peticiones al modelo correcto
# según el nivel de clasificación del dato
# ============================================================
import json
from uuid import UUID
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
import httpx
import structlog

from app.core.config import settings

log = structlog.get_logger()
router = APIRouter(prefix="/ia", tags=["Inteligencia Artificial"])


# ── SCHEMAS ───────────────────────────────────────────────────

class ChatRequest(BaseModel):
    mensaje: str
    contexto: str | None = None  # JSON del expediente si hay entidad activa


class AnalizarExpedienteRequest(BaseModel):
    entidad_tipo: str
    entidad_id: str
    instruccion: str | None = None


class ExtraerDocumentoRequest(BaseModel):
    contenido: str        # texto del documento a analizar
    nivel_acceso: int = 1


# ── HELPERS ───────────────────────────────────────────────────

def elegir_modelo(nivel_datos: int) -> tuple[str, str]:
    """
    Devuelve (proveedor, modelo) según el nivel de clasificación.
    Datos nivel 3+ solo van a modelos locales.
    """
    if nivel_datos > settings.AI_MAX_LEVEL_EXTERNAL_API:
        return ("ollama", settings.AI_LOCAL_MODEL_CLASSIFIED)

    # Preferir Ollama local siempre si está disponible
    return ("ollama", settings.OLLAMA_MODEL_DEFAULT)


async def llamar_ollama(modelo: str, messages: list[dict], stream: bool = False) -> str:
    """Llamada al servidor Ollama local."""
    async with httpx.AsyncClient(timeout=120) as client:
        try:
            r = await client.post(
                f"{settings.OLLAMA_BASE_URL}/api/chat",
                json={
                    "model": modelo,
                    "messages": messages,
                    "stream": False,
                    "options": {
                        "temperature": 0.3,
                        "num_predict": 2048,
                    }
                },
            )
            r.raise_for_status()
            data = r.json()
            return data.get("message", {}).get("content", "Sin respuesta")
        except httpx.ConnectError:
            raise HTTPException(
                status_code=503,
                detail="Ollama no está disponible. Asegúrate de que el servicio esté corriendo.",
            )
        except Exception as e:
            log.error("Error llamando a Ollama", error=str(e))
            raise HTTPException(status_code=500, detail=f"Error del modelo: {e}")


async def llamar_openai(modelo: str, messages: list[dict]) -> str:
    """Llamada a OpenAI API — solo para datos nivel 1-2."""
    if not settings.OPENAI_API_KEY:
        raise HTTPException(status_code=503, detail="OpenAI API key no configurada")

    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {settings.OPENAI_API_KEY}"},
            json={
                "model": modelo,
                "messages": messages,
                "temperature": 0.3,
                "max_tokens": 2048,
            }
        )
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"]


# ── ENDPOINTS ─────────────────────────────────────────────────

@router.post("/chat")
async def chat(
    body: ChatRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    """
    Chat general con el asistente.
    Si se incluye contexto, lo incorpora al prompt del sistema.
    """
    nivel_datos = 1  # chat general sin entidad = datos públicos

    system_prompt = f"""Eres un asistente de inteligencia especializado en el análisis de entidades
(personas e instituciones) para {settings.APP_NAME}.

Respondes en español, de forma concisa y profesional.
Cuando el analista pregunte sobre entidades, usas el contexto proporcionado.
No inventas información que no esté en el contexto.
Nivel de acceso del analista: {current_user.nivel_acceso}/5.

{"Contexto: " + body.contexto if body.contexto else "Sin contexto."}"""

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": body.mensaje},
    ]

    proveedor, modelo = elegir_modelo(nivel_datos)
    respuesta = await llamar_ollama(modelo, messages)

    # Registrar en auditoría
    try:
        await db.execute(
            __import__("sqlalchemy").text("""
                INSERT INTO audit.log_accesos (usuario_id, accion, datos_extra)
                VALUES (:uid, 'ai_chat', :extra::jsonb)
            """),
            {
                "uid": str(current_user.id),
                "extra": json.dumps({"modelo": modelo, "tokens_aprox": len(body.mensaje) // 4})
            }
        )
    except Exception:
        pass

    return {
        "respuesta": respuesta,
        "modelo": modelo,
        "proveedor": proveedor,
    }


@router.post("/analizar-expediente")
async def analizar_expediente(
    body: AnalizarExpedienteRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    """
    Analiza el expediente completo de una entidad.
    El nivel de clasificación del expediente determina el modelo a usar.
    """
    from sqlalchemy import text

    # Cargar expediente según tipo
    if body.entidad_tipo == "persona":
        result = await db.execute(
            text("SELECT * FROM core.v_personas WHERE id = :id"),
            {"id": body.entidad_id},
        )
    else:
        result = await db.execute(
            text("SELECT * FROM core.instituciones WHERE id = :id AND deleted_at IS NULL"),
            {"id": body.entidad_id},
        )

    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Entidad no encontrada")

    expediente = dict(row._mapping)
    nivel_datos = expediente.get("nivel_acceso_requerido", 1)

    # Verificar acceso
    if current_user.nivel_acceso < nivel_datos:
        raise HTTPException(status_code=403, detail="Sin nivel de acceso suficiente")

    # Filtrar campos sensibles según nivel del usuario
    if current_user.nivel_acceso < 3:
        for campo in ("patrimonio_est", "ingresos_anuales_est", "cuentas_bancarias"):
            expediente.pop(campo, None)
    if current_user.nivel_acceso < 4:
        expediente.pop("listas_externas", None)

    # Serializar expediente para el prompt
    expediente_str = json.dumps(
        {k: str(v) if v is not None else None for k, v in expediente.items()},
        ensure_ascii=False, indent=2
    )

    instruccion = body.instruccion or (
        "Genera un análisis de inteligencia completo incluyendo: "
        "1) Resumen ejecutivo del perfil, "
        "2) Factores de riesgo detectados, "
        "3) Patrones relevantes, "
        "4) Recomendaciones de seguimiento."
    )

    system_prompt = f"""Eres un analista de inteligencia experto.
Analiza el siguiente expediente y responde a la instrucción del analista.
Sé preciso, estructurado y profesional. Responde en español.
No inventes información que no esté en el expediente.
Nivel de clasificación del expediente: {nivel_datos}/5."""

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f"EXPEDIENTE:\n{expediente_str}\n\nINSTRUCCIÓN: {instruccion}"},
    ]

    # Elegir modelo según nivel del dato
    proveedor, modelo = elegir_modelo(nivel_datos)

    # Para análisis profundos, usar el modelo más capaz disponible
    if nivel_datos <= settings.AI_MAX_LEVEL_EXTERNAL_API:
        modelo = settings.OLLAMA_MODEL_ANALYSIS  # qwen2.5:14b si está disponible

    respuesta = await llamar_ollama(modelo, messages)

    # Guardar el análisis como nota en el expediente
    try:
        from uuid import uuid4
        await db.execute(
            text("""
                INSERT INTO intel.eventos
                    (id, entidad_tipo, entidad_id, tipo_evento, titulo,
                     descripcion, fuente, nivel_acceso, created_by)
                VALUES
                    (:id, :tipo, :eid, 'analisis_ia',
                     'Análisis IA generado', :desc, :modelo, :nivel, :uid)
            """),
            {
                "id": uuid4(),
                "tipo": body.entidad_tipo,
                "eid": body.entidad_id,
                "desc": respuesta[:500] + "..." if len(respuesta) > 500 else respuesta,
                "modelo": modelo,
                "nivel": nivel_datos,
                "uid": str(current_user.id),
            }
        )
    except Exception as e:
        log.warning("No se pudo guardar el análisis como evento", error=str(e))

    return {
        "analisis": respuesta,
        "modelo": modelo,
        "proveedor": proveedor,
        "nivel_datos": nivel_datos,
        "tokens_usados": len(expediente_str) // 4,  # estimación
    }


@router.post("/extraer-entidades")
async def extraer_entidades_documento(
    body: ExtraerDocumentoRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Extrae entidades (personas, empresas, lugares) de texto libre.
    Devuelve JSON estructurado con las entidades detectadas.
    """
    system_prompt = """Eres un extractor de entidades especializado en inteligencia.
Analiza el texto y extrae TODAS las entidades mencionadas.

Responde ÚNICAMENTE con JSON válido, sin texto adicional, en este formato:
{
  "personas": [
    {"nombre": "...", "cargo": "...", "organizacion": "...", "fecha": "...", "contexto": "..."}
  ],
  "instituciones": [
    {"nombre": "...", "tipo": "...", "pais": "...", "sector": "...", "contexto": "..."}
  ],
  "lugares": [
    {"nombre": "...", "tipo": "ciudad/pais/region", "contexto": "..."}
  ],
  "fechas_clave": ["..."],
  "relaciones_detectadas": [
    {"entidad_a": "...", "relacion": "...", "entidad_b": "..."}
  ],
  "resumen": "..."
}"""

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f"TEXTO A ANALIZAR:\n\n{body.contenido[:8000]}"},
    ]

    proveedor, modelo = elegir_modelo(body.nivel_acceso)
    # Para NER usar el modelo rápido
    modelo = settings.OLLAMA_MODEL_FAST

    respuesta_raw = await llamar_ollama(modelo, messages)

    # Parsear JSON de la respuesta
    try:
        # Limpiar posibles bloques de código markdown
        texto = respuesta_raw.strip()
        if texto.startswith("```"):
            texto = texto.split("```")[1]
            if texto.startswith("json"):
                texto = texto[4:]
        resultado = json.loads(texto.strip())
    except json.JSONDecodeError:
        log.warning("El modelo no devolvió JSON válido", raw=respuesta_raw[:200])
        resultado = {
            "error": "El modelo no generó JSON válido",
            "raw": respuesta_raw[:500],
            "personas": [], "instituciones": [], "lugares": [],
            "fechas_clave": [], "relaciones_detectadas": [], "resumen": "",
        }

    return {
        "resultado": resultado,
        "modelo": modelo,
        "longitud_texto": len(body.contenido),
    }


@router.get("/modelos-disponibles")
async def modelos_disponibles(current_user: CurrentUser = Depends(get_current_user)):
    """Lista los modelos LLM disponibles en Ollama."""
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            r = await client.get(f"{settings.OLLAMA_BASE_URL}/api/tags")
            r.raise_for_status()
            modelos = r.json().get("models", [])
            return {
                "ollama_disponible": True,
                "modelos": [
                    {
                        "nombre": m["name"],
                        "tamaño_gb": round(m.get("size", 0) / 1e9, 1),
                        "modificado": m.get("modified_at"),
                    }
                    for m in modelos
                ],
                "modelo_activo": settings.OLLAMA_MODEL_DEFAULT,
                "modelo_analisis": settings.OLLAMA_MODEL_ANALYSIS,
                "openai_configurado": bool(settings.OPENAI_API_KEY),
                "anthropic_configurado": bool(settings.ANTHROPIC_API_KEY),
                "nivel_max_api_externa": settings.AI_MAX_LEVEL_EXTERNAL_API,
            }
        except Exception:
            return {
                "ollama_disponible": False,
                "modelos": [],
                "openai_configurado": bool(settings.OPENAI_API_KEY),
                "anthropic_configurado": bool(settings.ANTHROPIC_API_KEY),
            }
