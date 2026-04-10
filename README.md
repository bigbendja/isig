# SIGINT DataCenter Pro

Sistema integral de gestión de inteligencia competitiva y análisis de entidades.

## Estructura del proyecto

```
sigint/
├── docker-compose.yml          # Orquestación de todos los servicios
├── .env.example                # Plantilla de configuración (copiar a .env)
├── .gitignore
│
├── config/
│   └── postgresql.conf         # Configuración optimizada de PostgreSQL
│
├── database/
│   ├── migrations/
│   │   └── 001_schema_inicial.sql   # Esquema completo v2
│   ├── seeds/
│   │   └── (datos iniciales de catálogos)
│   └── neo4j/
│       └── init.cypher         # Constraints e índices Neo4j
│
├── scripts/
│   ├── install.sh              # Instalación inicial (ejecutar una vez)
│   ├── start.sh                # Arrancar el sistema
│   ├── stop.sh                 # Parar el sistema
│   ├── status.sh               # Ver estado de todos los servicios
│   └── backup.sh               # Backup completo de datos
│
├── data/                       # Datos persistentes (no en git)
│   └── uploads/                # Archivos subidos por usuarios
│
├── logs/                       # Logs de la aplicación
│
└── backups/                    # Backups generados por backup.sh
```

## Servicios incluidos

| Servicio | Puerto | Descripción |
|----------|--------|-------------|
| PostgreSQL 16 + PostGIS | 5432 | Motor relacional principal |
| Neo4j 5 Community | 7474 (UI), 7687 (Bolt) | Base de datos de grafo |
| Redis 7 | 6379 | Caché, sesiones, colas |
| Ollama | 11434 | Servidor de modelos LLM locales |
| Adminer (dev) | 8080 | UI de administración PostgreSQL |
| Redis Commander (dev) | 8081 | UI de administración Redis |

## Instalación rápida

```bash
# 1. Clonar el repositorio
git clone https://github.com/tu-org/sigint.git
cd sigint

# 2. Dar permisos a los scripts
chmod +x scripts/*.sh

# 3. Instalar (genera .env, descarga imágenes)
./scripts/install.sh

# 4. Arrancar
./scripts/start.sh

# 5. Ver estado
./scripts/status.sh
```

## Modos de despliegue

### Modo local (desarrollo / uso personal)
```bash
./scripts/start.sh
# Acceso: http://localhost:3000 (cuando el frontend esté disponible)
```

### Modo servidor (producción self-hosted)
```bash
# En el servidor (Ubuntu 22.04):
APP_ENV=production docker compose up -d

# Con nginx y SSL (ver docs/servidor.md)
```

## Modelos LLM disponibles

El sistema es agnóstico al modelo. Configurar en `.env`:

| Variable | Descripción | Default |
|----------|-------------|---------|
| `OLLAMA_MODEL_DEFAULT` | Modelo para la mayoría de tareas | `qwen2.5:7b` |
| `OLLAMA_MODEL_ANALYSIS` | Análisis profundo de expedientes | `qwen2.5:14b` |
| `OLLAMA_MODEL_EMBEDDINGS` | Generación de embeddings | `nomic-embed-text` |

Todos los modelos deben tener licencia Apache 2.0 o MIT para uso comercial.

Para cambiar el modelo sin reiniciar:
```bash
# Descargar un modelo nuevo
docker exec sigint_ollama ollama pull mistral:7b

# Actualizar OLLAMA_MODEL_DEFAULT en .env y reiniciar solo el backend
```

## Política de routing de IA

Los datos clasificados NUNCA van a APIs externas:

- Nivel 1-2 (público/restringido): OpenAI, Anthropic, cualquier API externa ✓
- Nivel 3 (confidencial): Solo modelos locales (Ollama) ✗ APIs externas
- Nivel 4-5 (secreto/top secret): Solo modelos locales en hardware controlado ✗ APIs

Configurar en `.env`:
```
AI_MAX_LEVEL_EXTERNAL_API=2
AI_LOCAL_MODEL_CLASSIFIED=qwen2.5:14b
```

## Backup y recuperación

```bash
# Backup manual
./scripts/backup.sh

# Los backups se guardan en ./backups/YYYYMMDD_HHMMSS/

# Restaurar PostgreSQL
docker compose exec -T postgres pg_restore \
  -U $POSTGRES_USER -d $POSTGRES_DB \
  < backups/20260329_120000/postgres_sigint.dump
```

## Roadmap de fases

- [x] Fase 0: Diseño y especificación
- [x] Fase 1: Infraestructura base (este entregable)
- [ ] Fase 2: Backend API (FastAPI + Auth + Scoring básico)
- [ ] Fase 3: Dashboard core (React + TypeScript)
- [ ] Fase 4: Mapa + Grafo de vínculos
- [ ] Fase 5: Capa de IA (LLM Gateway)
- [ ] Fase 6: Pipeline OSINT
- [ ] Fase 7: ML avanzado + Analytics
- [ ] Fase 8: Hardening + Producción

## Licencias

- PostgreSQL: PostgreSQL License (libre para uso comercial)
- Neo4j Community: GPL v3 (libre para uso no comercial; Enterprise para comercial)
- Redis: RSALv2 / SSPLv1 (revisar para uso comercial)
- Ollama: MIT
- Modelos LLM: Apache 2.0 (Qwen2.5, Mistral) — verificar antes de producción
