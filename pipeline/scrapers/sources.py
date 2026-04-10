# pipeline/scrapers/sources.py
# ============================================================
# Scrapers concretos para las principales fuentes OSINT
# ============================================================
import json
from typing import AsyncIterator

import feedparser
import httpx
import structlog
from bs4 import BeautifulSoup

from pipeline.scrapers.base import BaseScraper, ItemScrapeado
from pipeline.core.config import config

log = structlog.get_logger()


# ── 1. RSS / NOTICIAS ─────────────────────────────────────────

class RSSNewsScraper(BaseScraper):
    """
    Scraper de feeds RSS — agencias de noticias, boletines, medios locales.
    Compatible con cualquier feed RSS/Atom estándar.
    """
    nombre = "RSS News Scraper"

    def __init__(self, fuente_id: int, feed_url: str, **kwargs):
        super().__init__(fuente_id, rate_limit_rpm=30, **kwargs)
        self.feed_url = feed_url

    async def ejecutar(self) -> AsyncIterator[ItemScrapeado]:
        self.log.info("Iniciando scraper RSS", url=self.feed_url)
        try:
            r = await self._get(self.feed_url)
            feed = feedparser.parse(r.text)

            for entry in feed.entries:
                # Extraer contenido limpio
                contenido = ''
                if hasattr(entry, 'content'):
                    contenido = entry.content[0].get('value', '')
                elif hasattr(entry, 'summary'):
                    contenido = entry.summary

                # Limpiar HTML del contenido
                if contenido:
                    soup = BeautifulSoup(contenido, 'lxml')
                    contenido = soup.get_text(separator=' ', strip=True)

                yield ItemScrapeado(
                    url=getattr(entry, 'link', self.feed_url),
                    titulo=getattr(entry, 'title', ''),
                    contenido=contenido[:3000],
                    fecha=getattr(entry, 'published', ''),
                    autor=getattr(entry, 'author', ''),
                    confianza=0.75,
                    metadatos={
                        'feed_title': feed.feed.get('title', ''),
                        'feed_url': self.feed_url,
                    },
                )
        except Exception as e:
            self.log.error("Error en RSS scraper", error=str(e), url=self.feed_url)


# ── 2. SCRAPER WEB GENÉRICO ───────────────────────────────────

class WebScraper(BaseScraper):
    """
    Scraper web genérico para páginas HTML estáticas.
    Para páginas con JavaScript usar PlaywrightScraper.
    """
    nombre = "Generic Web Scraper"

    def __init__(
        self,
        fuente_id: int,
        urls: list[str],
        selector_titulo: str = 'h1',
        selector_contenido: str = 'article, main, .content, #content',
        **kwargs,
    ):
        super().__init__(fuente_id, **kwargs)
        self.urls = urls
        self.selector_titulo = selector_titulo
        self.selector_contenido = selector_contenido

    async def ejecutar(self) -> AsyncIterator[ItemScrapeado]:
        for url in self.urls:
            try:
                r = await self._get(url)
                soup = BeautifulSoup(r.text, 'lxml')

                titulo_tag = soup.select_one(self.selector_titulo)
                titulo = titulo_tag.get_text(strip=True) if titulo_tag else ''

                contenido_tag = soup.select_one(self.selector_contenido)
                if not contenido_tag:
                    contenido_tag = soup.find('body')
                contenido = contenido_tag.get_text(separator=' ', strip=True)[:4000] if contenido_tag else ''

                yield ItemScrapeado(
                    url=url,
                    titulo=titulo,
                    contenido=contenido,
                    confianza=0.7,
                )
            except Exception as e:
                self.log.warning("Error scrapeando URL", url=url, error=str(e))


# ── 3. OPEN SANCTIONS ─────────────────────────────────────────

