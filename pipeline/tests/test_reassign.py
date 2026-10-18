import numpy as np

from gitstars import decider as dec
from gitstars.candidates import Candidates, SystemCard
from gitstars.layout import vote_noise
from gitstars.reassign import Pick, apply_picks, parse_pick, pick_key, pick_request


def at_degrees(*deg):
    return np.column_stack([np.cos(np.radians(deg)), np.sin(np.radians(deg))]).astype(np.float32)


def vote_puts_the_repo_in_the_wrong_system():
    """A repo whose nearest neighbours are system 0 (by geometry) but which, by what it is, belongs in system 1."""
    a, b = list(range(0, 31, 5)), list(range(60, 91, 5))
    v = at_degrees(*a, *b, 33)
    labels = np.array([0] * len(a) + [1] * len(b) + [-1])
    system, outlier = vote_noise(labels, v, k=3)
    assert system[-1] == 0, "setup: the kNN vote says system 0"
    return [f"s{s}" for s in system], outlier, v


def test_a_confident_semantic_pick_overrides_the_vote():
    system, outlier, v = vote_puts_the_repo_in_the_wrong_system()
    i = len(system) - 1
    cands = Candidates(system, v, k=3, others=1)
    assert cands.for_repo(i) == ["s0", "s1"], "the current system first, then the other"
    picks = {i: Pick(choice="s1", p=0.9, current="s0", candidates=["s0", "s1"])}
    out, flags, moves = apply_picks(system, outlier, picks, threshold=0.6)
    assert out[i] == "s1" and not flags[i], "moved to the semantic pick and no longer an outlier"
    assert [(m.index, m.src, m.dst) for m in moves] == [(i, "s0", "s1")]
    assert out[:i] == system[:i], "nobody else moved"


def test_a_low_confidence_pick_keeps_the_vote_and_none_flags_an_outlier():
    system, outlier, v = vote_puts_the_repo_in_the_wrong_system()
    i = len(system) - 1
    weak = {i: Pick(choice="s1", p=0.55, current="s0", candidates=["s0", "s1"])}
    out, flags, moves = apply_picks(system, outlier, weak, threshold=0.6)
    assert out[i] == "s0" and moves == [] and not flags[i], "below the threshold the kNN result stands"
    none = {i: Pick(choice=None, p=0.8, current="s0", candidates=["s0", "s1"])}
    out, flags, moves = apply_picks(system, outlier, none, threshold=0.6)
    assert out[i] == "s0" and flags[i] and moves == [], "`none` stays put but is flagged"
    same = {0: Pick(choice="s0", p=0.99, current="s0", candidates=["s0", "s1"])}
    out, flags, moves = apply_picks(system, outlier, same, threshold=0.6)
    assert out == system and moves == []


def test_pick_request_and_parse_round_trip():
    cards = [SystemCard("g00.s01", "Cur", "cur blurb", ("o/x: x",)), SystemCard("g00.s02", "Alt", "alt blurb", ("o/y: y",))]
    req = pick_request("o/z", {"one_liner": "z", "summary": "zz"}, cards)
    body = req.model_dump(mode="json")
    assert body["model"] == "perplexity/pplx-decider-v1.2"
    assert set(body["questions"]["home"]["criteria"]) == {"A", "B", "none"}
    assert body["questions"]["home"]["criteria"]["A"].startswith("Cur:")
    assert body["state"]["groups"]["B"]["central_members"] == ["o/y: y"]
    resp = dec.DecisionResponse.model_validate(
        {"id": "x", "model": "m", "answers": {"home": {"type": "choice", "choice": "B", "probabilities": {"A": 0.2, "B": 0.75, "none": 0.05}}}}
    )
    pick = parse_pick(resp, ["g00.s01", "g00.s02"])
    assert pick.choice == "g00.s02" and pick.p == 0.75 and pick.current == "g00.s01"
    resp = dec.DecisionResponse.model_validate({"id": "x", "model": "m", "answers": {"home": {"type": "choice", "choice": "none"}}})
    assert parse_pick(resp, ["g00.s01", "g00.s02"]).choice is None


def test_pick_key_ignores_a_shifted_central_sample_but_not_a_renamed_candidate():
    summary = {"one_liner": "z", "summary": "zz"}
    a = [SystemCard("g00.s01", "Cur", "b", ("o/x: x",)), SystemCard("g00.s02", "Alt", "b", ("o/y: y",))]
    shifted = [SystemCard("g00.s01", "Cur", "b", ("o/w: w",)), SystemCard("g00.s02", "Alt", "b", ("o/y: y",))]
    renamed = [SystemCard("g00.s01", "Cur", "b", ("o/x: x",)), SystemCard("g00.s02", "Other", "b", ("o/y: y",))]
    assert pick_key("o/z", summary, a) == pick_key("o/z", summary, shifted)
    assert pick_key("o/z", summary, a) != pick_key("o/z", summary, renamed)
    assert pick_key("o/z", summary, a) != pick_key("o/z", summary, list(reversed(a))), "the current system is always first"
