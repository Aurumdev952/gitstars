import numpy as np

from gitstars.layout import Layout, assign_ids, attach_noise, normalize_positions, top_neighbors
from gitstars.naming import ctfidf


def unit(rows):
    v = np.asarray(rows, dtype=np.float32)
    return v / np.linalg.norm(v, axis=1, keepdims=True)


def test_normalize_positions_percentile_box_isotropic():
    rng = np.random.default_rng(1)
    xyz = np.column_stack([rng.normal(0, 10, 1000), rng.normal(5, 1, 1000), rng.normal(0, 1, 1000)])
    xyz[0] = [1e4, 0, 0]
    out = normalize_positions(xyz)
    lo, hi = np.percentile(out, 1, axis=0), np.percentile(out, 99, axis=0)
    assert np.isclose(max(hi - lo) / 2, 100), "widest axis spans ±100 inside the 1-99 percentile box"
    assert (hi - lo)[1] < 30, "isotropic: the narrow axis stays narrow"
    assert out[0, 0] > 1000, "outliers are not clipped, they just don't set the scale"


def test_top_neighbors_exact_sorted_without_self():
    v = unit([[1, 0], [0.9, 0.1], [0, 1], [0.7, 0.7]])
    nb = top_neighbors(v, k=2)
    assert [j for j, _ in nb[0]] == [1, 3]
    assert nb[2][0][0] == 3 and all(j != i for i, row in enumerate(nb) for j, _ in row)
    assert nb[0][0][1] >= nb[0][1][1]


def test_attach_noise_to_nearest_centroid():
    v = unit([[1, 0], [0.95, 0.05], [0, 1], [0.05, 0.95], [0.9, 0.2]])
    labels = np.array([0, 0, 1, 1, -1])
    system, outlier = attach_noise(labels, v)
    assert system.tolist() == [0, 0, 1, 1, 0] and outlier.tolist() == [False] * 4 + [True]


def test_assign_ids_orders_by_size():
    lay = Layout(
        names=list("abcdefg"),
        system=np.array([5, 5, 5, 5, 7, 9, 9]),
        galaxy_of_system={5: 1, 7: 0, 9: 0},
        outlier=np.zeros(7, bool),
        pos=np.zeros((7, 3)),
        pos2=np.zeros((7, 2)),
        neighbors=[],
    )
    galaxies, systems = assign_ids(lay)
    assert systems == ["g00.s00"] * 4 + ["g01.s01", "g01.s00", "g01.s00"]
    assert galaxies == ["g00"] * 4 + ["g01"] * 3


def test_ctfidf_prefers_distinctive_shared_terms():
    classes = {
        "a": [{"llm", "inference", "rust"}, {"llm", "inference", "python"}, {"llm", "cuda"}, {"llm", "rust"}],
        "b": [{"react", "ui", "rust"}, {"react", "components"}, {"react", "ui"}, {"react", "css"}],
    }
    out = ctfidf(classes)
    assert out["a"][:2] == ["llm", "inference"]
    assert out["b"][:2] == ["react", "ui"]
    assert "cuda" not in out["a"], "a term in one member of a 4+ cluster lacks support"


def test_top_neighbors_with_fewer_repos_than_k_never_lists_self():
    v = np.eye(4, dtype=np.float32)
    nb = top_neighbors(v, k=8)
    assert [len(row) for row in nb] == [3, 3, 3, 3]
    assert all(j != i and np.isfinite(c) for i, row in enumerate(nb) for j, c in row)
    assert top_neighbors(v[:1], k=8) == [[]]


def test_separate_galaxies_opens_gaps_without_reshaping_a_galaxy():
    from gitstars.layout import separate_galaxies

    rng = np.random.default_rng(0)
    centres = np.array([[0, 0, 0], [3, 0, 0], [0, 3, 0], [3, 3, 3]], dtype=float)
    galaxy = np.repeat(np.arange(4), 50)
    pos = centres[galaxy] + rng.normal(scale=1.0, size=(200, 3))
    out = separate_galaxies(pos, galaxy, gap=1.5, q=0.0)
    cents = np.stack([out[galaxy == g].mean(0) for g in range(4)])
    radii = np.array([np.linalg.norm(out[galaxy == g] - cents[g], axis=1).mean() for g in range(4)])
    d = np.linalg.norm(cents[:, None] - cents[None], axis=2)
    np.fill_diagonal(d, np.inf)
    j = d.argmin(1)
    assert np.isclose((d[np.arange(4), j] / (radii + radii[j])).min(), 1.5), "the tightest pair now has the target gap"
    before = np.stack([pos[galaxy == g].mean(0) for g in range(4)])
    assert np.allclose(cents, before), "centroids stay put"
    m = galaxy == 0
    a, b = pos[m] - pos[m].mean(0), out[m] - cents[0]
    assert np.allclose(b, a * (np.linalg.norm(b) / np.linalg.norm(a))), "a galaxy is only scaled, never reshaped"
    assert separate_galaxies(pos, np.zeros(200, dtype=int)) is pos
