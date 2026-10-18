"""Stage 7: systems (UMAP 10-d + HDBSCAN), galaxies (Ward on system centroids), 3-d/2-d positions, neighbours."""

from __future__ import annotations

import time
from dataclasses import dataclass

import numpy as np

from gitstars.context import Ctx
from gitstars.naming import ctfidf_names, repo_terms

LAYOUT_VERSION = 3
# HDBSCAN on the 10-d UMAP. 12 left mixed systems (screen recorders inside a notes-and-AI-assistants system);
# at 8, the extra splits keep 90% of 8-NN edges inside one part, against 56% for a random split of the same sizes.
MIN_CLUSTER_SIZE = 8
MIN_SAMPLES = 5
VOTE_K = 15
HOME_SHARE = 0.5
VOTE_ROUNDS = 50
# Galaxy label as a weak UMAP target pulls galaxies apart; 0.3 measured the same kNN recall as unsupervised.
GALAXY_TARGET_WEIGHT = 0.3
# Galaxies are then inflated about their centroids until, for 75% of them, the gap to the nearest other galaxy
# centroid is at least 1.7x the sum of both mean radii. Supervised UMAP alone packs each galaxy into a dot.
# 1.5 sufficed for 12 galaxies; the 13 from the finer systems needed 1.7 to keep centroid distance / radius above 7.2.
GALAXY_GAP = 1.7
GALAXY_GAP_QUANTILE = 0.25
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


def _tally(neighbor_labels: np.ndarray, weights: np.ndarray, n_labels: int) -> tuple[np.ndarray, np.ndarray]:
    """Per row, the label with the most neighbour weight and its share of the row's total weight."""
    score = np.zeros((len(neighbor_labels), n_labels))
    np.add.at(score, (np.arange(len(neighbor_labels))[:, None], neighbor_labels), weights)
    win = score.argmax(axis=1)
    return win, score[np.arange(len(win)), win] / weights.sum(axis=1)


def vote_noise(labels: np.ndarray, vectors: np.ndarray, k: int = VOTE_K, home: float = HOME_SHARE) -> tuple[np.ndarray, np.ndarray]:
    """HDBSCAN noise (-1) joins the system its k nearest repos vote for, weighted by cosine: first over clustered
    repos, then over all repos until labels settle, so a run of noise inherits from the system it trails off. The
    nearest centroid misleads for wide systems, whose centroid is far even from their own edge. Noise whose winner
    holds less than `home` of the vote weight has no clear home and stays an outlier."""
    noise = labels < 0
    rows, core = np.where(noise)[0], np.where(~noise)[0]
    if not len(core):
        return np.zeros_like(labels), noise
    if not len(rows):
        return labels.copy(), noise
    n_labels = int(labels.max()) + 1
    sims = vectors[rows] @ vectors.T
    sims[np.arange(len(rows)), rows] = -np.inf
    kc = min(k, len(core))
    seed = core[np.argpartition(-sims[:, core], kth=kc - 1, axis=1)[:, :kc]]
    out = labels.copy()
    out[rows], share = _tally(labels[seed], np.take_along_axis(sims, seed, axis=1), n_labels)
    ka = min(k, len(labels) - 1)
    nb = np.argpartition(-sims, kth=ka - 1, axis=1)[:, :ka]
    weights = np.take_along_axis(sims, nb, axis=1)
    for _ in range(VOTE_ROUNDS):
        win, share = _tally(out[nb], weights, n_labels)
        if (win == out[rows]).all():
            break
        out[rows] = win
    outlier = np.zeros_like(noise)
    outlier[rows] = share < home
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


def separate_galaxies(pos: np.ndarray, galaxy: np.ndarray, gap: float = GALAXY_GAP, q: float = GALAXY_GAP_QUANTILE) -> np.ndarray:
    """Scale every galaxy about its own centroid by one shared factor, so the q-quantile of
    (distance to nearest other centroid) / (sum of both mean radii) equals `gap`. Shapes inside a galaxy and the
    centroid arrangement are unchanged."""
    ids = sorted(set(galaxy.tolist()))
    if len(ids) < 2:
        return pos
    masks = [galaxy == g for g in ids]
    cents = np.stack([pos[m].mean(axis=0) for m in masks])
    radii = np.array([np.linalg.norm(pos[m] - c, axis=1).mean() for m, c in zip(masks, cents)])
    d = np.linalg.norm(cents[:, None] - cents[None], axis=2)
    np.fill_diagonal(d, np.inf)
    j = d.argmin(axis=1)
    ratio = d[np.arange(len(ids)), j] / np.maximum(radii + radii[j], 1e-9)
    factor = float(np.quantile(ratio, q)) / gap
    out = pos.copy()
    for m, c in zip(masks, cents):
        out[m] = c + (pos[m] - c) * factor
    return out


def place(vectors: np.ndarray, galaxy: np.ndarray, dims: int) -> np.ndarray:
    import umap

    reducer = umap.UMAP(
        n_components=dims,
        metric="cosine",
        n_neighbors=15,
        min_dist=0.25,
        spread=1.5,
        random_state=SEED,
        target_metric="categorical",
        target_weight=GALAXY_TARGET_WEIGHT,
    )
    return normalize_positions(separate_galaxies(reducer.fit_transform(vectors, y=galaxy), galaxy))


def compute(vectors: np.ndarray, names: list[str]) -> Layout:
    import umap
    from sklearn.cluster import HDBSCAN

    reduced = umap.UMAP(n_components=10, metric="cosine", n_neighbors=15, min_dist=0.0, random_state=SEED).fit_transform(vectors)
    labels = HDBSCAN(min_cluster_size=MIN_CLUSTER_SIZE, min_samples=MIN_SAMPLES).fit_predict(reduced)
    system, outlier = vote_noise(labels, vectors)
    gal = galaxies_for(system, vectors)
    galaxy = np.array([gal[s] for s in system.tolist()])
    return Layout(
        names=names,
        system=system,
        galaxy_of_system=gal,
        outlier=outlier,
        pos=place(vectors, galaxy, 3),
        pos2=place(vectors, galaxy, 2),
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
