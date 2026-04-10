# pipeline/core/config.py
# ============================================================
# Configuración del pipeline — lee del .env compartido
# ============================================================
import os
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class PipelineConfig:
    # PostgreSQL
    postgres_url: str = field(default_factory=lambda: (
        f"postgresql://{os.getenv('POSTGRES_USER','sigint_admin')}:"
        f"{os.getenv('POSTGRES_PASSWORD','')}@"
        f"{os.getenv('POSTGRES_HOST','localhost')}:"
        f"{os.getenv('POSTGRES_PORT','5432')}/"
        f"{os.getenv('POSTGRES_DB','sigint')}"
    ))
    postgres_url_async: str = field(default_factory=lambda: (
        f"postgresql+asyncpg://{os.getenv('POSTGRES_USER','sigint_admin')}:"
        f"{os.getenv('POSTGRES_PASSWORD','')}@"
        f"{os.getenv('POSTGRES_HOST','localhost')}:"
        f"{os.getenv('POSTGRES_PORT','5432')}/"
        f"{os.getenv('POSTGRES_DB','sigint')}"
    ))

    # Redis
    redis_url: str = field(default_factory=lambda: (
        f"redis://:{os.getenv('REDIS_PASSWORD','')}@"
        f"{os.getenv('REDIS_HOST','localhost')}:"
        f"{os.getenv('REDIS_PORT','6379')}/2"
    ))

    # Ollama
    ollama_url: str = field(default_factory=lambda:
        f"http://{os.getenv('OLLAMA_HOST','localhost')}:{os.getenv('OLLAMA_PORT','11434')}"
    )
    ollama_model_fast: str = field(default_factory=lambda:
        os.getenv('OLLAMA_MODEL_FAST', 'qwen2.5:7b')
    )

    # Rate limiting
    default_rate_limit_rpm: int = 10
    default_timeout_seg: int = 30
    max_retries: int = 3
    retry_backoff: float = 2.0

    # Rutas
    data_dir: Path = field(default_factory=lambda: Path('/app/data'))
    uploads_dir: Path = field(default_factory=lambda: Path('/app/data/uploads'))

    # OSINT APIs (opcionales)
    opencorporates_api_key: str = field(default_factory=lambda: os.getenv('OPENCORPORATES_API_KEY', ''))
    opensanctions_api_key: str = field(default_factory=lambda: os.getenv('OPENSANCTIONS_API_KEY', ''))


config = PipelineConfig()
