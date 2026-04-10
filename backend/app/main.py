# app/main.py
# ============================================================
# Aplicación FastAPI principal — SIGINT DataCenter Pro
# ============================================================
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse

from app.api.v1.endpoints import auth, entidades, vinculos, stats, mapa, grafo, ia, etiquetas, usuarios
from app.api.v1.endpoints.alertas import router as alertas_router
from app.api.v1.endpoints.alertas import investigaciones_router, auditoria_router
from app.api.v1.endpoints import ml
from app.api.v1.endpoints import osint
from app.api.v1.endpoints import osint_crawler
from app.api.v1.endpoints import archivos
from app.api.v1.endpoints import configuracion
from app.core.config import settings
from app.core.database import connect_all, disconnect_all

log = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Arranque y apagado de la aplicación."""
    log.info("Arrancando SIGINT DataCenter Pro", version=settings.APP_VERSION)
    await connect_all()
    yield
    log.info("Apagando SIGINT DataCenter Pro")
    await disconnect_all()


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="""
## SIGINT DataCenter Pro — API

Sistema integral de gestión de inteligencia competitiva.

### Autenticación
Todos los endpoints (excepto `/auth/login`) requieren un JWT en el header:
```
Authorization: Bearer <token>
```

### Niveles de acceso
- **1** Público — datos básicos
- **2** Restringido — datos comerciales y relacionales
- **3** Confidencial — datos financieros
- **4** Secreto — datos clasificados
- **5** Top Secret — acceso total
    """,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    default_response_class=ORJSONResponse,
    lifespan=lifespan,
)

# ── CORS ──────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.APP_URL, "http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── MIDDLEWARE DE LOGGING ─────────────────────────────────────
@app.middleware("http")
async def log_requests(request: Request, call_next):
    import time
    t0 = time.monotonic()
    response = await call_next(request)
    duration_ms = int((time.monotonic() - t0) * 1000)
    log.info(
        "request",
        method=request.method,
        path=request.url.path,
        status=response.status_code,
        duration_ms=duration_ms,
    )
    return response


# ── MANEJO GLOBAL DE ERRORES ──────────────────────────────────
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    log.error("Error no manejado", path=request.url.path, error=str(exc))
    return ORJSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"error": "Error interno del servidor", "detail": str(exc)
                 if settings.APP_ENV == "development" else None},
    )


# ── RUTAS ─────────────────────────────────────────────────────
app.include_router(auth.router,           prefix="/api/v1")
app.include_router(entidades.router,      prefix="/api/v1")
app.include_router(vinculos.router,       prefix="/api/v1")
app.include_router(stats.router,          prefix="/api/v1")
app.include_router(mapa.router,           prefix="/api/v1")
app.include_router(grafo.router,          prefix="/api/v1")
app.include_router(ia.router,             prefix="/api/v1")
app.include_router(alertas_router,        prefix="/api/v1")
app.include_router(investigaciones_router, prefix="/api/v1")
app.include_router(auditoria_router,      prefix="/api/v1")
app.include_router(etiquetas.router,      prefix="/api/v1")
app.include_router(ml.router,             prefix="/api/v1")
app.include_router(osint.router,           prefix="/api/v1")
app.include_router(osint_crawler.router,   prefix="/api/v1")
app.include_router(archivos.router,        prefix="/api/v1")
app.include_router(configuracion.router,   prefix="/api/v1")
app.include_router(usuarios.router,      prefix="/api/v1")


@app.get("/", include_in_schema=False)
async def root():
    return {"sistema": settings.APP_NAME, "version": settings.APP_VERSION, "estado": "activo"}


@app.get("/health", tags=["Sistema"])
async def health_check():
    """Estado de salud del sistema."""
    from app.core.database import engine, get_redis_cache
    checks = {}

    # PostgreSQL
    try:
        async with engine.connect() as conn:
            await conn.execute(__import__("sqlalchemy").text("SELECT 1"))
        checks["postgresql"] = "ok"
    except Exception as e:
        checks["postgresql"] = f"error: {e}"

    # Redis
    try:
        redis = get_redis_cache()
        await redis.ping()
        checks["redis"] = "ok"
    except Exception as e:
        checks["redis"] = f"error: {e}"

    # Neo4j
    try:
        from app.core.database import get_neo4j_driver
        driver = await get_neo4j_driver()
        await driver.verify_connectivity()
        checks["neo4j"] = "ok"
    except Exception as e:
        checks["neo4j"] = f"error: {e}"

    # Ollama
    try:
        import httpx
        async with httpx.AsyncClient() as client:
            r = await client.get(f"{settings.OLLAMA_BASE_URL}/api/tags", timeout=3)
            checks["ollama"] = "ok" if r.status_code == 200 else "no_disponible"
    except Exception:
        checks["ollama"] = "no_disponible"

    all_ok = all(v == "ok" for v in checks.values())
    return {
        "estado": "ok" if all_ok else "degradado",
        "version": settings.APP_VERSION,
        "servicios": checks,
    }
