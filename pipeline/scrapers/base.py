# pipeline/scrapers/base.py
# ============================================================
# Clase base para todos los scrapers
# Manejo de rate limiting, retry y logging centralizado
# ============================================================
import asyncio
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import AsyncIterator

import httpx
import structlog
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
)

from pipeline.core.config import config

log = structlog.get_logger()

# User agents rotativos para evitar bloqueos
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
]

_ua_index = 0

def siguiente_user_agent() -> str:
    global _ua_index
    ua = USER_AGENTS[_ua_index % len(USER_AGENTS)]
    _ua_index += 1
    return ua


@dataclass
class ItemScrapeado:
    """Unidad mínima de dato extraído por un scraper."""
    url:         str
    titulo:      str = ''
    contenido:   str = ''
    fecha:       str = ''
    autor:       str = ''
    entidades:   list[str] = field(default_factory=list)
    metadatos:   dict      = field(default_factory=dict)
    confianza:   float     = 0.7


class BaseScraper(ABC):
    """Clase base para todos los scrapers del sistema."""

    def __init__(self, fuente_id: int, rate_limit_rpm: int = 10, timeout: int = 30):
        self.fuente_id      = fuente_id
        self.rate_limit_rpm = rate_limit_rpm
        self.timeout        = timeout
        self._last_request  = 0.0
        self.log = structlog.get_logger(scraper=self.__class__.__name__)

    async def _esperar_rate_limit(self):
        """Respeta el rate limit entre peticiones."""
        if self.rate_limit_rpm <= 0:
            return
        min_interval = 60.0 / self.rate_limit_rpm
        elapsed = time.monotonic() - self._last_request
        if elapsed < min_interval:
            await asyncio.sleep(min_interval - elapsed)
        self._last_request = time.monotonic()

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=30),
        retry=retry_if_exception_type((httpx.HTTPError, httpx.TimeoutException)),
    )
    async def _get(self, url: str, headers: dict | None = None, **kwargs) -> httpx.Response:
        """GET con retry automático y rate limiting."""
        await self._esperar_rate_limit()
        default_headers = {
            'User-Agent': siguiente_user_agent(),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        }
        if headers:
            default_headers.update(headers)

        async with httpx.AsyncClient(
            timeout=self.timeout,
            follow_redirects=True,
            headers=default_headers,
        ) as client:
            r = await client.get(url, **kwargs)
            r.raise_for_status()
            return r

    @abstractmethod
    async def ejecutar(self) -> AsyncIterator[ItemScrapeado]:
        """Genera items scrapeados. Implementar en cada subclase."""
        ...

    @property
    @abstractmethod
    def nombre(self) -> str:
        """Nombre identificativo del scraper."""
        ...
