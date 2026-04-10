# pipeline/processors/nlp.py
# ============================================================
# Procesador NLP — extracción de entidades, relaciones, sentimiento
# Usa spaCy para NER rápido + Ollama para análisis profundo
# ============================================================
import json
import re
from dataclasses import dataclass, field
from typing import Optional

import httpx
import structlog

from pipeline.core.config import config

log = structlog.get_logger()

# ── TIPOS ─────────────────────────────────────────────────────

@dataclass
class EntidadExtraida:
    texto:      str
    tipo:       str           # PER / ORG / LOC / MISC
    inicio:     int
    fin:        int
    confianza:  float = 0.8
    contexto:   str = ''      # frase donde aparece


@dataclass
class RelacionExtraida:
    entidad_a:  str
    relacion:   str
    entidad_b:  str
    confianza:  float = 0.7
    contexto:   str = ''


@dataclass
class ResultadoNLP:
    personas:       list[EntidadExtraida] = field(default_factory=list)
    organizaciones: list[EntidadExtraida] = field(default_factory=list)
    lugares:        list[EntidadExtraida] = field(default_factory=list)
    relaciones:     list[RelacionExtraida] = field(default_factory=list)
    fechas:         list[str] = field(default_factory=list)
    resumen:        str = ''
    sentimiento:    str = 'neutro'    # positivo/negativo/neutro


# ── PROCESADOR SPACY ──────────────────────────────────────────

_nlp_model = None


def _cargar_spacy():
    global _nlp_model
    if _nlp_model is None:
        try:
            import spacy
            _nlp_model = spacy.load('es_core_news_lg')
            log.info("Modelo spaCy cargado: es_core_news_lg")
        except Exception:
            try:
                import spacy
                _nlp_model = spacy.load('es_core_news_sm')
                log.info("Modelo spaCy cargado: es_core_news_sm (fallback)")
            except Exception as e:
                log.warning("spaCy no disponible", error=str(e))
                _nlp_model = None
    return _nlp_model


def extraer_entidades_spacy(texto: str) -> ResultadoNLP:
    """NER rápido con spaCy. Ideal para textos cortos y procesamiento en lote."""
    nlp = _cargar_spacy()
    resultado = ResultadoNLP()

    if nlp is None:
        # Fallback básico con regex
        return _extraer_entidades_regex(texto)

    # Procesar en chunks si el texto es muy largo
    max_len = 100_000
    doc = nlp(texto[:max_len])

    for ent in doc.ents:
        # Extraer contexto (frase que rodea la entidad)
        start = max(0, ent.start_char - 60)
        end   = min(len(texto), ent.end_char + 60)
        contexto = texto[start:end].strip()

        e = EntidadExtraida(
            texto=ent.text.strip(),
            tipo=ent.label_,
            inicio=ent.start_char,
            fin=ent.end_char,
            confianza=0.85,
            contexto=contexto,
        )

        if ent.label_ == 'PER' and len(ent.text.strip()) > 3:
            resultado.personas.append(e)
        elif ent.label_ in ('ORG', 'MISC'):
            resultado.organizaciones.append(e)
        elif ent.label_ in ('LOC', 'GPE'):
            resultado.lugares.append(e)

    # Extraer fechas con regex
    resultado.fechas = _extraer_fechas(texto)

    # Deduplicar
    resultado.personas       = _deduplicar_entidades(resultado.personas)
    resultado.organizaciones = _deduplicar_entidades(resultado.organizaciones)
    resultado.lugares        = _deduplicar_entidades(resultado.lugares)

    return resultado


def _extraer_entidades_regex(texto: str) -> ResultadoNLP:
    """Fallback básico de extracción cuando spaCy no está disponible."""
    resultado = ResultadoNLP()
    # Patrón de nombres propios: dos o más palabras con mayúscula
    patron_nombre = r'\b([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){1,3})\b'
    for m in re.finditer(patron_nombre, texto):
        nombre = m.group(1)
        if any(stop in nombre.lower() for stop in ['el ', 'la ', 'los ', 'las ']):
            continue
        resultado.personas.append(EntidadExtraida(
            texto=nombre, tipo='PER',
            inicio=m.start(), fin=m.end(),
            confianza=0.5,
        ))
    resultado.fechas = _extraer_fechas(texto)
    return resultado


