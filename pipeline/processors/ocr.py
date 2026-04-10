# pipeline/processors/ocr.py
# ============================================================
# Procesador OCR — extrae texto de PDFs e imágenes
# Tesseract + pdfplumber para documentos físicos digitalizados
# ============================================================
import io
import re
import tempfile
from pathlib import Path
from typing import NamedTuple

import structlog

log = structlog.get_logger()


class ResultadoOCR(NamedTuple):
    texto:       str
    paginas:     int
    confianza:   float    # 0.0 a 1.0
    metadatos:   dict


def extraer_texto_pdf(ruta_o_bytes: str | bytes) -> ResultadoOCR:
    """
    Extrae texto de un PDF.
    Primero intenta extracción directa (PDF con texto seleccionable).
    Si falla o el texto es escaso, usa OCR con Tesseract.
    """
    try:
        import pdfplumber

        if isinstance(ruta_o_bytes, bytes):
            pdf_io = io.BytesIO(ruta_o_bytes)
        else:
            pdf_io = open(ruta_o_bytes, 'rb')

        texto_total = []
        metadatos   = {}
        paginas     = 0

        with pdfplumber.open(pdf_io) as pdf:
            paginas   = len(pdf.pages)
            metadatos = pdf.metadata or {}

            for page in pdf.pages:
                texto_pagina = page.extract_text()
                if texto_pagina:
                    texto_total.append(texto_pagina)

        texto_limpio = '\n'.join(texto_total).strip()

        # Si el texto extraído es muy escaso, intentar OCR
        palabras_por_pagina = len(texto_limpio.split()) / max(paginas, 1)
        if palabras_por_pagina < 10:
            log.info("PDF parece escaneado, intentando OCR")
            texto_ocr = _ocr_pdf(ruta_o_bytes if isinstance(ruta_o_bytes, str) else io.BytesIO(ruta_o_bytes))
            if len(texto_ocr.split()) > len(texto_limpio.split()):
                return ResultadoOCR(
                    texto=texto_ocr,
                    paginas=paginas,
                    confianza=0.7,
                    metadatos=metadatos,
                )

        return ResultadoOCR(
            texto=texto_limpio,
            paginas=paginas,
            confianza=0.95 if texto_limpio else 0.0,
            metadatos=metadatos,
        )

    except Exception as e:
        log.error("Error extrayendo texto PDF", error=str(e))
        return ResultadoOCR(texto='', paginas=0, confianza=0.0, metadatos={})


def _ocr_pdf(ruta_o_io) -> str:
    """OCR de un PDF página por página con Tesseract."""
    try:
        from pdf2image import convert_from_path, convert_from_bytes
        import pytesseract

        if isinstance(ruta_o_io, str):
            imagenes = convert_from_path(ruta_o_io, dpi=200)
        else:
            contenido = ruta_o_io.read() if hasattr(ruta_o_io, 'read') else ruta_o_io
            imagenes = convert_from_bytes(contenido, dpi=200)

        textos = []
        for img in imagenes[:20]:  # máximo 20 páginas por OCR
            texto = pytesseract.image_to_string(
                img,
                lang='spa+eng',  # español + inglés
                config='--oem 3 --psm 6',
            )
            if texto.strip():
                textos.append(texto)

        return '\n'.join(textos)

    except ImportError:
        log.warning("pdf2image o pytesseract no disponibles")
        return ''
    except Exception as e:
        log.error("Error en OCR", error=str(e))
        return ''


def extraer_texto_imagen(ruta_o_bytes: str | bytes, idiomas: str = 'spa+eng') -> ResultadoOCR:
    """OCR directo sobre una imagen (JPG, PNG, TIFF)."""
    try:
        import pytesseract
        from PIL import Image

        if isinstance(ruta_o_bytes, bytes):
            img = Image.open(io.BytesIO(ruta_o_bytes))
        else:
            img = Image.open(ruta_o_bytes)

        texto = pytesseract.image_to_string(
            img,
            lang=idiomas,
            config='--oem 3 --psm 6',
        )

        # Calcular confianza aproximada
        datos = pytesseract.image_to_data(img, lang=idiomas, output_type=pytesseract.Output.DICT)
        confianzas = [int(c) for c in datos['conf'] if c != '-1']
        confianza_media = (sum(confianzas) / len(confianzas) / 100) if confianzas else 0.5

        return ResultadoOCR(
            texto=texto.strip(),
            paginas=1,
            confianza=confianza_media,
            metadatos={"formato": img.format, "modo": img.mode, "tamaño": img.size},
        )

    except ImportError:
        log.warning("pytesseract o Pillow no disponibles")
        return ResultadoOCR(texto='', paginas=0, confianza=0.0, metadatos={})
    except Exception as e:
        log.error("Error OCR imagen", error=str(e))
        return ResultadoOCR(texto='', paginas=0, confianza=0.0, metadatos={})


def limpiar_texto_ocr(texto: str) -> str:
    """
    Limpia artefactos comunes del OCR:
    caracteres extraños, saltos de línea incorrectos, etc.
    """
    if not texto:
        return ''

    # Eliminar caracteres raros de OCR
    texto = re.sub(r'[|}{~`^<>\\]', ' ', texto)
    # Corregir guiones de final de línea (palabras partidas)
    texto = re.sub(r'-\n(\w)', r'\1', texto)
    # Normalizar espacios
    texto = re.sub(r'[ \t]+', ' ', texto)
    # Normalizar saltos de línea
    texto = re.sub(r'\n{3,}', '\n\n', texto)

    return texto.strip()
