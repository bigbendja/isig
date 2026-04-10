# ml/training/risk_model.py
# ============================================================
# Modelo de scoring de riesgo con XGBoost
# Entrenamiento, evaluación, SHAP y persistencia
# ============================================================
import json
import os
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
import shap
import structlog
from sklearn.model_selection import StratifiedKFold, cross_val_score
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import roc_auc_score, classification_report
from xgboost import XGBClassifier

from ml.training.features import extractor, FEATURES_PERSONA, FEATURES_INSTITUCION

log = structlog.get_logger()

MODELS_DIR = Path(__file__).parent.parent / "models"
MODELS_DIR.mkdir(exist_ok=True)


# ── MODELO DE RIESGO ──────────────────────────────────────────

class RiskScoringModel:
    """
    Modelo XGBoost para scoring de riesgo de entidades.
    Produce scores 0.0-1.0 con explicabilidad SHAP.
    """

    def __init__(self, tipo: str = 'persona'):
        self.tipo       = tipo
        self.version    = "1.0"
        self.model:     XGBClassifier | None = None
        self.scaler:    StandardScaler | None = None
        self.explainer: shap.TreeExplainer | None = None
        self.feature_names = (
            [f[0] for f in FEATURES_PERSONA]
            if tipo == 'persona'
            else [f[0] for f in FEATURES_INSTITUCION]
        )
        self.metrics: dict[str, Any] = {}

    # ── ENTRENAMIENTO ─────────────────────────────────────────

    def train(self, X: pd.DataFrame, y: pd.Series, optimize: bool = False) -> dict:
        """
        Entrena el modelo con los datos proporcionados.
        X: DataFrame de features
        y: Series de labels binarios (1=alto riesgo, 0=bajo riesgo)
        """
        log.info("Iniciando entrenamiento", tipo=self.tipo, muestras=len(X))

        X_arr = X[self.feature_names].fillna(0).values.astype(np.float32)
        y_arr = y.values

        # Escalar features
        self.scaler = StandardScaler()
        X_scaled = self.scaler.fit_transform(X_arr)

        # Parámetros del modelo
        # Nota: para datasets pequeños (<1000) usamos parámetros conservadores
        n_estimators = 200 if len(X) > 500 else 100
        params = {
            "n_estimators":         n_estimators,
            "max_depth":            4,
            "learning_rate":        0.1,
            "subsample":            0.8,
            "colsample_bytree":     0.8,
            "reg_alpha":            0.1,
            "reg_lambda":           1.0,
            "min_child_weight":     3,
            "use_label_encoder":    False,
            "eval_metric":          "auc",
            "random_state":         42,
            "n_jobs":               -1,
        }

        # Ajuste para clases desbalanceadas (típico en detección de riesgo)
        pos_count = int(y_arr.sum())
        neg_count = int(len(y_arr) - pos_count)
        if pos_count > 0 and neg_count > 0:
            params["scale_pos_weight"] = neg_count / pos_count

        if optimize and len(X) >= 100:
            params = self._optimize_hyperparams(X_scaled, y_arr, params)

        self.model = XGBClassifier(**params)

        # Validación cruzada
        if len(X) >= 50:
            cv = StratifiedKFold(n_splits=min(5, pos_count), shuffle=True, random_state=42)
            cv_scores = cross_val_score(
                XGBClassifier(**params), X_scaled, y_arr,
                cv=cv, scoring='roc_auc', n_jobs=-1,
            )
            self.metrics['cv_auc_mean'] = float(cv_scores.mean())
            self.metrics['cv_auc_std']  = float(cv_scores.std())
            log.info("CV AUC", mean=round(self.metrics['cv_auc_mean'], 4),
                     std=round(self.metrics['cv_auc_std'], 4))

        # Entrenamiento final
        self.model.fit(X_scaled, y_arr)

        # SHAP explainer
        self.explainer = shap.TreeExplainer(self.model)

        # Métricas en training set
        y_pred_proba = self.model.predict_proba(X_scaled)[:, 1]
        self.metrics['train_auc']     = float(roc_auc_score(y_arr, y_pred_proba))
        self.metrics['n_samples']     = len(X)
        self.metrics['n_features']    = len(self.feature_names)
        self.metrics['pos_rate']      = float(y_arr.mean())
        self.metrics['version']       = self.version

        # Feature importance
        importancias = self.model.feature_importances_
        self.metrics['feature_importance'] = {
            name: float(imp)
            for name, imp in sorted(
                zip(self.feature_names, importancias),
                key=lambda x: x[1], reverse=True
            )
        }

        log.info("Entrenamiento completado",
                 train_auc=round(self.metrics['train_auc'], 4),
                 features_top3=list(self.metrics['feature_importance'].keys())[:3])

        return self.metrics

    def _optimize_hyperparams(
        self, X: np.ndarray, y: np.ndarray, base_params: dict
    ) -> dict:
        """Optimización de hiperparámetros con Optuna."""
        try:
            import optuna
            optuna.logging.set_verbosity(optuna.logging.WARNING)

            def objective(trial):
                params = {
                    **base_params,
                    "n_estimators":     trial.suggest_int("n_estimators", 100, 500),
                    "max_depth":        trial.suggest_int("max_depth", 3, 6),
                    "learning_rate":    trial.suggest_float("learning_rate", 0.01, 0.3, log=True),
                    "subsample":        trial.suggest_float("subsample", 0.6, 1.0),
                    "colsample_bytree": trial.suggest_float("colsample_bytree", 0.6, 1.0),
                    "reg_alpha":        trial.suggest_float("reg_alpha", 0.0, 1.0),
                    "reg_lambda":       trial.suggest_float("reg_lambda", 0.5, 2.0),
                }
                cv = StratifiedKFold(n_splits=3, shuffle=True, random_state=42)
                scores = cross_val_score(
                    XGBClassifier(**params), X, y, cv=cv, scoring='roc_auc'
                )
                return scores.mean()

            study = optuna.create_study(direction="maximize")
            study.optimize(objective, n_trials=30, timeout=120)

            log.info("Optuna completado", best_auc=round(study.best_value, 4))
            return {**base_params, **study.best_params}

        except Exception as e:
            log.warning("Optimización fallida, usando parámetros base", error=str(e))
            return base_params

    # ── INFERENCIA ────────────────────────────────────────────

    def predict_score(self, features: dict[str, float]) -> float:
        """Predice el score de riesgo (0.0-1.0) para una entidad."""
        if self.model is None:
            raise RuntimeError("Modelo no entrenado. Llama a train() o load()")
        X = extractor.features_to_array(features, self.tipo).reshape(1, -1)
        X_scaled = self.scaler.transform(X)
        score = self.model.predict_proba(X_scaled)[0, 1]
        return float(np.clip(score, 0.0, 1.0))

    def predict_with_shap(
        self, features: dict[str, float]
    ) -> dict[str, Any]:
        """
        Predice el score y devuelve los valores SHAP para explicabilidad.
        Responde: ¿qué features impulsaron este score?
        """
        if self.model is None or self.explainer is None:
            raise RuntimeError("Modelo no entrenado")

        X = extractor.features_to_array(features, self.tipo).reshape(1, -1)
        X_scaled = self.scaler.transform(X)

        score      = float(self.model.predict_proba(X_scaled)[0, 1])
        shap_vals  = self.explainer.shap_values(X_scaled)[0]

        # Top 5 features que más impactan al score
        contrib = sorted(
            [
                {
                    "feature":     name,
                    "valor":       float(features.get(name, 0)),
                    "shap":        float(sv),
                    "impacto":     "aumenta_riesgo" if sv > 0 else "reduce_riesgo",
                }
                for name, sv in zip(self.feature_names, shap_vals)
                if abs(sv) > 0.001
            ],
            key=lambda x: abs(x["shap"]),
            reverse=True,
        )[:8]

        return {
            "score":        score,
            "nivel_riesgo": self._score_to_level(score),
            "contribuciones": contrib,
            "base_score":   float(self.explainer.expected_value),
        }

    @staticmethod
    def _score_to_level(score: float) -> str:
        if score < 0.10: return "sin_riesgo"
        if score < 0.30: return "bajo"
        if score < 0.50: return "medio"
        if score < 0.75: return "alto"
        return "critico"

    # ── PERSISTENCIA ──────────────────────────────────────────

    def save(self):
        """Guarda el modelo en disco."""
        path = MODELS_DIR / f"risk_model_{self.tipo}_v{self.version}.pkl"
        joblib.dump({
            "model":          self.model,
            "scaler":         self.scaler,
            "feature_names":  self.feature_names,
            "metrics":        self.metrics,
            "version":        self.version,
            "tipo":           self.tipo,
        }, path)
        log.info("Modelo guardado", path=str(path))

    def load(self) -> bool:
        """Carga el modelo desde disco. Devuelve True si existe."""
        path = MODELS_DIR / f"risk_model_{self.tipo}_v{self.version}.pkl"
        if not path.exists():
            log.info("No hay modelo guardado", tipo=self.tipo)
            return False
        data = joblib.load(path)
        self.model         = data["model"]
        self.scaler        = data["scaler"]
        self.feature_names = data["feature_names"]
        self.metrics       = data["metrics"]
        if self.model:
            self.explainer = shap.TreeExplainer(self.model)
        log.info("Modelo cargado", tipo=self.tipo,
                 train_auc=round(self.metrics.get('train_auc', 0), 4))
        return True


# ── MODELOS SINGLETON (cargados al arrancar) ──────────────────

_modelos: dict[str, RiskScoringModel] = {}


def get_modelo(tipo: str = 'persona') -> RiskScoringModel:
    global _modelos
    if tipo not in _modelos:
        m = RiskScoringModel(tipo)
        m.load()  # intentar cargar; si no existe, se entrena al primer uso
        _modelos[tipo] = m
    return _modelos[tipo]