class OpenSanctionsScraper(BaseScraper):
    """
    Descarga y procesa listas de sanciones de OpenSanctions.
    https://www.opensanctions.org/docs/api/
    Actualizar periódicamente (diario o semanal).
    """
    nombre = "OpenSanctions"
    BASE_URL = "https://api.opensanctions.org/v3"

    def __init__(self, fuente_id: int, **kwargs):
        super().__init__(fuente_id, rate_limit_rpm=20, **kwargs)
        self.api_key = config.opensanctions_api_key

    async def ejecutar(self) -> AsyncIterator[ItemScrapeado]:
        if not self.api_key:
            self.log.warning("OpenSanctions API key no configurada — usando descarga pública")
            # Fallback: descarga directa del dataset público
            async for item in self._descargar_dataset_publico():
                yield item
            return

        headers = {"Authorization": f"ApiKey {self.api_key}"}
        # Buscar entidades marcadas como sanciones
        offset = 0
        limit  = 100

        while True:
            try:
                r = await self._get(
                    f"{self.BASE_URL}/entities/",
                    headers=headers,
                    params={
                        "schema": "Person",
                        "topics": "sanction",
                        "limit": limit,
                        "offset": offset,
                    }
                )
                data = r.json()
                resultados = data.get("results", [])
                if not resultados:
                    break

                for entidad in resultados:
                    nombres = entidad.get("properties", {}).get("name", [])
                    fuentes = [d.get("name", "") for d in entidad.get("datasets", [])]

                    yield ItemScrapeado(
                        url=f"https://www.opensanctions.org/entities/{entidad.get('id','')}/",
                        titulo=nombres[0] if nombres else "Desconocido",
                        contenido=json.dumps(entidad, ensure_ascii=False),
                        confianza=0.95,
                        metadatos={
                            "tipo": "sancion",
                            "id_externo": entidad.get("id"),
                            "nombres": nombres,
                            "listas": fuentes,
                            "schema": entidad.get("schema"),
                        },
                    )

                offset += limit
                if offset >= data.get("total", 0):
                    break

            except Exception as e:
                self.log.error("Error OpenSanctions API", error=str(e))
                break

    async def _descargar_dataset_publico(self) -> AsyncIterator[ItemScrapeado]:
        """Descarga el dataset OFAC público (sin API key)."""
        # OFAC Specially Designated Nationals List — versión pública
        url = "https://www.treasury.gov/ofac/downloads/sdn.xml"
        try:
            r = await self._get(url)
            soup = BeautifulSoup(r.text, 'xml')
            for entry in soup.find_all('sdnEntry')[:500]:  # primeros 500
                nombre = entry.find('lastName')
                if nombre:
                    yield ItemScrapeado(
                        url=url,
                        titulo=nombre.get_text(strip=True),
                        contenido='',
                        confianza=0.98,
                        metadatos={'tipo': 'sancion', 'lista': 'OFAC-SDN'},
                    )
        except Exception as e:
            self.log.error("Error descargando OFAC", error=str(e))


# ── 4. OPENCORPORATES ─────────────────────────────────────────

class OpenCorporatesScraper(BaseScraper):
    """
    Busca información de empresas en OpenCorporates.
    https://api.opencorporates.com/documentation/API-Reference
    """
    nombre = "OpenCorporates"
    BASE_URL = "https://api.opencorporates.com/v0.4"

    def __init__(self, fuente_id: int, terminos_busqueda: list[str], **kwargs):
        super().__init__(fuente_id, rate_limit_rpm=10, **kwargs)
        self.terminos = terminos_busqueda
        self.api_key  = config.opencorporates_api_key

    async def ejecutar(self) -> AsyncIterator[ItemScrapeado]:
        for termino in self.terminos:
            try:
                params = {
                    "q": termino,
                    "format": "json",
                    "per_page": 20,
                }
                if self.api_key:
                    params["api_token"] = self.api_key

                r = await self._get(
                    f"{self.BASE_URL}/companies/search",
                    params=params,
                )
                data = r.json()
                empresas = data.get("results", {}).get("companies", [])

                for item in empresas:
                    empresa = item.get("company", {})
                    yield ItemScrapeado(
                        url=empresa.get("opencorporates_url", ""),
                        titulo=empresa.get("name", ""),
                        contenido='',
                        confianza=0.88,
                        metadatos={
                            "tipo":             "institucion",
                            "numero_registro":  empresa.get("company_number"),
                            "jurisdiccion":     empresa.get("jurisdiction_code"),
                            "estado":           empresa.get("current_status"),
                            "fecha_fundacion":  empresa.get("incorporation_date"),
                            "tipo_empresa":     empresa.get("company_type"),
                            "termino_busqueda": termino,
                        },
                    )
            except Exception as e:
                self.log.warning("Error OpenCorporates", termino=termino, error=str(e))


