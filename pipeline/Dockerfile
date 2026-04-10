FROM python:3.11-slim

WORKDIR /app

# Dependencias del sistema para OCR y NLP
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev \
    tesseract-ocr tesseract-ocr-spa tesseract-ocr-eng \
    poppler-utils \
    libxml2-dev libxslt1-dev \
    && rm -rf /var/lib/apt/lists/*

# Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Descargar modelo spaCy español
RUN python -m spacy download es_core_news_sm || echo "spaCy model no disponible"

COPY . .

# Usuario no-root
RUN useradd -m -u 1001 pipeline && chown -R pipeline:pipeline /app
USER pipeline

CMD ["python", "runner.py"]
