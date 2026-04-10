# app/schemas/
# ============================================================
# Schemas Pydantic v2 — validación y serialización
# ============================================================
from __future__ import annotations

from datetime import date, datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, field_validator


# ── BASE ──────────────────────────────────────────────────────

class SIGINTBase(BaseModel):
    model_config = {"from_attributes": True, "populate_by_name": True}


# ============================================================
# AUTH
# ============================================================

class LoginRequest(SIGINTBase):
    username: str = Field(min_length=3, max_length=80)
    password: str = Field(min_length=8)
    totp_code: str | None = Field(None, min_length=6, max_length=6)


class TokenResponse(SIGINTBase):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    usuario: "UsuarioPublico"


class RefreshRequest(SIGINTBase):
    refresh_token: str


class Setup2FAResponse(SIGINTBase):
    qr_image_b64: str      # QR en base64 para mostrar en el frontend
    secret: str            # secret para introducir manualmente


class Verify2FARequest(SIGINTBase):
    code: str = Field(min_length=6, max_length=6)


class ChangePasswordRequest(SIGINTBase):
    current_password: str
    new_password: str = Field(min_length=12)


# ============================================================
# USUARIOS
# ============================================================

class UsuarioCreate(SIGINTBase):
    username: str = Field(min_length=3, max_length=80)
    email: EmailStr
    password: str = Field(min_length=12)
    nombre_completo: str | None = None
    rol_id: int = Field(ge=1, le=6)
    idioma: str = "es"
    zona_horaria: str = "Africa/Malabo"


class UsuarioUpdate(SIGINTBase):
    nombre_completo: str | None = None
    email: EmailStr | None = None
    idioma: str | None = None
    zona_horaria: str | None = None
    preferencias: dict[str, Any] | None = None
    activo: bool | None = None
    bloqueado: bool | None = None
    rol_id: int | None = None


class UsuarioPublico(SIGINTBase):
    id: UUID
    username: str
    email: str
    nombre_completo: str | None
    rol_id: int
    nivel_acceso: int
    activo: bool
    ultimo_login: datetime | None
    created_at: datetime


class UsuarioDetalle(UsuarioPublico):
    bloqueado: bool
    totp_activo: bool
    idioma: str
    zona_horaria: str
    preferencias: dict[str, Any]


# ============================================================
# PERSONAS
# ============================================================

class PersonaCreate(SIGINTBase):
    nombre_completo: str = Field(min_length=2, max_length=255)
    nombres: str | None = None
    apellidos: str | None = None
    alias: list[str] | None = None
    genero: str | None = None
    fecha_nacimiento: date | None = None
    lugar_nacimiento: str | None = None
    nacionalidad: str | None = Field(None, min_length=2, max_length=2)
    otras_nacs: list[str] | None = None
    estado_civil: str | None = None
    idiomas: list[str] | None = None
    email_principal: EmailStr | None = None
    telefono_principal: str | None = None
    pais_residencia: str | None = Field(None, min_length=2, max_length=2)
    ciudad_residencia: str | None = None
    direccion_principal: str | None = None
    cargo_actual: str | None = None
    empresa_actual: UUID | None = None
    sector_principal: str | None = None
    es_pep: bool = False
    nivel_pep: int | None = Field(None, ge=1, le=3)
    nivel_acceso_requerido: int = Field(1, ge=1, le=5)
    fuente_primaria: str | None = None
    # Cualquier campo adicional va aquí
    perfil_extendido: dict[str, Any] | None = None


class PersonaUpdate(SIGINTBase):
    nombre_completo: str | None = None
    nombres: str | None = None
    apellidos: str | None = None
    alias: list[str] | None = None
    genero: str | None = None
    fecha_nacimiento: date | None = None
    nacionalidad: str | None = None
    estado_civil: str | None = None
    idiomas: list[str] | None = None
    email_principal: EmailStr | None = None
    telefono_principal: str | None = None
    pais_residencia: str | None = None
    ciudad_residencia: str | None = None
    direccion_principal: str | None = None
    cargo_actual: str | None = None
    empresa_actual: UUID | None = None
    sector_principal: str | None = None
    es_pep: bool | None = None
    nivel_pep: int | None = None
    nivel_riqueza: str | None = None
    patrimonio_est: float | None = None
    en_lista_vigilancia: bool | None = None
    listas_externas: list[str] | None = None
    nivel_prioridad: int | None = Field(None, ge=1, le=5)
    nivel_acceso_requerido: int | None = Field(None, ge=1, le=5)
    perfil_extendido: dict[str, Any] | None = None