# ── 5. SCRAPER DE BOLETINES OFICIALES ─────────────────────────

class BOGEScraper(BaseScraper):
    """
    Scraper del Boletín Oficial de Guinea Ecuatorial.
    Detecta nombramientos, decretos y disposiciones relevantes.
    """
    nombre = "BOGE Scraper"
    BASE_URL = "https://www.boe.es"  # Placeholder — adaptar a BOGE real

    def __init__(self, fuente_id: int, **kwargs):
        super().__init__(fuente_id, rate_limit_rpm=5, **kwargs)

    async def ejecutar(self) -> AsyncIterator[ItemScrapeado]:
        """
        En producción: adaptar a la URL real del BOGE.
        Por ahora devuelve un ejemplo de estructura.
        """
        self.log.info("Scraper BOGE iniciado (requiere configuración URL específica)")

        # Estructura que devolvería en producción:
        # yield ItemScrapeado(
        #     url="https://boge.gob.gq/...",
        #     titulo="Decreto 15/2024 nombramiento...",
        #     contenido="...",
        #     fecha="2024-03-15",
        #     confianza=0.95,
        #     metadatos={"tipo": "nombramiento", "organismo": "..."},
        # )
        return
        yield  # hace la función un generador vacío


# ── 6. MONITOR DE MENCIONES ───────────────────────────────────

class MencionesMonitor(BaseScraper):
    """
    Monitorea menciones de entidades específicas en la web.
    Ideal para alertas de cambios de estado, noticias negativas, etc.
    """
    nombre = "Menciones Monitor"

    def __init__(
        self,
        fuente_id: int,
        terminos: list[str],
        sitios: list[str] | None = None,
        **kwargs,
    ):
        super().__init__(fuente_id, rate_limit_rpm=5, **kwargs)
        self.terminos = terminos
        self.sitios   = sitios or []

    async def ejecutar(self) -> AsyncIterator[ItemScrapeado]:
        for termino in self.terminos:
            try:
                # Usar DuckDuckGo HTML (sin API key, sin scraping agresivo)
                query = termino
                if self.sitios:
                    query += ' site:' + ' OR site:'.join(self.sitios)

                r = await self._get(
                    "https://html.duckduckgo.com/html/",
                    params={"q": query, "kl": "es-es"},
                )
                soup = BeautifulSoup(r.text, 'lxml')
                resultados = soup.select('.result__body')[:5]

                for res in resultados:
                    titulo_tag = res.select_one('.result__title')
                    snippet_tag = res.select_one('.result__snippet')
                    url_tag = res.select_one('.result__url')

                    yield ItemScrapeado(
                        url=url_tag.get_text(strip=True) if url_tag else '',
                        titulo=titulo_tag.get_text(strip=True) if titulo_tag else '',
                        contenido=snippet_tag.get_text(strip=True) if snippet_tag else '',
                        confianza=0.6,
                        metadatos={
                            'termino_busqueda': termino,
                            'tipo': 'mencion_web',
                        },
                    )
            except Exception as e:
                self.log.warning("Error buscando menciones", termino=termino, error=str(e))


# ── REGISTRO DE SCRAPERS DISPONIBLES ──────────────────────────

SCRAPERS_DISPONIBLES = {
    "rss":             RSSNewsScraper,
    "web":             WebScraper,
    "opensanctions":   OpenSanctionsScraper,
    "opencorporates":  OpenCorporatesScraper,
    "boge":            BOGEScraper,
    "menciones":       MencionesMonitor,
}


def crear_scraper(tipo: str, fuente_id: int, config_extra: dict) -> BaseScraper:
    """Factory de scrapers — crea el scraper correcto según el tipo de fuente."""
    clase = SCRAPERS_DISPONIBLES.get(tipo)
    if not clase:
        raise ValueError(f"Tipo de scraper no disponible: {tipo}. "
                         f"Opciones: {list(SCRAPERS_DISPONIBLES.keys())}")
    return clase(fuente_id=fuente_id, **config_extra)
