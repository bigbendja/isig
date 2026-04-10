# app/api/v1/endpoints/archivos.py
# ============================================================
# Repositorio documental con OCR y extracción de inteligencia
# ============================================================
import hashlib
import io
import json
import os
from pathlib import Path
from uuid import UUID, uuid4

import structlog
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import CurrentUser, get_current_user, get_db_session, require_nivel
from app.schemas import SuccessResponse

log = structlog.get_logger()
router = APIRouter(prefix="/archivos", tags=["Archivos / Repositorio"])

UPLOAD_DIR = Path("/app/uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

TIPOS_DOCUMENTO = [
    "factura", "contrato", "informe", "noticia", "acta_minuta",
    "resolucion_oficial", "extracto_bancario", "documento_identidad",
    "expediente", "comunicacion_interna", "presupuesto", "escritura_notarial",
    "sentencia_judicial", "licencia_permiso", "otro",
]

TIPO_LABEL = {
    "factura": "Factura", "contrato": "Contrato", "informe": "Informe",
    "noticia": "Noticia / Artículo", "acta_minuta": "Acta / Minuta",
    "resolucion_oficial": "Resolución oficial", "extracto_bancario": "Extracto bancario",
    "documento_identidad": "Documento de identidad", "expediente": "Expediente",
    "comunicacion_interna": "Comunicación interna", "presupuesto": "Presupuesto",
    "escritura_notarial": "Escritura notarial", "sentencia_judicial": "Sentencia judicial",
    "licencia_permiso": "Licencia / Permiso", "otro": "Otro",
}


# ── MIGRACIÓN DINÁMICA ────────────────────────────────────────

_tables_created = False

async def ensure_tables(db: AsyncSession):
    """Crea tablas de repositorio si no existen (ejecutadas por separado)."""
    global _tables_created
    if _tables_created:
        return
    await db.execute(text("""
        CREATE TABLE IF NOT EXISTS core.repositorio_carpetas (
            id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            nombre      VARCHAR(255) NOT NULL,
            parent_id   UUID REFERENCES core.repositorio_carpetas(id) ON DELETE CASCADE,
            descripcion TEXT,
            nivel_acceso SMALLINT DEFAULT 1,
            created_by  UUID,
            created_at  TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(nombre, parent_id)
        )
    """))
    await db.execute(text("""
        CREATE TABLE IF NOT EXISTS core.repositorio_archivos (
            id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            carpeta_id      UUID REFERENCES core.repositorio_carpetas(id) ON DELETE SET NULL,
            nombre          VARCHAR(500) NOT NULL,
            nombre_original VARCHAR(500),
            tipo_documento  VARCHAR(80),
            tipo_mime       VARCHAR(100),
            extension       VARCHAR(20),
            tamano_bytes    BIGINT,
            hash_sha256     CHAR(64),
            descripcion     TEXT,
            storage_path    TEXT NOT NULL,
            nivel_acceso    SMALLINT DEFAULT 1,
            entidad_tipo    VARCHAR(20),
            entidad_id      UUID,
            investigacion_id UUID,
            estado_proceso  VARCHAR(20) DEFAULT 'pendiente',
            texto_extraido  TEXT,
            entidades_extraidas JSONB DEFAULT '[]',
            procesado_at    TIMESTAMPTZ,
            created_by      UUID,
            created_at      TIMESTAMPTZ DEFAULT NOW()
        )
    """))
    _tables_created = True


# ── CARPETAS ──────────────────────────────────────────────────

@router.get("/carpetas")
async def listar_carpetas(
    parent_id: str | None = None,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    await ensure_tables(db)
    if parent_id:
        result = await db.execute(text("""
            SELECT c.*,
                (SELECT COUNT(*) FROM core.repositorio_carpetas sc WHERE sc.parent_id = c.id) AS subcarpetas,
                (SELECT COUNT(*) FROM core.repositorio_archivos a WHERE a.carpeta_id = c.id) AS archivos
            FROM core.repositorio_carpetas c
            WHERE c.parent_id = :pid
            ORDER BY c.nombre
        """), {"pid": parent_id})
    else:
        result = await db.execute(text("""
            SELECT c.*,
                (SELECT COUNT(*) FROM core.repositorio_carpetas sc WHERE sc.parent_id = c.id) AS subcarpetas,
                (SELECT COUNT(*) FROM core.repositorio_archivos a WHERE a.carpeta_id = c.id) AS archivos
            FROM core.repositorio_carpetas c
            WHERE c.parent_id IS NULL
            ORDER BY c.nombre
        """))
    return [dict(r._mapping) for r in result.fetchall()]


@router.post("/carpetas")
async def crear_carpeta(
    body: dict,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    await ensure_tables(db)
    nombre = body.get("nombre", "").strip()
    if not nombre:
        raise HTTPException(status_code=400, detail="Nombre requerido")

    cid = uuid4()
    try:
        await db.execute(text("""
            INSERT INTO core.repositorio_carpetas
                (id, nombre, parent_id, descripcion, nivel_acceso, created_by)
            VALUES (:id, :nombre, :parent_id, :desc, :nivel, :uid)
        """), {
            "id": cid,
            "nombre": nombre,
            "parent_id": body.get("parent_id"),
            "desc": body.get("descripcion"),
            "nivel": body.get("nivel_acceso", 1),
            "uid": current_user.id,
        })
    except Exception:
        raise HTTPException(status_code=409, detail="Ya existe una carpeta con ese nombre aquí")
    return {"id": str(cid), "nombre": nombre}


@router.delete("/carpetas/{carpeta_id}")
async def eliminar_carpeta(
    carpeta_id: UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    await db.execute(text("DELETE FROM core.repositorio_carpetas WHERE id = :id"), {"id": carpeta_id})
    return SuccessResponse(message="Carpeta eliminada")


# ── ARCHIVOS ──────────────────────────────────────────────────

@router.get("")
async def listar_archivos(
    carpeta_id: str | None = None,
    buscar: str | None = None,
    tipo_documento: str | None = None,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    await ensure_tables(db)
    conditions = ["1=1"]
    params: dict = {}

    if carpeta_id:
        conditions.append("a.carpeta_id = :carpeta_id")
        params["carpeta_id"] = carpeta_id
    elif carpeta_id is None and buscar is None:
        conditions.append("a.carpeta_id IS NULL")

    if buscar:
        conditions.append("(a.nombre ILIKE :buscar OR a.descripcion ILIKE :buscar OR a.texto_extraido ILIKE :buscar)")
        params["buscar"] = f"%{buscar}%"

    if tipo_documento:
        conditions.append("a.tipo_documento = :tipo_documento")
        params["tipo_documento"] = tipo_documento

    where = " AND ".join(conditions)
    result = await db.execute(text(f"""
        SELECT a.*,
               c.nombre AS carpeta_nombre
        FROM core.repositorio_archivos a
        LEFT JOIN core.repositorio_carpetas c ON a.carpeta_id = c.id
        WHERE {where}
        ORDER BY a.created_at DESC
        LIMIT 100
    """), params)

    rows = []
    for r in result.fetchall():
        d = dict(r._mapping)
        for k, v in d.items():
            if hasattr(v, 'isoformat'):
                d[k] = v.isoformat()
        rows.append(d)
    return rows


@router.post("/upload")
async def subir_archivo(
    archivo: UploadFile = File(...),
    carpeta_id: str | None = Form(None),
    tipo_documento: str = Form("otro"),
    descripcion: str | None = Form(None),
    nivel_acceso: int = Form(1),
    entidad_tipo: str | None = Form(None),
    entidad_id: str | None = Form(None),
    investigacion_id: str | None = Form(None),
    procesar_automatico: bool = Form(False),
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    await ensure_tables(db)

    contenido = await archivo.read()
    if len(contenido) > 50 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Archivo demasiado grande (máx. 50MB)")

    # Hash para deduplicación
    sha256 = hashlib.sha256(contenido).hexdigest()

    # Guardar en disco
    ext = Path(archivo.filename or "").suffix.lower()
    file_id = uuid4()
    storage_path = str(UPLOAD_DIR / f"{file_id}{ext}")
    with open(storage_path, "wb") as f:
        f.write(contenido)

    # Extraer texto básico si es PDF
    texto_extraido = None
    estado = "sin_procesar"

    if ext == ".pdf":
        try:
            import pdfplumber
            with pdfplumber.open(io.BytesIO(contenido)) as pdf:
                paginas = [p.extract_text() or "" for p in pdf.pages[:20]]
                texto_extraido = "\n".join(paginas).strip()[:50000]
                if texto_extraido:
                    estado = "texto_extraido"
        except Exception as e:
            log.warning("pdfplumber falló", error=str(e))
    elif ext in (".txt", ".md", ".csv"):
        try:
            texto_extraido = contenido.decode("utf-8", errors="ignore")[:50000]
            estado = "texto_extraido"
        except Exception:
            pass

    # Guardar en BD
    await db.execute(text("""
        INSERT INTO core.repositorio_archivos
            (id, carpeta_id, nombre, nombre_original, tipo_documento, tipo_mime,
             extension, tamano_bytes, hash_sha256, descripcion, storage_path,
             nivel_acceso, entidad_tipo, entidad_id, investigacion_id,
             estado_proceso, texto_extraido, created_by)
        VALUES
            (:id, :carpeta_id, :nombre, :nombre_original, :tipo_doc, :mime,
             :ext, :tamano, :hash, :desc, :path,
             :nivel, :entidad_tipo, :entidad_id, :inv_id,
             :estado, :texto, :uid)
    """), {
        "id": file_id,
        "carpeta_id": carpeta_id if carpeta_id else None,
        "nombre": archivo.filename,
        "nombre_original": archivo.filename,
        "tipo_doc": tipo_documento,
        "mime": archivo.content_type,
        "ext": ext.lstrip("."),
        "tamano": len(contenido),
        "hash": sha256,
        "desc": descripcion,
        "path": storage_path,
        "nivel": nivel_acceso,
        "entidad_tipo": entidad_tipo if entidad_tipo else None,
        "entidad_id": entidad_id if entidad_id else None,
        "inv_id": investigacion_id if investigacion_id else None,
        "estado": estado,
        "texto": texto_extraido,
        "uid": current_user.id,
    })

    return {
        "id": str(file_id),
        "nombre": archivo.filename,
        "estado": estado,
        "texto_extraido": bool(texto_extraido),
        "tamano_bytes": len(contenido),
    }


@router.get("/kpis")
async def archivos_kpis(
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    await ensure_tables(db)
    result = await db.execute(text("""
        SELECT
            COUNT(*) AS total_archivos,
            COUNT(*) FILTER (WHERE estado_proceso = 'sin_procesar') AS sin_procesar,
            COUNT(*) FILTER (WHERE estado_proceso = 'texto_extraido') AS con_texto,
            COUNT(*) FILTER (WHERE estado_proceso = 'procesado') AS procesados,
            COALESCE(SUM(tamano_bytes), 0) AS total_bytes,
            COUNT(DISTINCT tipo_documento) AS tipos_distintos
        FROM core.repositorio_archivos
    """))
    kpis = dict(result.fetchone()._mapping)

    carpetas = await db.execute(text("SELECT COUNT(*) FROM core.repositorio_carpetas"))
    kpis["total_carpetas"] = carpetas.scalar() or 0
    kpis["total_mb"] = round((kpis.get("total_bytes", 0) or 0) / 1024 / 1024, 1)

    por_tipo = await db.execute(text("""
        SELECT tipo_documento, COUNT(*) AS total
        FROM core.repositorio_archivos
        GROUP BY tipo_documento ORDER BY total DESC LIMIT 8
    """))
    kpis["por_tipo"] = [dict(r._mapping) for r in por_tipo.fetchall()]

    return kpis


@router.delete("/{archivo_id}")
async def eliminar_archivo(
    archivo_id: UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    result = await db.execute(
        text("DELETE FROM core.repositorio_archivos WHERE id = :id RETURNING storage_path"),
        {"id": archivo_id}
    )
    row = result.fetchone()
    if row and os.path.exists(row.storage_path):
        try:
            os.remove(row.storage_path)
        except Exception:
            pass
    return SuccessResponse(message="Archivo eliminado")


@router.get("/{archivo_id}/texto")
async def obtener_texto(
    archivo_id: UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    result = await db.execute(
        text("SELECT nombre, texto_extraido, entidades_extraidas, estado_proceso FROM core.repositorio_archivos WHERE id = :id"),
        {"id": archivo_id}
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Archivo no encontrado")
    return dict(row._mapping)
