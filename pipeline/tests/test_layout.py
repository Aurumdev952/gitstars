import numpy as np

from gitstars.layout import Layout, assign_ids, normalize_positions, top_neighbors, vote_noise
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


def at_degrees(*deg):
    return np.column_stack([np.cos(np.radians(deg)), np.sin(np.radians(deg))]).astype(np.float32)


def test_vote_noise_follows_neighbours_where_the_nearest_centroid_is_wrong():
    # System 0 is wide (0..60 degrees, centroid at 30), system 1 is tight (82..92, centroid at 87). Noise at 64
    # sits beside system 0's edge but is closer to system 1's centroid.
    a, b = list(range(0, 61, 6)), list(range(82, 93, 2))
    v = at_degrees(*a, *b, 64)
    labels = np.array([0] * len(a) + [1] * len(b) + [-1])
    cents = np.stack([v[labels == c].mean(0) for c in (0, 1)])
    assert int(np.argmax(cents @ v[-1])) == 1, "setup: the nearest centroid is system 1"
    system, outlier = vote_noise(labels, v, k=3)
    assert system[-1] == 0, "the vote of its nearest repos puts it in system 0"
    assert system[:-1].tolist() == labels[:-1].tolist(), "clustered repos keep their system"
    assert not outlier.any(), "a unanimous vote is a clear home"


def test_vote_noise_lets_a_trail_of_noise_inherit_from_the_system_it_leaves():
    # A run of noise leaves system 0 (0..10 degrees) towards system 1 (50..60); its tip is nearer system 1's repos.
    a, b, trail = list(range(0, 11, 2)), list(range(50, 61, 2)), [13, 17, 21, 25, 29, 33]
    v = at_degrees(*a, *b, *trail)
    labels = np.array([0] * len(a) + [1] * len(b) + [-1] * len(trail))
    system, outlier = vote_noise(labels, v, k=3)
    assert system[-len(trail) :].tolist() == [0] * len(trail)
    assert not outlier.any()


def test_vote_noise_keeps_a_split_vote_flagged_as_an_outlier():
    # Two repos per axis, placed so all six are equally close to the noise point on the diagonal.
    eye = np.eye(3)
    v = unit([eye[c] + s * 0.05 * (eye[(c + 1) % 3] - eye[(c + 2) % 3]) for c in range(3) for s in (1, -1)] + [[1, 1, 1]])
    labels = np.array([0, 0, 1, 1, 2, 2, -1])
    system, outlier = vote_noise(labels, v, k=6)
    assert outlier.tolist() == [False] * 6 + [True], "a third of the vote is no home"
    assert system[-1] in (0, 1, 2)


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
