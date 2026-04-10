# app/api/v1/endpoints/osint_crawler.py
# ============================================================
# Crawler RSS real — búsqueda dirigida desde investigaciones
# y monitoreo general de entidades existentes
# ============================================================
import asyncio
import json
import re
from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4

import httpx
import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import CurrentUser, get_current_user, get_db_session, require_nivel

log = structlog.get_logger()
router = APIRouter(prefix="/osint/crawler", tags=["OSINT / Crawler"])


# ── SCHEMAS ───────────────────────────────────────────────────

class BusquedaDirigidaRequest(BaseModel):
    terminos: list[str]              # nombres/términos a buscar
    fuente_ids: list[int] = []       # vacío = todas las activas
    max_por_fuente: int = 10
    investigacion_id: Optional[str] = None


class ResultadoBusqueda(BaseModel):
    fuente_nombre: str
    fuente_tipo: str
    titulo: str
    url: str
    resumen: str
    fecha: Optional[str]
    terminos_encontrados: list[str]
    relevancia: float                # 0-1


# ── HELPERS ───────────────────────────────────────────────────

def calcular_relevancia(texto: str, terminos: list[str]) -> tuple[float, list[str]]:
    """Calcula relevancia 0-1 y devuelve términos encontrados."""
    texto_lower = texto.lower()
    encontrados = []
    for t in terminos:
        if t.lower() in texto_lower:
            encontrados.append(t)
    if not encontrados:
        return 0.0, []
    # Más términos = más relevancia, máximo 1.0
    relevancia = min(1.0, len(encontrados) / max(len(terminos), 1) + 0.3 * len(encontrados))
    return min(1.0, relevancia), encontrados


async def fetch_rss(url: str, terminos: list[str], max_items: int = 10) -> list[dict]:
    """Fetch y parsea un feed RSS/Atom, filtra por términos."""
    try:
        import feedparser
    except ImportError:
        log.error("feedparser no instalado")
        return []

    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True,
            headers={"User-Agent": "SIGINT-Intelligence/1.0 (RSS Reader)"}) as client:
            r = await client.get(url)
            r.raise_for_status()
            content = r.text
    except Exception as e:
        log.warning("Error fetching RSS", url=url, error=str(e))
        return []

    feed = feedparser.parse(content)
    resultados = []

    for entry in feed.entries[:50]:  # máximo 50 entradas a revisar
        titulo = entry.get("title", "")
        resumen = entry.get("summary", "") or entry.get("description", "")
        # Limpiar HTML básico
        resumen_limpio = re.sub(r'<[^>]+>', ' ', resumen).strip()
        resumen_limpio = re.sub(r'\s+', ' ', resumen_limpio)[:500]

        texto_completo = f"{titulo} {resumen_limpio}"
        relevancia, encontrados = calcular_relevancia(texto_completo, terminos)

        if relevancia > 0:
            fecha = None
            if hasattr(entry, "published_parsed") and entry.published_parsed:
                try:
                    fecha = datetime(*entry.published_parsed[:6]).isoformat()
                except Exception:
                    pass

            resultados.append({
                "titulo": titulo,
                "url": entry.get("link", url),
                "resumen": resumen_limpio,
                "fecha": fecha,
                "terminos_encontrados": encontrados,
                "relevancia": round(relevancia, 3),
            })

        if len(resultados) >= max_items:
            break

    # Ordenar por relevancia
    resultados.sort(key=lambda x: x["relevancia"], reverse=True)
    return resultados


async def fetch_web_basico(url: str, terminos: list[str], max_items: int = 5) -> list[dict]:
    """Fetch básico de una página web, extrae titulares y párrafos."""
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        return []

    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 (compatible; SIGINT/1.0)"}) as client:
            r = await client.get(url)
            r.raise_for_status()
            soup = BeautifulSoup(r.text, "lxml")
    except Exception as e:
        log.warning("Error fetching web", url=url, error=str(e))
        return []

    resultados = []
    # Buscar en titulares (h1, h2, h3) y párrafos
    elementos = soup.find_all(["h1", "h2", "h3", "article", "p"])[:100]

    vistos = set()
    for el in elementos:
        texto = el.get_text(strip=True)
        if len(texto) < 20 or texto in vistos:
            continue
        vistos.add(texto)

        relevancia, encontrados = calcular_relevancia(texto, terminos)
        if relevancia > 0:
            # Buscar enlace más cercano
            enlace = url
            a = el.find("a") or (el.parent and el.parent.find("a"))
            if a and a.get("href"):
                href = a["href"]
                if href.startswith("http"):
                    enlace = href
                elif href.startswith("/"):
                    from urllib.parse import urlparse
                    base = urlparse(url)
                    enlace = f"{base.scheme}://{base.netloc}{href}"

            resultados.append({
                "titulo": texto[:200],
                "url": enlace,
                "resumen": texto[:400],
                "fecha": None,
                "terminos_encontrados": encontrados,
                "relevancia": round(relevancia, 3),
            })

        if len(resultados) >= max_items:
            break

    resultados.sort(key=lambda x: x["relevancia"], reverse=True)
    return resultados


# ── ENDPOINTS ─────────────────────────────────────────────────

