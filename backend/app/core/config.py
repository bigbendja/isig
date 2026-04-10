# app/core/config.py
# ============================================================
# Configuración central — lee del .env via pydantic-settings
# ============================================================
from functools import lru_cache
from typing import Literal
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── APP ──────────────────────────────────────────────────
    APP_ENV:     Literal["development", "production"] = "development"
    APP_NAME:    str = "SIGINT DataCenter Pro"
    APP_VERSION: str = "1.0.0"
    APP_URL:     str = "http://localhost:8000"
    DEBUG:       bool = False

    # ── SEGURIDAD ────────────────────────────────────────────
    SECRET_KEY:           str
    JWT_SECRET:           str
    JWT_ALGORITHM:        str  = "HS256"
    JWT_EXPIRE_MINUTES:   int  = 480
    JWT_REFRESH_EXPIRE_DAYS: int = 7

    # ── POSTGRESQL ───────────────────────────────────────────
    POSTGRES_HOST:     str = "localhost"
    POSTGRES_PORT:     int = 5432
    POSTGRES_DB:       str = "sigint"
    POSTGRES_USER:     str = "sigint_admin"
    POSTGRES_PASSWORD: str
    POSTGRES_POOL_SIZE:    int = 20
    POSTGRES_MAX_OVERFLOW: int = 40

    @property
    def DATABASE_URL(self) -> str:
        return (
            f"postgresql+asyncpg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    @property
    def DATABASE_URL_SYNC(self) -> str:
        return (
            f"postgresql://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    # ── NEO4J ────────────────────────────────────────────────
    NEO4J_HOST:      str = "localhost"
    NEO4J_BOLT_PORT: int = 7687
    NEO4J_USER:      str = "neo4j"
    NEO4J_PASSWORD:  str

    @property
    def NEO4J_URI(self) -> str:
        return f"bolt://{self.NEO4J_HOST}:{self.NEO4J_BOLT_PORT}"

    # ── REDIS ────────────────────────────────────────────────
    REDIS_HOST:     str = "localhost"
    REDIS_PORT:     int = 6379
    REDIS_PASSWORD: str
    REDIS_DB_CACHE:    int = 0
    REDIS_DB_SESSIONS: int = 1
    REDIS_DB_QUEUES:   int = 2

    @property
    def REDIS_URL(self) -> str:
        return f"redis://:{self.REDIS_PASSWORD}@{self.REDIS_HOST}:{self.REDIS_PORT}/{self.REDIS_DB_CACHE}"

    # ── OLLAMA ───────────────────────────────────────────────
    OLLAMA_HOST:    str = "localhost"
    OLLAMA_PORT:    int = 11434
    OLLAMA_MODEL_DEFAULT:    str = "qwen2.5:7b"
    OLLAMA_MODEL_FAST:       str = "qwen2.5:7b"
    OLLAMA_MODEL_ANALYSIS:   str = "qwen2.5:14b"
    OLLAMA_MODEL_EMBEDDINGS: str = "nomic-embed-text"

    @property
    def OLLAMA_BASE_URL(self) -> str:
        return f"http://{self.OLLAMA_HOST}:{self.OLLAMA_PORT}"

    # ── IA ROUTING ───────────────────────────────────────────
    AI_MAX_LEVEL_EXTERNAL_API:  int = 2
    AI_LOCAL_MODEL_CLASSIFIED:  str = "qwen2.5:14b"

    OPENAI_API_KEY:         str = ""
    OPENAI_MODEL_DEFAULT:   str = "gpt-4o-mini"

    ANTHROPIC_API_KEY:      str = ""
    ANTHROPIC_MODEL_DEFAULT: str = "claude-haiku-4-5-20251001"

    # ── STORAGE ──────────────────────────────────────────────
    STORAGE_BACKEND:    str = "local"
    STORAGE_LOCAL_PATH: str = "./data/uploads"
    MAX_UPLOAD_SIZE_MB: int = 100

    # ── LÍMITES ──────────────────────────────────────────────
    SEARCH_RESULTS_MAX:       int = 100
    API_RATE_LIMIT_PER_MINUTE: int = 120
    MAX_BULK_IMPORT_ROWS:     int = 10000

    # ── LOGGING ──────────────────────────────────────────────
    LOG_LEVEL:  str = "INFO"
    LOG_FORMAT: str = "json"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
