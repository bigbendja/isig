# ml/training/segmentation.py
# ============================================================
# Segmentación automática de entidades con K-Means
# Detecta grupos naturales en la población de entidades
# ============================================================
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
import structlog
from sklearn.cluster import KMeans, MiniBatchKMeans
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import silhouette_score, davies_bouldin_score
from sklearn.decomposition import PCA

from ml.training.features import extractor

log = structlog.get_logger()

MODELS_DIR = Path(__file__).parent.parent / "models"


@dataclass
class Segmento:
    id:          int
    nombre:      str
    descripcion: str
    tamaño:      int
    perfil:      dict[str, float]   # media de features en el cluster
    color:       str
    etiquetas:   list[str] = field(default_factory=list)


class SegmentationModel:
    """
    Segmentación K-Means sobre el espacio de features.
    Elige automáticamente el número óptimo de clusters.
    """

    def __init__(self, tipo: str = 'persona', n_clusters: int | None = None):
        self.tipo       = tipo
        self.n_clusters = n_clusters
        self.model:     KMeans | None = None
        self.scaler:    StandardScaler | None = None
        self.pca:       PCA | None = None
        self.segmentos: list[Segmento] = []
        self.metrics:   dict[str, Any] = {}

    def train(self, X: pd.DataFrame) -> list[Segmento]:
        """
        Entrena el modelo de segmentación.
        Si no se especifica n_clusters, busca el óptimo entre 3 y 12.
        """
        X_filled = X.fillna(0).values.astype(np.float32)

        self.scaler = StandardScaler()
        X_scaled = self.scaler.fit_transform(X_filled)

        # Reducción dimensional para clustering más estable
        n_components = min(10, X_scaled.shape[1], X_scaled.shape[0] - 1)
        self.pca = PCA(n_components=n_components, random_state=42)
        X_pca = self.pca.fit_transform(X_scaled)

        # Elegir número óptimo de clusters
        if self.n_clusters is None:
            self.n_clusters = self._elegir_n_clusters(X_pca)

        log.info("Entrenando K-Means", tipo=self.tipo, n_clusters=self.n_clusters, muestras=len(X))

        # Usar MiniBatchKMeans para datasets grandes
        if len(X) > 5000:
            self.model = MiniBatchKMeans(
                n_clusters=self.n_clusters,
                random_state=42,
                batch_size=500,
                n_init=10,
            )
        else:
            self.model = KMeans(
                n_clusters=self.n_clusters,
                random_state=42,
                n_init=20,
                max_iter=300,
            )

        labels = self.model.fit_predict(X_pca)

        # Métricas de calidad del clustering
        if len(set(labels)) > 1:
            self.metrics['silhouette']      = float(silhouette_score(X_pca, labels))
            self.metrics['davies_bouldin']  = float(davies_bouldin_score(X_pca, labels))
            self.metrics['inertia']         = float(self.model.inertia_)

        # Construir descriptores de segmentos
        feature_names = X.columns.tolist()
        self.segmentos = self._describir_segmentos(X_filled, labels, feature_names)

        log.info(
            "Segmentación completada",
            n_clusters=self.n_clusters,
            silhouette=round(self.metrics.get('silhouette', 0), 3),
        )
        return self.segmentos

    def _elegir_n_clusters(self, X: np.ndarray) -> int:
        """Método del codo + silhouette para elegir K óptimo."""
        k_range = range(3, min(13, len(X) // 5 + 1))
        if len(k_range) < 2:
            return 3

        best_k  = 5
        best_s  = -1.0

        for k in k_range:
            km = KMeans(n_clusters=k, random_state=42, n_init=5, max_iter=100)
            labels = km.fit_predict(X)
            if len(set(labels)) > 1:
                s = silhouette_score(X, labels)
                if s > best_s:
                    best_s = s
                    best_k = k

        log.info("K óptimo seleccionado", k=best_k, silhouette=round(best_s, 3))
        return best_k

    def _describir_segmentos(
        self,
        X: np.ndarray,
        labels: np.ndarray,
        feature_names: list[str],
    ) -> list[Segmento]:
        """Genera nombres y descripciones automáticas de cada segmento."""
        COLORES = [
            '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
            '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#6366f1',
            '#14b8a6', '#a855f7',
        ]

        segmentos = []

        for cluster_id in range(self.n_clusters):
            mask   = labels == cluster_id
            X_clus = X[mask]
            tamaño = int(mask.sum())

            if tamaño == 0:
                continue

            # Perfil del cluster: media de cada feature
            perfil = {name: float(X_clus[:, i].mean())
                      for i, name in enumerate(feature_names)}

            # Generar nombre y etiquetas automáticamente
            nombre, desc, etiquetas = self._generar_etiquetas(perfil, tamaño)

            segmentos.append(Segmento(
                id=cluster_id,
                nombre=nombre,
                descripcion=desc,
                tamaño=tamaño,
                perfil=perfil,
                color=COLORES[cluster_id % len(COLORES)],
                etiquetas=etiquetas,
            ))

        return sorted(segmentos, key=lambda s: s.tamaño, reverse=True)

    def _generar_etiquetas(
        self, perfil: dict[str, float], tamaño: int
    ) -> tuple[str, str, list[str]]:
        """
        Genera nombre descriptivo del segmento basado en el perfil de features.
        Heurística: mira las features más altas para caracterizar el grupo.
        """
        etiquetas = []

        if perfil.get('es_pep', 0) > 0.5:
            etiquetas.append('PEP')
        if perfil.get('en_lista_vigilancia', 0) > 0.3:
            etiquetas.append('Vigilado')
        if perfil.get('num_listas_externas', 0) > 0.5:
            etiquetas.append('Sancionado')
        if perfil.get('score_influencia', 0) > 0.6:
            etiquetas.append('Alta influencia')
        if perfil.get('num_vinculos', 0) > 0.5:
            etiquetas.append('Red densa')
        if perfil.get('patrimonio_log', 0) > 1.5:
            etiquetas.append('Alto patrimonio')
        if perfil.get('completitud', 0) > 0.7:
            etiquetas.append('Expediente completo')
        if perfil.get('num_alertas_30d', 0) > 0.3:
            etiquetas.append('Actividad reciente')
        if perfil.get('tiene_empresa', 0) > 0.8:
            etiquetas.append('Empresarial')
        if perfil.get('nivel_pep', 0) == 0 and perfil.get('score_influencia', 0) < 0.2:
            etiquetas.append('Perfil bajo')

        if not etiquetas:
            etiquetas = ['Sin característica dominante']

        nombre = ' · '.join(etiquetas[:2])
        desc   = (f"Segmento de {tamaño} entidades. "
                  f"Características: {', '.join(etiquetas)}.")

        return nombre, desc, etiquetas

    def predict(self, features: dict[str, float]) -> int:
        """Asigna una entidad a un segmento."""
        if self.model is None:
            raise RuntimeError("Modelo no entrenado")
        X = np.array(list(features.values()), dtype=np.float32).reshape(1, -1)
        X_scaled = self.scaler.transform(X)
        X_pca    = self.pca.transform(X_scaled)
        return int(self.model.predict(X_pca)[0])

    def predict_proba(self, features: dict[str, float]) -> dict[int, float]:
        """Devuelve la distancia normalizada a cada centroide (como probabilidad)."""
        if self.model is None:
            raise RuntimeError("Modelo no entrenado")
        X      = np.array(list(features.values()), dtype=np.float32).reshape(1, -1)
        X_s    = self.scaler.transform(X)
        X_p    = self.pca.transform(X_s)
        dists  = self.model.transform(X_p)[0]      # distancias a cada centroide
        # Convertir distancias a "probabilidades" inversas
        inv    = 1.0 / (dists + 1e-6)
        probs  = inv / inv.sum()
        return {i: float(p) for i, p in enumerate(probs)}

    def save(self):
        path = MODELS_DIR / f"segmentation_{self.tipo}.pkl"
        joblib.dump({
            "model":     self.model,
            "scaler":    self.scaler,
            "pca":       self.pca,
            "segmentos": self.segmentos,
            "metrics":   self.metrics,
            "n_clusters": self.n_clusters,
        }, path)
        log.info("Modelo segmentación guardado", path=str(path))

    def load(self) -> bool:
        path = MODELS_DIR / f"segmentation_{self.tipo}.pkl"
        if not path.exists():
            return False
        data = joblib.load(path)
        self.model      = data["model"]
        self.scaler     = data["scaler"]
        self.pca        = data["pca"]
        self.segmentos  = data["segmentos"]
        self.metrics    = data["metrics"]
        self.n_clusters = data["n_clusters"]
        log.info("Modelo segmentación cargado", tipo=self.tipo, n_clusters=self.n_clusters)
        return True