class PersonaResumen(SIGINTBase):
    """Vista compacta para listas y búsquedas."""
    id: UUID
    nombre_completo: str
    alias: list[str] | None
    cargo_actual: str | None
    empresa_actual: UUID | None
    empresa_nombre: str | None          # join con instituciones
    ciudad_residencia: str | None
    pais_residencia: str | None
    es_pep: bool
    en_lista_vigilancia: bool
    score_riesgo: float
    nivel_prioridad: int
    completitud: float
    nivel_acceso_requerido: int
    created_at: datetime
    updated_at: datetime


class PersonaDetalle(PersonaResumen):
    """Vista completa — los campos sensibles solo se incluyen si el usuario tiene nivel."""
    nombres: str | None
    apellidos: str | None
    genero: str | None
    fecha_nacimiento: date | None
    lugar_nacimiento: str | None
    fecha_fallecimiento: date | None
    nacionalidad: str | None
    otras_nacs: list[str] | None
    estado_civil: str | None
    idiomas: list[str] | None
    email_principal: str | None
    telefono_principal: str | None
    direccion_principal: str | None
    sector_principal: str | None
    nivel_pep: int | None
    # Nivel 3+
    nivel_riqueza: str | None
    patrimonio_est: float | None
    ingresos_anuales_est: float | None
    # Nivel 4+
    listas_externas: list[str] | None
    # Siempre
    score_influencia: float
    score_version: int
    fuente_primaria: str | None
    perfil_extendido: dict[str, Any]


# ============================================================
# INSTITUCIONES
# ============================================================

class InstitucionCreate(SIGINTBase):
    nombre: str = Field(min_length=2, max_length=255)
    nombre_corto: str | None = None
    alias: list[str] | None = None
    tipo_entidad: str | None = None
    sector: str | None = None
    subsector: str | None = None
    actividad_desc: str | None = None
    numero_registro: str | None = None
    cif_nif: str | None = None
    pais_registro: str | None = Field(None, min_length=2, max_length=2)
    fecha_fundacion: date | None = None
    estado_legal: str = "activa"
    web_principal: str | None = None
    email_contacto: EmailStr | None = None
    telefono_central: str | None = None
    sede_pais: str | None = Field(None, min_length=2, max_length=2)
    sede_ciudad: str | None = None
    sede_direccion: str | None = None
    paises_operacion: list[str] | None = None
    tipo_propiedad: str | None = None
    cotiza_bolsa: bool = False
    numero_empleados: int | None = None
    nivel_acceso_requerido: int = Field(1, ge=1, le=5)
    fuente_primaria: str | None = None
    perfil_extendido: dict[str, Any] | None = None


class InstitucionUpdate(SIGINTBase):
    nombre: str | None = None
    nombre_corto: str | None = None
    alias: list[str] | None = None
    tipo_entidad: str | None = None
    sector: str | None = None
    estado_legal: str | None = None
    web_principal: str | None = None
    email_contacto: EmailStr | None = None
    sede_ciudad: str | None = None
    paises_operacion: list[str] | None = None
    numero_empleados: int | None = None
    facturacion_anual: float | None = None
    en_lista_vigilancia: bool | None = None
    nivel_prioridad: int | None = Field(None, ge=1, le=5)
    perfil_extendido: dict[str, Any] | None = None


class InstitucionResumen(SIGINTBase):
    id: UUID
    nombre: str
    nombre_corto: str | None
    alias: list[str] | None
    sector: str | None
    tipo_entidad: str | None
    pais_registro: str | None
    sede_ciudad: str | None
    estado_legal: str
    score_riesgo: float
    nivel_prioridad: int
    completitud: float
    nivel_acceso_requerido: int
    created_at: datetime


