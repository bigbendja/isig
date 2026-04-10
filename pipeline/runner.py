# pipeline/runner.py
# ============================================================
# Runner principal del pipeline OSINT
# Orquesta el ciclo completo: scrape → NLP → ETL → alertas
# ============================================================
import asyncio
import json
from datetime import datetime
from typing import Any

import structlog

from pipeline.core.config import config
from pipeline.core.db import (
    get_pool,
    iniciar_ejecucion,
    finalizar_ejecucion,
    insertar_dato_raw,
    marcar_dato_error,
)
from pipeline.processors.nlp import extraer_entidades_spacy, analizar_texto_ollama
from pipeline.processors.etl import procesar_resultado_nlp
from pipeline.scrapers.sources import crear_scraper

log = structlog.get_logger()


async def ejecutar_fuente(fuente_id: int, trigger: str = 'schedule') -> dict[str, Any]:
    """
    Ejecuta el pipeline completo para una fuente OSINT.
    1. Lee la configuración de la fuente desde la BD
    2. Instancia el scraper correspondiente
    3. Procesa cada item: NLP → ETL → alertas
    4. Actualiza las estadísticas de la ejecución
    """
    pool = await get_pool()

    # 1. Leer configuración de la fuente
    fuente = await pool.fetchrow(
        "SELECT * FROM osint.fuentes WHERE id = $1 AND activa = TRUE",
        fuente_id,
    )
    if not fuente:
        raise ValueError(f"Fuente {fuente_id} no encontrada o inactiva")

    fuente_config = json.loads(fuente['config'] or '{}')
    fuente_tipo   = fuente['tipo']
    fuente_nombre = fuente['nombre']

    log.info("Iniciando ejecución de fuente", fuente=fuente_nombre, tipo=fuente_tipo)

    # 2. Iniciar registro de ejecución
    ejecucion_id = await iniciar_ejecucion(fuente_id, trigger)

    stats = {'nuevos': 0, 'actualizados': 0, 'descartados': 0, 'errores': []}

    try:
        # 3. Crear scraper
        scraper = crear_scraper(fuente_tipo, fuente_id, fuente_config)

        # 4. Iterar items del scraper
        async for item in scraper.ejecutar():
            try:
                if not item.contenido and not item.titulo:
                    stats['descartados'] += 1
                    continue

                texto_para_nlp = f"{item.titulo}\n\n{item.contenido}"

                # 4a. Guardar dato raw
                dato_id = await insertar_dato_raw(
                    fuente_id=fuente_id,
                    ejecucion_id=ejecucion_id,
                    contenido_raw={
                        'url':      item.url,
                        'titulo':   item.titulo,
                        'contenido': item.contenido[:2000],
                        'fecha':    item.fecha,
                        'metadatos': item.metadatos,
                    },
                    url_origen=item.url,
                    confianza_ext=item.confianza,
                )

                # 4b. NLP — usar Ollama para documentos importantes,
                #            spaCy para volumen alto
                if len(texto_para_nlp) > 500 and item.confianza >= 0.8:
                    resultado_nlp = await analizar_texto_ollama(
                        texto_para_nlp,
                        instruccion="extrae personas, organizaciones y relaciones relevantes"
                    )
                else:
                    resultado_nlp = extraer_entidades_spacy(texto_para_nlp)

                # 4c. ETL — dedup, crear/enriquecer entidades, alertas
                resultado_etl = await procesar_resultado_nlp(
                    resultado=resultado_nlp,
                    fuente=fuente_nombre,
                    fuente_id=fuente_id,
                    dato_raw_id=dato_id,
                    url_origen=item.url,
                    confianza_base=_confianza_a_nivel(item.confianza),
                )

                stats['nuevos']       += resultado_etl.entidades_creadas
                stats['actualizados'] += resultado_etl.entidades_enriquecidas
                stats['descartados']  += resultado_etl.entidades_ignoradas
                if resultado_etl.errores:
                    stats['errores'].extend(resultado_etl.errores[:3])

            except Exception as item_error:
                log.warning("Error procesando item", url=item.url, error=str(item_error))
                stats['errores'].append(f"{item.url}: {item_error}")
                if len(stats['errores']) > 10:
                    break  # Evitar acumular demasiados errores

        estado_final = 'ok' if len(stats['errores']) < 5 else 'parcial'

    except Exception as e:
        log.error("Error fatal en ejecución de fuente", fuente=fuente_nombre, error=str(e))
        stats['errores'].append(str(e))
        estado_final = 'error'

    # 5. Finalizar ejecución
    await finalizar_ejecucion(
        ejecucion_id=ejecucion_id,
        fuente_id=fuente_id,
        nuevos=stats['nuevos'],
        actualizados=stats['actualizados'],
        descartados=stats['descartados'],
        errores=stats['errores'],
        estado=estado_final,
    )

    log.info(
        "Ejecución finalizada",
        fuente=fuente_nombre,
        estado=estado_final,
        **{k: v for k, v in stats.items() if k != 'errores'},
    )

    return {
        'fuente_id':    fuente_id,
        'fuente':       fuente_nombre,
        'ejecucion_id': ejecucion_id,
        'estado':       estado_final,
        **stats,
    }


