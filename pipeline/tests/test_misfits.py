import json

from gitstars.misfits import Verdict, judge_input, majority, parse_verdict, sample_names, summarize_verdicts


def test_sample_is_the_same_set_for_any_order_of_the_same_names():
    names = [f"o/r{i}" for i in range(50)]
    a = sample_names(names, n=10, seed=1, watch=("o/r49", "x/missing"))
    b = sample_names(list(reversed(names)), n=10, seed=1, watch=("o/r49", "x/missing"))
    assert a == b and len(a) in (10, 11) and "o/r49" in a
    assert "x/missing" not in a, "a watched repo that is not starred is skipped"
    assert sample_names(names, n=10, seed=2, watch=()) != sample_names(names, n=10, seed=1, watch=())


def test_majority_takes_the_fit_vote_then_the_commonest_pick_on_that_side():
    votes = [Verdict(fits=False, best="B", reason="b"), Verdict(fits=True, best="A", reason="a"), Verdict(fits=False, best="C", reason="c")]
    v = majority(votes)
    assert not v.fits and v.best == "B", "2-1 against; the first of the tied picks on the losing side"
    v = majority([Verdict(fits=True, best="A", reason="a")] * 2 + [Verdict(fits=False, best="none", reason="n")])
    assert v.fits and v.best == "A"


def test_parse_and_summary_count_misfits_and_better_elsewhere():
    v = parse_verdict('junk {"fits": true, "best": "none", "reason": "r"} trailing')
    assert v.best == "none" and v.fits
    verdicts = {
        "a": {"system": "g00.s00", "fits": True, "best": "g00.s00"},
        "b": {"system": "g00.s00", "fits": True, "best": "g01.s00"},
        "c": {"system": "g00.s00", "fits": False, "best": None},
        "d": {"system": "g00.s00", "fits": False, "best": "g01.s00"},
    }
    s = summarize_verdicts(verdicts)
    assert (s["misfits"], s["misfit_rate"], s["fits_but_better_elsewhere"], s["none_fits"]) == (2, 0.5, 1, 1)


def test_judge_input_labels_the_current_system_a_and_fences_the_data():
    from gitstars.candidates import SystemCard

    cards = [SystemCard("g00.s01", "Cur", "cur blurb", ("o/x: x",)), SystemCard("g00.s02", "Alt", "alt blurb", ("o/y: y",))]
    text = judge_input("o/z", {"one_liner": "z", "summary": "zz"}, cards)
    body = json.loads(text.split("\n", 1)[1].rsplit("\n", 1)[0])
    assert body["groups"]["A"]["name"] == "Cur" and body["groups"]["B"]["name"] == "Alt"
    assert body["repository"]["one_liner"] == "z"
