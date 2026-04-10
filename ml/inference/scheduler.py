# ml/inference/scheduler.py
# ============================================================
# Scheduler ML — ejecuta scoring y segmentación periódicamente
# Corre como servicio independiente en su propio contenedor
# ============================================================
import asyncio
import os
from datetime import datetime

import asyncpg
import structlog
from dotenv import load_dotenv

load_dotenv()
log = structlog.get_logger()

POSTGRES_URL = (
    f"postgresql://{os.getenv('POSTGRES_USER','sigint_admin')}:"
    f"{os.getenv('POSTGRES_PASSWORD','')}@"
    f"{os.getenv('POSTGRES_HOST','postgres')}:"
    f"{os.getenv('POSTGRES_PORT','5432')}/"
    f"{os.getenv('POSTGRES_DB','sigint')}"
)

# Intervalos de ejecución (segundos)
SCORING_INTERVAL_SEC     = 6 * 3600   # cada 6 horas
SEGMENTATION_INTERVAL_SEC = 24 * 3600  # cada 24 horas


async def run_scoring(pool: asyncpg.Pool):
    from ml.inference.service import score_batch
    for tipo in ('persona', 'institucion'):
        try:
            r = await score_batch(pool, tipo)
            log.info("Scoring periódico", **r)
        except Exception as e:
            log.error("Error scoring", tipo=tipo, error=str(e))


async def run_segmentation(pool: asyncpg.Pool):
    from ml.inference.service import segmentar_batch
    for tipo in ('persona', 'institucion'):
        try:
            r = await segmentar_batch(pool, tipo)
            log.info("Segmentación periódica", **r)
        except Exception as e:
            log.error("Error segmentación", tipo=tipo, error=str(e))


async def main():
    log.info("ML Scheduler arrancando")
    pool = await asyncpg.create_pool(POSTGRES_URL, min_size=2, max_size=5)

    last_scoring     = 0.0
    last_segmentation = 0.0

    while True:
        now = asyncio.get_event_loop().time()

        if now - last_scoring >= SCORING_INTERVAL_SEC:
            log.info("Iniciando scoring periódico")
            await run_scoring(pool)
            last_scoring = now

        if now - last_segmentation >= SEGMENTATION_INTERVAL_SEC:
            log.info("Iniciando segmentación periódica")
            await run_segmentation(pool)
            last_segmentation = now

        await asyncio.sleep(300)   # revisar cada 5 minutos


if __name__ == '__main__':
    asyncio.run(main())
