FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev g++ \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p /app/models

RUN useradd -m -u 1002 mluser && chown -R mluser:mluser /app
USER mluser

CMD ["python", "-m", "ml.inference.scheduler"]
