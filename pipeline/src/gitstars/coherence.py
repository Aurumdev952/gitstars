"""Cluster coherence and galaxy separation metrics for a stored layout (`gs coherence`)."""

from __future__ import annotations

from typing import Any

import numpy as np

from gitstars.db import DB

K = 8


def knn(vectors: np.ndarray, k: int = K) -> np.ndarray:
    """Indices of each row's k nearest 768-d cosine neighbours, self excluded."""
    sims = vectors @ vectors.T
    np.fill_diagonal(sims, -np.inf)
    return np.argpartition(-sims, kth=k - 1, axis=1)[:, :k]


def knn_same(vectors: np.ndarray, labels: np.ndarray, k: int = K) -> np.ndarray:
    """Per repo, the fraction of its k nearest neighbours that share its label."""
    nn = knn(vectors, k)
    return (labels[nn] == labels[:, None]).mean(axis=1)


def knn_modularity(vectors: np.ndarray, labels: np.ndarray, k: int = K) -> float:
    """Newman modularity of the partition on the directed kNN graph. Unlike the same-label rate it does not
    rise just because clusters merge: a cluster's expected internal share grows with its size squared."""
    nn = knn(vectors, k)
    n = len(labels)
    internal = (labels[nn] == labels[:, None]).sum() / (n * k)
    _, inv = np.unique(labels, return_inverse=True)
    out_deg = np.bincount(inv, minlength=inv.max() + 1) * k
    in_deg = np.bincount(inv[nn.ravel()], minlength=inv.max() + 1)
    return float(internal - (out_deg * in_deg).sum() / (n * k) ** 2)


def centroid_cosine(vectors: np.ndarray, labels: np.ndarray) -> np.ndarray:
    """Per repo, cosine to its own cluster's normalized mean vector."""
    out = np.empty(len(vectors))
    for c in set(labels.tolist()):
        m = labels == c
        cent = vectors[m].mean(axis=0)
        out[m] = vectors[m] @ (cent / np.linalg.norm(cent))
    return out


def coherence(vectors: np.ndarray, system: np.ndarray, galaxy: np.ndarray, outlier: np.ndarray) -> dict[str, Any]:
    sys_same = knn_same(vectors, system)
    gal_same = knn_same(vectors, galaxy)
    cos = centroid_cosine(vectors, system)
    per_system = np.array([cos[system == s].mean() for s in sorted(set(system.tolist()))])
    sizes = np.array([(system == s).sum() for s in sorted(set(system.tolist()))])
    return {
        "systems": len(per_system),
        "galaxies": len(set(galaxy.tolist())),
        "outliers": int(outlier.sum()),
        "knn_sys_outlier": float(sys_same[outlier].mean()) if outlier.any() else float("nan"),
        "knn_sys_core": float(sys_same[~outlier].mean()),
        "knn_sys_all": float(sys_same.mean()),
        "knn_gal_outlier": float(gal_same[outlier].mean()) if outlier.any() else float("nan"),
        "knn_gal_all": float(gal_same.mean()),
        "modularity_sys": knn_modularity(vectors, system),
        "modularity_gal": knn_modularity(vectors, galaxy),
        "cos_outlier": float(cos[outlier].mean()) if outlier.any() else float("nan"),
        "cos_sys_mean": float(per_system.mean()),
        "cos_sys_min": float(per_system.min()),
        "cos_sys_p10": float(np.percentile(per_system, 10)),
        "sys_size_min": int(sizes.min()),
        "sys_size_max": int(sizes.max()),
    }


def separation(pos: np.ndarray, galaxy: np.ndarray) -> dict[str, float]:
    """The three numbers commit d51f110 reported: mean centroid distance over mean galaxy radius, median
    nearest-galaxy gap over the sum of both radii, and the silhouette of galaxy labels in 3-d."""
    from sklearn.metrics import silhouette_score

    ids = sorted(set(galaxy.tolist()))
    cents = np.stack([pos[galaxy == g].mean(axis=0) for g in ids])
    radii = np.array([np.linalg.norm(pos[galaxy == g] - c, axis=1).mean() for g, c in zip(ids, cents)])
    d = np.linalg.norm(cents[:, None] - cents[None], axis=2)
    sep = d[np.triu_indices(len(ids), 1)].mean() / radii.mean()
    np.fill_diagonal(d, np.inf)
    j = d.argmin(axis=1)
    gap = np.median(d[np.arange(len(ids)), j] / (radii + radii[j]))
    return {"sep_ratio": float(sep), "nearest_gap": float(gap), "silhouette_3d": float(silhouette_score(pos, galaxy))}


def stored_layout_metrics(db: DB) -> dict[str, Any]:
    from gitstars.layout import cluster_space

    lay = db.get_global("layout")
    if not lay:
        raise RuntimeError("no layout; run `gs layout` first")
    vectors = cluster_space(db.embedding_matrix("cluster", lay["names"]))
    galaxy = np.asarray(lay["galaxy"])
    return {
        **coherence(vectors, np.asarray(lay["system"]), galaxy, np.asarray(lay["outlier"], dtype=bool)),
        **separation(np.asarray(lay["pos"]), galaxy),
    }
