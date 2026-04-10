# ml/training/features.py
# ============================================================
# Ingeniería de características para el modelo de scoring
# Extrae features de PostgreSQL y las transforma para XGBoost
# ============================================================
import json
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd
import structlog

log = structlog.get_logger()


# ── DEFINICIÓN DE FEATURES ────────────────────────────────────

# Cada feature tiene nombre, descripción, y cómo se extrae
FEATURES_PERSONA = [
    # Binarias (0/1)
    ("es_pep",                "Es persona políticamente expuesta"),
    ("en_lista_vigilancia",   "Está en lista de vigilancia interna"),
    ("en_lista_ofac",         "Aparece en lista OFAC"),
    ("en_lista_eu",           "Aparece en lista sanciones UE"),
    ("en_lista_onu",          "Aparece en lista sanciones ONU"),
    ("tiene_email",           "Tiene email registrado"),
    ("tiene_telefono",        "Tiene teléfono registrado"),
    ("tiene_empresa",         "Tiene empresa asociada"),
    ("tiene_ubicacion",       "Tiene geolocalización registrada"),
    ("tiene_patrimonio",      "Tiene estimación de patrimonio"),
    ("cotiza_empresa",        "Su empresa cotiza en bolsa"),

    # Numéricas continuas
    ("nivel_pep",             "Nivel PEP (1-3, 0 si no es PEP)"),
    ("nivel_prioridad",       "Prioridad asignada manualmente (1-5)"),
    ("score_influencia",      "Score PageRank del grafo (0-1)"),
    ("completitud",           "% de campos completados (0-100)"),
    ("nivel_confianza_global","Confianza media del expediente (1-5)"),
    ("patrimonio_log",        "Log del patrimonio estimado (normalizado)"),
    ("num_listas_externas",   "Número de listas externas en las que aparece"),
    ("num_alias",             "Número de alias conocidos"),
    ("num_vinculos",          "Número de vínculos activos en el grafo"),
    ("num_vinculos_alto_riesgo", "Vínculos con entidades de riesgo alto (>0.5)"),
    ("num_eventos",           "Número de eventos registrados"),
    ("num_alertas_30d",       "Alertas OSINT en los últimos 30 días"),
    ("diasdesde_actualizacion","Días desde última actualización del expediente"),
    ("nivel_acceso_requerido","Nivel de clasificación del expediente"),
]

FEATURES_INSTITUCION = [
    ("en_lista_vigilancia",  "Lista interna de vigilancia"),
    ("en_lista_ofac",        "Lista OFAC"),
    ("en_lista_eu",          "Sanciones UE"),
    ("cotiza_bolsa",         "Cotiza en bolsas"),
    ("tiene_sede",           "Tiene geolocalización de sede"),
    ("tiene_web",            "Tiene web corporativa"),
    ("nivel_prioridad",      "Prioridad asignada"),
    ("score_influencia",     "Influencia en el grafo"),
    ("completitud",          "Completitud del expediente"),
    ("num_listas_externas",  "Número de listas externas"),
    ("num_vinculos",         "Número de vínculos"),
    ("num_vinculos_alto_riesgo", "Vínculos con entidades de riesgo alto"),
    ("num_filiales",         "Número de filiales"),
    ("num_directivos",       "Directivos en el expediente extendido"),
    ("num_alertas_30d",      "Alertas recientes"),
    ("num_litigios",         "Litigios activos en perfil extendido"),
    ("facturacion_log",      "Log de facturación (normalizado)"),
    ("nivel_acceso_requerido","Nivel de clasificación"),
]


# ── EXTRACTOR DE FEATURES ─────────────────────────────────────

