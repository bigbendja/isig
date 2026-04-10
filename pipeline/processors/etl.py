# pipeline/processors/etl.py
# ============================================================
# Motor ETL — normalización, deduplicación y enriquecimiento
# El corazón del pipeline: convierte datos raw en entidades
# ============================================================
import re
import unicodedata
from dataclasses import dataclass, field
from typing import Any

import structlog

from pipeline.core.db import (
    buscar_persona_similar,
    buscar_institucion_similar,
    crear_persona_borrador,
    enriquecer_persona,
    enriquecer_institucion,
    crear_alerta,
    marcar_dato_procesado,
    marcar_dato_error,
    verificar_en_listas,
)
from pipeline.processors.nlp import ResultadoNLP

log = structlog.get_logger()


# ── NORMALIZACIÓN ─────────────────────────────────────────────

def normalizar_nombre(nombre: str) -> str:
    """Normaliza un nombre: quita acentos, mayúsculas, espacios extra."""
    if not nombre:
        return ''
    # Eliminar acentos
    nfkd = unicodedata.normalize('NFKD', nombre)
    sin_tildes = ''.join(c for c in nfkd if not unicodedata.combining(c))
    # Capitalizar correctamente
    return ' '.join(w.capitalize() for w in sin_tildes.strip().split())


def normalizar_telefono(telefono: str, pais_default: str = '+240') -> str:
    """Normaliza teléfonos al formato internacional."""
    if not telefono:
        return ''
    digitos = re.sub(r'[^\d+]', '', telefono)
    if digitos.startswith('00'):
        digitos = '+' + digitos[2:]
    elif not digitos.startswith('+'):
        if len(digitos) == 9:  # Guinea Ecuatorial sin prefijo
            digitos = pais_default + digitos
    return digitos


def normalizar_email(email: str) -> str:
    return email.strip().lower() if email else ''


def normalizar_url(url: str) -> str:
    if not url:
        return ''
    url = url.strip()
    if not url.startswith(('http://', 'https://')):
        url = 'https://' + url
    return url.rstrip('/')


def limpiar_texto(texto: str, max_len: int = 5000) -> str:
    """Limpia texto de caracteres de control y espacios excesivos."""
    if not texto:
        return ''
    texto = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', texto)
    texto = re.sub(r'\s+', ' ', texto)
    return texto.strip()[:max_len]


# ── DEDUPLICADOR ──────────────────────────────────────────────

@dataclass
class ResultadoDedup:
    accion:       str   # 'crear' | 'enriquecer' | 'ignorar'
    entidad_id:   str | None = None
    similitud:    float = 0.0
    entidad_tipo: str = 'persona'


async def deduplicar_persona(nombre: str) -> ResultadoDedup:
    """
    Decide qué hacer con una persona encontrada:
    - Si existe en BD con alta similitud → enriquecer
    - Si no existe → crear como borrador
    """
    if not nombre or len(nombre) < 3:
        return ResultadoDedup(accion='ignorar')

    nombre_norm = normalizar_nombre(nombre)
    existente = await buscar_persona_similar(nombre_norm, umbral=0.75)

    if existente:
        return ResultadoDedup(
            accion='enriquecer',
            entidad_id=str(existente['id']),
            similitud=float(existente.get('sim', 0)),
            entidad_tipo='persona',
        )

    return ResultadoDedup(accion='crear', entidad_tipo='persona')


async def deduplicar_institucion(nombre: str) -> ResultadoDedup:
    if not nombre or len(nombre) < 2:
        return ResultadoDedup(accion='ignorar')

    existente = await buscar_institucion_similar(nombre, umbral=0.78)

    if existente:
        return ResultadoDedup(
            accion='enriquecer',
            entidad_id=str(existente['id']),
            similitud=float(existente.get('sim', 0)),
            entidad_tipo='institucion',
        )

    return ResultadoDedup(accion='crear', entidad_tipo='institucion')


# ── PROCESADOR PRINCIPAL ──────────────────────────────────────

@dataclass
class ResultadoProcesamiento:
    entidades_creadas:     int = 0
    entidades_enriquecidas: int = 0
    entidades_ignoradas:   int = 0
    alertas_generadas:     int = 0
    errores:               list[str] = field(default_factory=list)


