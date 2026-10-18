import numpy as np

from gitstars.coherence import knn_modularity, knn_same


def blobs(seed=0, n=30):
    rng = np.random.default_rng(seed)
    v = np.concatenate([rng.normal([5, 0, 0], 0.3, (n, 3)), rng.normal([0, 5, 0], 0.3, (n, 3))])
    return v / np.linalg.norm(v, axis=1, keepdims=True), np.repeat([0, 1], n)


def test_knn_same_is_one_for_separated_blobs_and_drops_for_a_shuffled_partition():
    v, labels = blobs()
    assert knn_same(v, labels).tolist() == [1.0] * 60
    shuffled = np.random.default_rng(1).permutation(labels)
    assert knn_same(v, shuffled).mean() < 0.7


def test_modularity_does_not_reward_merging_two_topics():
    v, labels = blobs()
    assert np.isclose(knn_modularity(v, labels), 0.5), "two equal, perfectly separated halves"
    assert np.isclose(knn_modularity(v, np.zeros(60, int)), 0.0), "one merged cluster scores nothing"
