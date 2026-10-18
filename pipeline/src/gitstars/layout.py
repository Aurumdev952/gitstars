"""Stage 7: systems (UMAP 10-d + HDBSCAN), galaxies (Ward on system centroids), 3-d/2-d positions, neighbours."""

from __future__ import annotations

import time
from dataclasses import dataclass

import numpy as np

from gitstars.context import Ctx
from gitstars.naming import ctfidf_names, repo_terms

LAYOUT_VERSION = 1
SEED = 42
NEIGHBORS = 8
GALAXY_RANGE = (10, 16)
EXTENT = 100.0


@dataclass
class Layout:
    names: list[str]
    system: np.ndarray
    galaxy_of_system: dict[int, int]
    outlier: np.ndarray
    pos: np.ndarray
    pos2: np.ndarray
    neighbors: list[list[tuple[int, float]]]


def normalize_positions(xyz: np.ndarray, extent: float = EXTENT) -> np.ndarray:
    """Centre on the 1st-99th percentile box and scale its largest half-width to `extent`, isotropically."""
    lo, hi = np.percentile(xyz, 1, axis=0), np.percentile(xyz, 99, axis=0)
    centre = (lo + hi) / 2
    half = float(np.max((hi - lo) / 2)) or 1.0
    return (xyz - centre) * (extent / half)


def top_neighbors(vectors: np.ndarray, k: int = NEIGHBORS) -> list[list[tuple[int, float]]]:
    """Exact top-k cosine neighbours (vectors are unit-norm), self excluded, sorted desc."""
    k = min(k, len(vectors) - 1)
    if k <= 0:
        return [[] for _ in vectors]
    sims = vectors @ vectors.T
    np.fill_diagonal(sims, -np.inf)
    idx = np.argpartition(-sims, kth=k - 1, axis=1)[:, :k]
    out = []
    for i, row in enumerate(idx):
        row = sorted(row, key=lambda j: -sims[i, j])
        out.append([(int(j), round(float(sims[i, j]), 4)) for j in row])
    return out


def attach_noise(labels: np.ndarray, vectors: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """HDBSCAN noise (-1) joins the system with the nearest centroid (cosine), flagged as an outlier."""
    outlier = labels < 0
    ids = sorted(set(labels[~outlier].tolist()))
    if not ids:
        return np.zeros_like(labels), np.ones_like(outlier)
    centroids = np.stack([vectors[labels == c].mean(axis=0) for c in ids])
    centroids /= np.linalg.norm(centroids, axis=1, keepdims=True)
    nearest = np.asarray(ids)[np.argmax(vectors[outlier] @ centroids.T, axis=1)]
    out = labels.copy()
    out[outlier] = nearest
    return out, outlier


def galaxies_for(system: np.ndarray, vectors: np.ndarray) -> dict[int, int]:
    """Ward on system centroids; the galaxy count in GALAXY_RANGE with the best repo-level silhouette."""
    from sklearn.cluster import AgglomerativeClustering
    from sklearn.metrics import silhouette_score

    ids = sorted(set(system.tolist()))
    centroids = np.stack([vectors[system == c].mean(axis=0) for c in ids])
    centroids /= np.linalg.norm(centroids, axis=1, keepdims=True)
    lo, hi = GALAXY_RANGE
    if len(ids) <= lo:
        return {c: i for i, c in enumerate(ids)}
    best: tuple[float, dict[int, int]] | None = None
    for n in range(lo, min(hi, len(ids) - 1) + 1):
        labels = AgglomerativeClustering(n_clusters=n, linkage="ward").fit_predict(centroids)
        mapping = {c: int(g) for c, g in zip(ids, labels)}
        repo_labels = np.array([mapping[s] for s in system])
        score = float(silhouette_score(vectors, repo_labels, metric="cosine"))
        if best is None or score > best[0]:
            best = (score, mapping)
    assert best is not None
    return best[1]


def compute(vectors: np.ndarray, names: list[str], min_cluster_size: int = 12, min_samples: int = 5) -> Layout:
    import umap
    from sklearn.cluster import HDBSCAN

    reduced = umap.UMAP(n_components=10, metric="cosine", n_neighbors=15, min_dist=0.0, random_state=SEED).fit_transform(vectors)
    labels = HDBSCAN(min_cluster_size=min_cluster_size, min_samples=min_samples).fit_predict(reduced)
    system, outlier = attach_noise(labels, vectors)
    gal = galaxies_for(system, vectors)
    xyz = umap.UMAP(n_components=3, metric="cosine", n_neighbors=15, min_dist=0.25, spread=1.5, random_state=SEED).fit_transform(vectors)
    xy = umap.UMAP(n_components=2, metric="cosine", n_neighbors=15, min_dist=0.25, spread=1.5, random_state=SEED).fit_transform(vectors)
    return Layout(
        names=names,
        system=system,
        galaxy_of_system=gal,
        outlier=outlier,
        pos=normalize_positions(xyz),
        pos2=normalize_positions(xy),
        neighbors=top_neighbors(vectors),
    )


def assign_ids(layout: Layout) -> tuple[list[str], list[str]]:
    """Stable, size-ordered ids: galaxies `g00`.. by member count, systems `gNN.sMM` by count within their galaxy."""
    gal_sizes: dict[int, int] = {}
    sys_sizes: dict[int, int] = {}
    for s in layout.system.tolist():
        sys_sizes[s] = sys_sizes.get(s, 0) + 1
        g = layout.galaxy_of_system[s]
        gal_sizes[g] = gal_sizes.get(g, 0) + 1
    gal_order = sorted(gal_sizes, key=lambda g: (-gal_sizes[g], g))
    gal_id = {g: f"g{i:02d}" for i, g in enumerate(gal_order)}
    sys_id: dict[int, str] = {}
    for g in gal_order:
        members = sorted((s for s in sys_sizes if layout.galaxy_of_system[s] == g), key=lambda s: (-sys_sizes[s], s))
        for j, s in enumerate(members):
            sys_id[s] = f"{gal_id[g]}.s{j:02d}"
    systems = [sys_id[s] for s in layout.system.tolist()]
    galaxies = [s.split(".")[0] for s in systems]
    return galaxies, systems


def run_layout(ctx: Ctx) -> dict:
    repos = ctx.db.repos(order="starred")
    names = [r.full_name for r in repos]
    vectors = ctx.db.embedding_matrix("cluster", names)
    t0 = time.monotonic()
    layout = compute(vectors, names)
    galaxies, systems = assign_ids(layout)
    terms = [repo_terms(ctx.db, r) for r in repos]
    names_by_cluster = ctfidf_names(terms, galaxies, systems)
    payload = {
        "version": LAYOUT_VERSION,
        "names": names,
        "input_sha": ctx.db.embeddings_digest(names),
        "galaxy": galaxies,
        "system": systems,
        "outlier": layout.outlier.tolist(),
        "pos": np.round(layout.pos, 3).tolist(),
        "pos2": np.round(layout.pos2, 3).tolist(),
        "neighbors": layout.neighbors,
        "ctfidf": names_by_cluster,
    }
    ctx.db.put_global("layout", payload)
    gal_set, sys_set = sorted(set(galaxies)), sorted(set(systems))
    return {
        "repos": len(names),
        "galaxies": len(gal_set),
        "systems": len(sys_set),
        "outliers": int(layout.outlier.sum()),
        "seconds": round(time.monotonic() - t0, 1),
    }