def _extraer_fechas(texto: str) -> list[str]:
    patrones = [
        r'\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b',
        r'\b\d{4}[-/]\d{2}[-/]\d{2}\b',
        r'\b(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)'
        r'\s+(?:de\s+)?\d{4}\b',
        r'\b\d{1,2}\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)'
        r'\s+(?:de\s+)?\d{4}\b',
    ]
    fechas = []
    for patron in patrones:
        for m in re.finditer(patron, texto, re.IGNORECASE):
            f = m.group().strip()
            if f not in fechas:
                fechas.append(f)
    return fechas


def _deduplicar_entidades(entidades: list[EntidadExtraida]) -> list[EntidadExtraida]:
    """Elimina entidades duplicadas o muy similares."""
    vistas = []
    resultado = []
    for e in entidades:
        nombre_norm = e.texto.lower().strip()
        if nombre_norm not in vistas and len(nombre_norm) > 2:
            vistas.append(nombre_norm)
            resultado.append(e)
    return resultado


# ── PROCESADOR OLLAMA — ANÁLISIS PROFUNDO ─────────────────────

async def analizar_texto_ollama(
    texto: str,
    instruccion: str = "extrae personas, organizaciones, relaciones y un resumen",
    max_chars: int = 4000,
) -> ResultadoNLP:
    """
    Análisis NLP profundo vía Ollama.
    Más lento que spaCy pero detecta relaciones complejas.
    Usar para documentos importantes, no para scraping masivo.
    """
    resultado = ResultadoNLP()

    prompt_sistema = """Eres un extractor de entidades e información para sistemas de inteligencia.
Analiza el texto y responde ÚNICAMENTE con JSON válido, sin texto adicional:
{
  "personas": [{"nombre": "...", "cargo": "...", "organizacion": "...", "contexto": "..."}],
  "organizaciones": [{"nombre": "...", "tipo": "...", "pais": "...", "contexto": "..."}],
  "lugares": [{"nombre": "...", "tipo": "ciudad/pais/region"}],
  "relaciones": [{"entidad_a": "...", "relacion": "...", "entidad_b": "...", "contexto": "..."}],
  "fechas_clave": ["..."],
  "resumen": "...",
  "sentimiento": "positivo|negativo|neutro"
}"""

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(
                f"{config.ollama_url}/api/chat",
                json={
                    "model": config.ollama_model_fast,
                    "messages": [
                        {"role": "system", "content": prompt_sistema},
                        {"role": "user", "content": f"INSTRUCCIÓN: {instruccion}\n\nTEXTO:\n{texto[:max_chars]}"},
                    ],
                    "stream": False,
                    "options": {"temperature": 0.1, "num_predict": 1024},
                },
            )
            r.raise_for_status()
            contenido = r.json().get("message", {}).get("content", "")

        # Parsear JSON
        contenido = contenido.strip()
        if contenido.startswith("```"):
            contenido = contenido.split("```")[1]
            if contenido.startswith("json"):
                contenido = contenido[4:]
        data = json.loads(contenido.strip())

        # Mapear resultado
        for p in data.get("personas", []):
            resultado.personas.append(EntidadExtraida(
                texto=p.get("nombre", ""), tipo="PER", inicio=0, fin=0,
                confianza=0.85, contexto=p.get("contexto", ""),
            ))
        for o in data.get("organizaciones", []):
            resultado.organizaciones.append(EntidadExtraida(
                texto=o.get("nombre", ""), tipo="ORG", inicio=0, fin=0,
                confianza=0.85, contexto=o.get("contexto", ""),
            ))
        for l in data.get("lugares", []):
            resultado.lugares.append(EntidadExtraida(
                texto=l.get("nombre", ""), tipo="LOC", inicio=0, fin=0,
                confianza=0.8,
            ))
        for rel in data.get("relaciones", []):
            resultado.relaciones.append(RelacionExtraida(
                entidad_a=rel.get("entidad_a", ""),
                relacion=rel.get("relacion", ""),
                entidad_b=rel.get("entidad_b", ""),
                confianza=0.8,
                contexto=rel.get("contexto", ""),
            ))
        resultado.fechas    = data.get("fechas_clave", [])
        resultado.resumen   = data.get("resumen", "")
        resultado.sentimiento = data.get("sentimiento", "neutro")

    except json.JSONDecodeError:
        log.warning("Ollama no devolvió JSON válido — usando spaCy como fallback")
        resultado = extraer_entidades_spacy(texto)
    except Exception as e:
        log.error("Error en Ollama NLP", error=str(e))
        resultado = extraer_entidades_spacy(texto)

    return resultado