class InstitucionDetalle(InstitucionResumen):
    subsector: str | None
    actividad_desc: str | None
    numero_registro: str | None
    cif_nif: str | None
    fecha_fundacion: date | None
    web_principal: str | None
    email_contacto: str | None
    telefono_central: str | None
    sede_direccion: str | None
    paises_operacion: list[str] | None
    empresa_matriz: UUID | None
    grupo_empresarial: str | None
    tipo_propiedad: str | None
    cotiza_bolsa: bool
    numero_empleados: int | None
    # Nivel 3+
    capital_social: float | None
    patrimonio_neto: float | None
    facturacion_anual: float | None
    rating_credito: str | None
    # Nivel 4+
    listas_externas: list[str] | None
    score_influencia: float
    fuente_primaria: str | None
    perfil_extendido: dict[str, Any]


# ============================================================
# VÍNCULOS
# ============================================================

class VinculoCreate(SIGINTBase):
    origen_tipo: str = Field(pattern="^(persona|institucion)$")
    origen_id: UUID
    destino_tipo: str = Field(pattern="^(persona|institucion)$")
    destino_id: UUID
    tipo_vinculo_id: int | None = None
    tipo_vinculo_custom: str | None = None
    descripcion: str | None = None
    bidireccional: bool = False
    intensidad: float = Field(0.5, ge=0, le=1)
    frecuencia: str | None = None
    fecha_inicio: date | None = None
    fecha_fin: date | None = None
    fuente: str | None = None
    confianza: int = Field(3, ge=1, le=5)
    nivel_acceso: int = Field(2, ge=1, le=5)


class VinculoResumen(SIGINTBase):
    id: UUID
    origen_tipo: str
    origen_id: UUID
    origen_nombre: str | None
    destino_tipo: str
    destino_id: UUID
    destino_nombre: str | None
    tipo_vinculo_nombre: str | None
    tipo_vinculo_categoria: str | None
    intensidad: float
    vigente: bool
    fecha_inicio: date | None
    confianza: int
    created_at: datetime


# ============================================================
# BÚSQUEDA
# ============================================================

class SearchResult(SIGINTBase):
    tipo: str
    id: UUID
    nombre: str
    subtitulo: str | None
    ciudad: str | None
    score_riesgo: float
    nivel_acceso_requerido: int
    relevancia: float


class SearchResponse(SIGINTBase):
    query: str
    total: int
    resultados: list[SearchResult]
    tiempo_ms: int


# ============================================================
# INVESTIGACIONES
# ============================================================

class InvestigacionCreate(SIGINTBase):
    titulo: str = Field(min_length=5, max_length=500)
    tipo_investigacion: str | None = None
    descripcion: str | None = None
    objetivo: str | None = None
    prioridad: int = Field(3, ge=1, le=5)
    clasificacion: int = Field(2, ge=1, le=5)
    fecha_objetivo: date | None = None
    etiquetas: list[str] | None = None


class InvestigacionResumen(SIGINTBase):
    id: UUID
    codigo: str | None
    titulo: str
    tipo_investigacion: str | None = None
    estado: str
    prioridad: int
    clasificacion: int
    responsable_id: UUID | None
    fecha_apertura: datetime
    fecha_objetivo: date | None
    etiquetas: list[str] | None


# ============================================================
# RESPUESTAS PAGINADAS
# ============================================================

class PaginatedResponse(SIGINTBase):
    total: int
    page: int
    page_size: int
    pages: int
    items: list[Any]


# ============================================================
# UTILIDADES
# ============================================================

class ErrorResponse(SIGINTBase):
    error: str
    detail: str | None = None
    code: str | None = None


class SuccessResponse(SIGINTBase):
    message: str
    data: dict[str, Any] | None = None


class ScoreResponse(SIGINTBase):
    entidad_tipo: str
    entidad_id: UUID
    score_riesgo: float
    score_influencia: float
    version: int
    calculado_at: datetime | None