def _confianza_a_nivel(confianza_float: float) -> int:
    """Convierte float de confianza (0-1) al entero 1-5 del sistema."""
    if confianza_float >= 0.9:  return 5
    if confianza_float >= 0.75: return 4
    if confianza_float >= 0.6:  return 3
    if confianza_float >= 0.4:  return 2
    return 1


async def ejecutar_todas_fuentes_activas():
    """Ejecuta todas las fuentes activas con un retraso entre cada una."""
    pool = await get_pool()
    fuentes = await pool.fetch(
        "SELECT id, nombre FROM osint.fuentes WHERE activa = TRUE ORDER BY id"
    )
    log.info("Ejecutando todas las fuentes activas", total=len(fuentes))

    for fuente in fuentes:
        try:
            await ejecutar_fuente(fuente['id'], trigger='schedule')
            await asyncio.sleep(2)  # pausa entre fuentes
        except Exception as e:
            log.error("Error en fuente", fuente=fuente['nombre'], error=str(e))


# ── AIRFLOW DAG ───────────────────────────────────────────────

# Este código se ejecuta cuando el módulo es importado por Airflow
try:
    from airflow import DAG
    from airflow.operators.python import PythonOperator
    from datetime import timedelta

    def _run_source(fuente_id: int, **kwargs):
        """Wrapper síncrono para Airflow."""
        asyncio.run(ejecutar_fuente(fuente_id, trigger='airflow'))

    def _run_all(**kwargs):
        asyncio.run(ejecutar_todas_fuentes_activas())

    with DAG(
        dag_id='sigint_osint_pipeline',
        description='Pipeline OSINT completo — todas las fuentes activas',
        schedule_interval='0 */6 * * *',  # cada 6 horas
        start_date=datetime(2026, 1, 1),
        catchup=False,
        default_args={
            'owner':            'sigint',
            'retries':          2,
            'retry_delay':      timedelta(minutes=5),
            'execution_timeout': timedelta(hours=2),
        },
        tags=['osint', 'sigint'],
    ) as dag_todas:

        run_all = PythonOperator(
            task_id='ejecutar_todas_fuentes',
            python_callable=_run_all,
        )

    # DAG de sanciones — diario
    with DAG(
        dag_id='sigint_sanciones_sync',
        description='Sincronización diaria de listas de sanciones',
        schedule_interval='0 2 * * *',  # cada día a las 2am
        start_date=datetime(2026, 1, 1),
        catchup=False,
        tags=['osint', 'sanciones'],
    ) as dag_sanciones:

        sync_sanciones = PythonOperator(
            task_id='sync_sanciones',
            python_callable=lambda **kw: asyncio.run(_sync_sanciones()),
        )

    async def _sync_sanciones():
        """Sincroniza listas de sanciones desde OpenSanctions."""
        from pipeline.scrapers.sources import OpenSanctionsScraper
        from pipeline.core.db import get_pool
        import uuid

        pool = await get_pool()
        scraper = OpenSanctionsScraper(fuente_id=0)

        insertados = 0
        async for item in scraper.ejecutar():
            if item.metadatos.get('tipo') == 'sancion':
                nombres = item.metadatos.get('nombres', [item.titulo])
                listas  = item.metadatos.get('listas', ['SANCION'])
                for nombre in nombres:
                    if nombre and len(nombre) > 2:
                        try:
                            await pool.execute("""
                                INSERT INTO osint.sanctions_cache (id, nombre, lista, updated_at)
                                VALUES ($1, $2, $3, NOW())
                                ON CONFLICT (nombre, lista) DO UPDATE SET updated_at = NOW()
                            """, str(uuid.uuid4()), nombre.strip(), listas[0] if listas else 'SANCION')
                            insertados += 1
                        except Exception:
                            pass

        log.info("Sanciones sincronizadas", insertados=insertados)

except ImportError:
    # Airflow no instalado — el runner funciona de todas formas standalone
    pass


# ── ENTRY POINT STANDALONE ────────────────────────────────────

if __name__ == '__main__':
    import sys
    from dotenv import load_dotenv
    load_dotenv()

    if len(sys.argv) > 1 and sys.argv[1] == '--fuente':
        fuente_id = int(sys.argv[2])
        asyncio.run(ejecutar_fuente(fuente_id, trigger='manual'))
    else:
        asyncio.run(ejecutar_todas_fuentes_activas())