class FeatureExtractor:
    """
    Extrae y transforma features de las entidades PostgreSQL.
    Diseñado para funcionar con datos reales de la BD.
    """

    def __init__(self):
        self.feature_names_persona     = [f[0] for f in FEATURES_PERSONA]
        self.feature_names_institucion = [f[0] for f in FEATURES_INSTITUCION]

    def extract_persona_features(self, row: dict) -> dict[str, float]:
        """Extrae features de una fila de core.personas."""
        ext = row.get('perfil_extendido') or {}
        if isinstance(ext, str):
            try:
                ext = json.loads(ext)
            except Exception:
                ext = {}

        listas = row.get('listas_externas') or []
        alias  = row.get('alias') or []

        # Patrimonio en log scale (evita outliers extremos)
        patrimonio = float(row.get('patrimonio_est') or 0)
        patrimonio_log = float(np.log1p(patrimonio / 1_000_000)) if patrimonio > 0 else 0.0

        # Días desde última actualización
        from datetime import datetime, timezone
        updated_at = row.get('updated_at')
        if updated_at and hasattr(updated_at, 'timestamp'):
            dias_upd = (datetime.now(timezone.utc) - updated_at.replace(tzinfo=timezone.utc)).days
        else:
            dias_upd = 365  # default: un año si no hay dato

        return {
            # Binarias
            "es_pep":                 float(bool(row.get('es_pep'))),
            "en_lista_vigilancia":    float(bool(row.get('en_lista_vigilancia'))),
            "en_lista_ofac":          float('OFAC' in listas),
            "en_lista_eu":            float('EU' in listas or 'UE' in listas),
            "en_lista_onu":           float('ONU' in listas or 'UN' in listas),
            "tiene_email":            float(bool(row.get('email_principal'))),
            "tiene_telefono":         float(bool(row.get('telefono_principal'))),
            "tiene_empresa":          float(bool(row.get('empresa_actual'))),
            "tiene_ubicacion":        float(bool(row.get('ubicacion_actual'))),
            "tiene_patrimonio":       float(bool(row.get('patrimonio_est'))),
            "cotiza_empresa":         float(bool(ext.get('empresa_cotiza', {}).get('valor'))),

            # Numéricas
            "nivel_pep":              float(row.get('nivel_pep') or 0),
            "nivel_prioridad":        float(row.get('nivel_prioridad') or 1),
            "score_influencia":       float(row.get('score_influencia') or 0),
            "completitud":            float(row.get('completitud') or 0) / 100.0,
            "nivel_confianza_global": float(row.get('nivel_confianza_global') or 3) / 5.0,
            "patrimonio_log":         patrimonio_log,
            "num_listas_externas":    float(len(listas)),
            "num_alias":              float(len(alias)),
            "num_vinculos":           float(row.get('_num_vinculos') or 0),
            "num_vinculos_alto_riesgo": float(row.get('_vinculos_alto_riesgo') or 0),
            "num_eventos":            float(row.get('_num_eventos') or 0),
            "num_alertas_30d":        float(row.get('_num_alertas') or 0),
            "diasdesde_actualizacion": min(float(dias_upd), 365.0) / 365.0,
            "nivel_acceso_requerido": float(row.get('nivel_acceso_requerido') or 1) / 5.0,
        }

    def extract_institucion_features(self, row: dict) -> dict[str, float]:
        ext     = row.get('perfil_extendido') or {}
        listas  = row.get('listas_externas') or []
        factura = float(row.get('facturacion_anual') or 0)

        from datetime import datetime, timezone
        updated_at = row.get('updated_at')
        dias_upd = 365
        if updated_at and hasattr(updated_at, 'timestamp'):
            dias_upd = (datetime.now(timezone.utc) - updated_at.replace(tzinfo=timezone.utc)).days

        # Extraer datos de campos extendidos
        directivos = ext.get('equipo_directivo', {}).get('valor') or []
        litigios   = ext.get('litigios_activos', {}).get('valor') or []

        return {
            "en_lista_vigilancia":    float(bool(row.get('en_lista_vigilancia'))),
            "en_lista_ofac":          float('OFAC' in listas),
            "en_lista_eu":            float('EU' in listas or 'UE' in listas),
            "cotiza_bolsa":           float(bool(row.get('cotiza_bolsa'))),
            "tiene_sede":             float(bool(row.get('sede_coords'))),
            "tiene_web":              float(bool(row.get('web_principal'))),
            "nivel_prioridad":        float(row.get('nivel_prioridad') or 1),
            "score_influencia":       float(row.get('score_influencia') or 0),
            "completitud":            float(row.get('completitud') or 0) / 100.0,
            "num_listas_externas":    float(len(listas)),
            "num_vinculos":           float(row.get('_num_vinculos') or 0),
            "num_vinculos_alto_riesgo": float(row.get('_vinculos_alto_riesgo') or 0),
            "num_filiales":           float(len(row.get('filiales') or [])),
            "num_directivos":         float(len(directivos) if isinstance(directivos, list) else 0),
            "num_alertas_30d":        float(row.get('_num_alertas') or 0),
            "num_litigios":           float(len(litigios) if isinstance(litigios, list) else 0),
            "facturacion_log":        float(np.log1p(factura / 1_000_000)) if factura > 0 else 0.0,
            "nivel_acceso_requerido": float(row.get('nivel_acceso_requerido') or 1) / 5.0,
        }

    def features_to_array(
        self,
        features: dict[str, float],
        tipo: str = 'persona',
    ) -> np.ndarray:
        names = (self.feature_names_persona
                 if tipo == 'persona'
                 else self.feature_names_institucion)
        return np.array([features.get(n, 0.0) for n in names], dtype=np.float32)

    def dataframe_from_rows(
        self,
        rows: list[dict],
        tipo: str = 'persona',
    ) -> pd.DataFrame:
        """Convierte una lista de filas de BD a un DataFrame de features."""
        extractor = (self.extract_persona_features
                     if tipo == 'persona'
                     else self.extract_institucion_features)
        data = [extractor(r) for r in rows]
        return pd.DataFrame(data)


extractor = FeatureExtractor()
