# app/core/database.py
# ============================================================
# Conexiones a las tres bases de datos
# ============================================================
from contextlib import asynccontextmanager
from typing import AsyncGenerator

import redis.asyncio as aioredis
import structlog
from neo4j import AsyncGraphDatabase, AsyncDriver
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings

log = structlog.get_logger()

# ── POSTGRESQL ────────────────────────────────────────────────

engine = create_async_engine(
    settings.DATABASE_URL,
    pool_size=settings.POSTGRES_POOL_SIZE,
    max_overflow=settings.POSTGRES_MAX_OVERFLOW,
    pool_pre_ping=True,          # verifica conexiones antes de usar
    pool_recycle=3600,           # recicla conexiones cada hora
    echo=settings.APP_ENV == "development",
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency que provee una sesión de BD con el usuario inyectado para RLS."""
    async with AsyncSessionLocal() as session:
        yield session


async def get_db_as_user(user_id: str) -> AsyncGenerator[AsyncSession, None]:
    """
    Sesión con el user_id inyectado en la variable de sesión PostgreSQL.
    Esto activa el Row Level Security para ese usuario.
    """
    async with AsyncSessionLocal() as session:
        # Inyectar user_id para que las políticas RLS lo lean
        await session.execute(
            # SET LOCAL aplica solo a esta transacción
            f"SET LOCAL app.current_user_id = '{user_id}'"
        )
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


# ── NEO4J ─────────────────────────────────────────────────────

_neo4j_driver: AsyncDriver | None = None


async def get_neo4j_driver() -> AsyncDriver:
    global _neo4j_driver
    if _neo4j_driver is None:
        _neo4j_driver = AsyncGraphDatabase.driver(
            settings.NEO4J_URI,
            auth=(settings.NEO4J_USER, settings.NEO4J_PASSWORD),
            max_connection_lifetime=3600,
            max_connection_pool_size=50,
        )
    return _neo4j_driver


async def get_neo4j_session():
    driver = await get_neo4j_driver()
    async with driver.session() as session:
        yield session


async def close_neo4j():
    global _neo4j_driver
    if _neo4j_driver:
        await _neo4j_driver.close()
        _neo4j_driver = None


# ── REDIS ─────────────────────────────────────────────────────

_redis_cache: aioredis.Redis | None = None
_redis_sessions: aioredis.Redis | None = None


def get_redis_cache() -> aioredis.Redis:
    global _redis_cache
    if _redis_cache is None:
        _redis_cache = aioredis.from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
            max_connections=50,
        )
    return _redis_cache


def get_redis_sessions() -> aioredis.Redis:
    global _redis_sessions
    if _redis_sessions is None:
        _redis_sessions = aioredis.from_url(
            f"redis://:{settings.REDIS_PASSWORD}@{settings.REDIS_HOST}"
            f":{settings.REDIS_PORT}/{settings.REDIS_DB_SESSIONS}",
            encoding="utf-8",
            decode_responses=True,
        )
    return _redis_sessions


# ── LIFECYCLE ─────────────────────────────────────────────────

async def connect_all():
    """Conectar a todas las bases de datos al arrancar."""
    log.info("Conectando a bases de datos...")
    # PostgreSQL: el engine se conecta bajo demanda (pool)
    # Neo4j — opcional, no bloquea el arranque si no está disponible
    try:
        driver = await get_neo4j_driver()
        await driver.verify_connectivity()
        log.info("Neo4j conectado", uri=settings.NEO4J_URI)
    except Exception as e:
        log.warning("Neo4j no disponible al arrancar — se usará PostgreSQL para el grafo", error=str(e))
    # Redis
    try:
        cache = get_redis_cache()
        await cache.ping()
        log.info("Redis conectado", host=settings.REDIS_HOST)
    except Exception as e:
        log.warning("Redis no disponible", error=str(e))
    log.info("Backend listo")


async def disconnect_all():
    """Cerrar conexiones al apagar."""
    await close_neo4j()
    cache = get_redis_cache()
    await cache.aclose()
    await engine.dispose()
    log.info("Conexiones cerradas")