async def procesar_resultado_nlp(
    resultado: ResultadoNLP,
    fuente: str,
    fuente_id: int,
    dato_raw_id: str | None = None,
    url_origen: str | None = None,
    confianza_base: int = 3,
) -> ResultadoProcesamiento:
    """
    Toma el resultado del NLP y lo convierte en entidades en la BD.
    Flujo: dedup → crear/enriquecer → verificar sanciones → alertas
    """
    stats = ResultadoProcesamiento()

    # Procesar personas
    for persona in resultado.personas:
        if not persona.texto or len(persona.texto) < 4:
            continue
        try:
            nombre_norm = normalizar_nombre(persona.texto)
            dedup = await deduplicar_persona(nombre_norm)

            if dedup.accion == 'ignorar':
                stats.entidades_ignoradas += 1
                continue

            if dedup.accion == 'crear':
                partes = nombre_norm.split()
                datos = {
                    'nombre_completo': nombre_norm,
                    'apellidos':       ' '.join(partes[-2:]) if len(partes) >= 2 else '',
                    'nombres':         partes[0] if partes else '',
                    'fuente':          fuente,
                    'extendido': {
                        'mencion_original': {
                            'valor':     persona.texto,
                            'fuente':    fuente,
                            'confianza': confianza_base,
                            'contexto':  persona.contexto[:200] if persona.contexto else '',
                        }
                    }
                }
                entidad_id = await crear_persona_borrador(datos)
                stats.entidades_creadas += 1
                log.info("Persona creada desde OSINT", nombre=nombre_norm, fuente=fuente)
            else:
                entidad_id = dedup.entidad_id
                # Enriquecer con contexto si es útil
                if persona.contexto:
                    await enriquecer_persona(
                        entidad_id, 'mencion_reciente',
                        persona.contexto[:300], fuente, confianza_base,
                    )
                stats.entidades_enriquecidas += 1

            # Verificar en listas de sanciones
            listas = await verificar_en_listas(nombre_norm)
            if listas:
                await crear_alerta(
                    tipo_alerta='lista_sancion',
                    titulo=f"Posible coincidencia en lista: {nombre_norm}",
                    descripcion=f"Encontrado en: {', '.join(listas)}",
                    severidad='alta',
                    entidad_tipo='persona',
                    entidad_id=entidad_id,
                    fuente_id=fuente_id,
                    dato_raw_id=dato_raw_id,
                    datos_adicionales={'listas': listas, 'nombre': nombre_norm},
                )
                stats.alertas_generadas += 1

            if dato_raw_id:
                await marcar_dato_procesado(dato_raw_id, 'persona', entidad_id)

        except Exception as e:
            stats.errores.append(f"Persona '{persona.texto}': {e}")
            log.error("Error procesando persona", nombre=persona.texto, error=str(e))

    # Procesar organizaciones
    for org in resultado.organizaciones:
        if not org.texto or len(org.texto) < 2:
            continue
        try:
            dedup = await deduplicar_institucion(org.texto)

            if dedup.accion == 'ignorar':
                stats.entidades_ignoradas += 1
                continue

            if dedup.accion == 'crear':
                from pipeline.core.db import get_pool
                import uuid, json
                pool = await get_pool()
                inst_id = str(uuid.uuid4())
                await pool.execute("""
                    INSERT INTO core.instituciones
                        (id, nombre, fuente_primaria, nivel_acceso_requerido, perfil_extendido)
                    VALUES ($1, $2, $3, 1, $4::jsonb)
                    ON CONFLICT DO NOTHING
                """, inst_id, org.texto, fuente,
                    json.dumps({
                        'mencion_original': {
                            'valor': org.texto, 'fuente': fuente,
                            'confianza': confianza_base,
                            'contexto': org.contexto[:200] if org.contexto else '',
                        }
                    })
                )
                stats.entidades_creadas += 1
            else:
                stats.entidades_enriquecidas += 1
                if dato_raw_id:
                    await marcar_dato_procesado(dato_raw_id, 'institucion', dedup.entidad_id)

        except Exception as e:
            stats.errores.append(f"Org '{org.texto}': {e}")

    # Alerta por menciones relevantes en el resumen
    if resultado.resumen and resultado.sentimiento == 'negativo':
        await crear_alerta(
            tipo_alerta='mencion_negativa',
            titulo=f"Mención negativa detectada — {fuente}",
            descripcion=resultado.resumen[:500],
            severidad='baja',
            fuente_id=fuente_id,
            dato_raw_id=dato_raw_id,
        )
        stats.alertas_generadas += 1

    return stats


# ── IMPORTAR DESDE CSV/EXCEL ──────────────────────────────────

async def importar_csv(
    ruta_archivo: str,
    mapeo_columnas: dict[str, str],
    fuente: str,
    fuente_id: int,
    tipo_entidad: str = 'persona',
) -> ResultadoProcesamiento:
    """
    Importa entidades desde un archivo CSV o Excel.
    mapeo_columnas: {'columna_csv': 'campo_bd', ...}
    """
    import pandas as pd
    stats = ResultadoProcesamiento()

    try:
        if ruta_archivo.endswith('.xlsx') or ruta_archivo.endswith('.xls'):
            df = pd.read_excel(ruta_archivo)
        else:
            df = pd.read_csv(ruta_archivo, encoding='utf-8-sig')

        log.info("Importando CSV/Excel", filas=len(df), archivo=ruta_archivo)

        for _, fila in df.iterrows():
            try:
                datos: dict[str, Any] = {}
                for col_csv, campo_bd in mapeo_columnas.items():
                    if col_csv in fila and pd.notna(fila[col_csv]):
                        valor = fila[col_csv]
                        # Normalizar según el campo
                        if 'nombre' in campo_bd:
                            valor = normalizar_nombre(str(valor))
                        elif 'email' in campo_bd:
                            valor = normalizar_email(str(valor))
                        elif 'telefono' in campo_bd or 'phone' in campo_bd:
                            valor = normalizar_telefono(str(valor))
                        datos[campo_bd] = valor

                if not datos.get('nombre_completo'):
                    stats.entidades_ignoradas += 1
                    continue

                if tipo_entidad == 'persona':
                    dedup = await deduplicar_persona(datos['nombre_completo'])
                    if dedup.accion == 'crear':
                        datos['fuente'] = fuente
                        await crear_persona_borrador(datos)
                        stats.entidades_creadas += 1
                    elif dedup.accion == 'enriquecer':
                        for campo, valor in datos.items():
                            if campo != 'nombre_completo' and valor:
                                await enriquecer_persona(
                                    dedup.entidad_id, campo, valor, fuente, 4
                                )
                        stats.entidades_enriquecidas += 1

            except Exception as e:
                stats.errores.append(f"Fila {_}: {e}")

    except Exception as e:
        log.error("Error leyendo archivo", error=str(e))
        stats.errores.append(str(e))

    log.info("Importación completada", **{
        'creadas': stats.entidades_creadas,
        'enriquecidas': stats.entidades_enriquecidas,
        'errores': len(stats.errores),
    })
    return stats
