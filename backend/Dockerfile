FROM python:3.11-slim

WORKDIR /app

# Dependencias del sistema (psycopg2, Pillow para QR)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev libjpeg-dev zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

# Instalar dependencias Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar código
COPY . .

# Usuario no-root
RUN useradd -m -u 1000 sigint && chown -R sigint:sigint /app
USER sigint

EXPOSE 8000

# Arranque: uvicorn con recarga en desarrollo
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", \
     "--workers", "2", "--loop", "uvloop", "--http", "httptools"]