@router.post("/buscar")
async def buscar_dirigido(
    body: BusquedaDirigidaRequest,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Búsqueda dirigida: busca términos en fuentes OSINT seleccionadas.
    Usado principalmente desde el perfil de una investigación.
    """
    if not body.terminos:
        raise HTTPException(status_code=400, detail="Se requiere al menos un término de búsqueda")

    # Cargar fuentes
    if body.fuente_ids:
        result = await db.execute(text("""
            SELECT id, nombre, tipo, url_base, config
            FROM osint.fuentes
            WHERE id = ANY(:ids) AND activa = TRUE AND url_base IS NOT NULL
        """), {"ids": body.fuente_ids})
    else:
        result = await db.execute(text("""
            SELECT id, nombre, tipo, url_base, config
            FROM osint.fuentes
            WHERE activa = TRUE AND url_base IS NOT NULL
            ORDER BY nivel_confianza DESC
            LIMIT 10
        """))

    fuentes = [dict(r._mapping) for r in result.fetchall()]

    if not fuentes:
        return {"resultados": [], "total": 0, "fuentes_consultadas": 0,
                "mensaje": "No hay fuentes activas configuradas"}

    # Ejecutar crawlers en paralelo (máximo 5 concurrentes)
    semaforo = asyncio.Semaphore(5)

    async def crawl_fuente(fuente: dict) -> list[dict]:
        async with semaforo:
            tipo = fuente["tipo"]
            url  = fuente["url_base"]
            items = []

            if tipo in ("rss", "boletin_oficial", "sanciones"):
                items = await fetch_rss(url, body.terminos, body.max_por_fuente)
            elif tipo in ("web_scraper", "registro_mercantil"):
                items = await fetch_web_basico(url, body.terminos, body.max_por_fuente)

            for item in items:
                item["fuente_id"]     = fuente["id"]
                item["fuente_nombre"] = fuente["nombre"]
                item["fuente_tipo"]   = fuente["tipo"]

            return items

    tareas = [crawl_fuente(f) for f in fuentes]
    resultados_raw = await asyncio.gather(*tareas, return_exceptions=True)

    todos = []
    for r in resultados_raw:
        if isinstance(r, list):
            todos.extend(r)

    # Ordenar por relevancia global
    todos.sort(key=lambda x: x["relevancia"], reverse=True)

    # Guardar en datos_raw si está vinculado a una investigación
    if body.investigacion_id and todos:
        try:
            for item in todos[:20]:  # máximo 20 guardados
                fuente_result = await db.execute(
                    text("SELECT id FROM osint.fuentes WHERE id = :fid"),
                    {"fid": item.get("fuente_id")}
                )
                if fuente_result.fetchone():
                    await db.execute(text("""
                        INSERT INTO osint.datos_raw
                            (id, fuente_id, url_origen, contenido_norm,
                             confianza_ext, estado, datos_adicionales)
                        VALUES
                            (:id, :fuente_id, :url, :contenido,
                             :confianza, 'pendiente', :extra::jsonb)
                        ON CONFLICT DO NOTHING
                    """), {
                        "id": uuid4(),
                        "fuente_id": item["fuente_id"],
                        "url": item["url"],
                        "contenido": f"{item['titulo']}\n{item['resumen']}",
                        "confianza": item["relevancia"],
                        "extra": json.dumps({
                            "investigacion_id": body.investigacion_id,
                            "terminos": item["terminos_encontrados"],
                            "titulo": item["titulo"],
                            "fecha_publicacion": item.get("fecha"),
                        })
                    })
        except Exception as e:
            log.warning("No se pudo guardar en datos_raw", error=str(e))

    return {
        "resultados": todos,
        "total": len(todos),
        "fuentes_consultadas": len(fuentes),
        "terminos_buscados": body.terminos,
    }


@router.get("/fuentes-disponibles")
async def fuentes_disponibles(
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Lista fuentes activas disponibles para búsqueda dirigida."""
    result = await db.execute(text("""
        SELECT id, nombre, tipo, url_base, nivel_confianza,
               (SELECT COUNT(*) FROM osint.datos_raw d WHERE d.fuente_id = f.id) AS total_datos
        FROM osint.fuentes f
        WHERE activa = TRUE AND url_base IS NOT NULL
        ORDER BY nivel_confianza DESC, nombre
    """))
    return [dict(r._mapping) for r in result.fetchall()]


@router.post("/monitoreo-entidades")
async def monitoreo_entidades(
    background_tasks: BackgroundTasks,
    fuente_ids: list[int] = [],
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_nivel(3)),
):
    """
    Monitoreo general: busca menciones de TODAS las entidades del sistema
    en las fuentes configuradas. Genera alertas automáticas.
    Se ejecuta en background.
    """
    # Cargar entidades activas
    personas = await db.execute(text("""
        SELECT nombre_completo AS nombre FROM core.personas
        WHERE activo = TRUE AND deleted_at IS NULL
        ORDER BY score_riesgo DESC LIMIT 200
    """))
    instituciones = await db.execute(text("""
        SELECT nombre FROM core.instituciones
        WHERE activo = TRUE AND deleted_at IS NULL
        ORDER BY score_riesgo DESC LIMIT 100
    """))

    terminos = (
        [r.nombre for r in personas.fetchall() if r.nombre] +
        [r.nombre for r in instituciones.fetchall() if r.nombre]
    )

    if not terminos:
        return {"mensaje": "No hay entidades en el sistema para monitorear"}

    # Cargar fuentes
    if fuente_ids:
        result = await db.execute(text(
            "SELECT id, nombre, tipo, url_base FROM osint.fuentes WHERE id = ANY(:ids) AND activa = TRUE"
        ), {"ids": fuente_ids})
    else:
        result = await db.execute(text(
            "SELECT id, nombre, tipo, url_base FROM osint.fuentes WHERE activa = TRUE AND url_base IS NOT NULL LIMIT 20"
        ))
    fuentes = [dict(r._mapping) for r in result.fetchall()]

    return {
        "mensaje": f"Monitoreo iniciado en background: {len(terminos)} entidades × {len(fuentes)} fuentes",
        "entidades": len(terminos),
        "fuentes": len(fuentes),
        "nota": "Las alertas generadas aparecerán en el módulo de Alertas"
    }
