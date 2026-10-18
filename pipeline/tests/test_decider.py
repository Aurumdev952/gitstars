import json
from pathlib import Path

import pytest

from gitstars import decider as dec
from gitstars.domain import Candidate, CandidateId, Card, ReadmeQuality
from gitstars.llm.schema import Summary

FIX = Path(__file__).parent / "fixtures"


def recorded():
    return json.loads((FIX / "decision_gate.json").read_text())


def card() -> Card:
    return Card(
        full_name="sharkdp/fd",
        description="A simple, fast and user-friendly alternative to 'find'",
        topics=[],
        languages=["Rust"],
        tree="",
        candidates={
            CandidateId.readme: Candidate(id=CandidateId.readme, source="README.md", text="fd is a program to find entries " * 50),
            CandidateId.changelog_head: Candidate(id=CandidateId.changelog_head, source="CHANGELOG.md", text="v10 features"),
            CandidateId.manifest: Candidate(id=CandidateId.manifest, source="Cargo.toml", text="[Cargo.toml]\nname: fd-find"),
        },
    )


def test_gate_request_shape():
    body = dec.gate_request(card()).model_dump(mode="json")
    assert body["model"] == "perplexity/pplx-decider-v1.2", "pinned versioned slug, never an alias"
    assert set(body["questions"]) == {"keep_readme", "keep_changelog_head", "readme_quality"}, "manifest is never gated"
    keep = body["questions"]["keep_readme"]
    assert keep["type"] == "noul" and set(keep["criteria"]) == {"true", "false"}
    assert "`candidates.readme`" in keep["instructions"]
    rq = body["questions"]["readme_quality"]
    assert rq["type"] == "choice" and set(rq["criteria"]) == {"rich", "partial", "template", "missing"}
    assert len(body["state"]["candidates"]["readme"]) == 600, "the gate sees previews only"
    assert "manifest" not in body["state"]["candidates"]
    assert len(body["state"]["readme_head"]) == 1600, "readme_quality reads a longer head than the preview"
    assert "`readme_head`" in rq["instructions"]


def test_judge_request_uses_score_levels():
    s = Summary(
        one_liner="Fast find alternative", summary="fd finds files fast with smart defaults.", kind="cli", domain="filesystem",
        tags=["find", "cli", "rust", "search", "files"], stack=["Rust"], audience=None, highlights=[],
    )
    body = dec.judge_request("card text", s).model_dump(mode="json")
    assert body["questions"]["quality"]["type"] == "score" and len(body["questions"]["quality"]["criteria"]) == 5
    assert body["state"]["summary"]["one_liner"] == "Fast find alternative"
    assert {body["questions"][k]["type"] for k in ("unsupported", "generic")} == {"noul"}


def test_parse_recorded_response():
    resp = dec.DecisionResponse.model_validate(recorded()["response"])
    assert resp.model.startswith("perplexity/pplx-decider-v1.2-")
    verdict = dec.parse_gate(resp, card())
    assert verdict.readme_quality is ReadmeQuality.rich
    assert verdict.kept(CandidateId.readme) and not verdict.kept(CandidateId.changelog_head)
    score = resp.get("specificity", dec.ScoreAnswer)
    assert 0 <= score.score <= 2 and score.legend["0"] == "Generic"
    assert resp.usage.input_tokens == 557


def test_parse_rejects_wrong_answer_type():
    raw = recorded()["response"]
    raw["answers"]["readme_quality"] = {"type": "noul", "noul": 0.5}
    resp = dec.DecisionResponse.model_validate(raw)
    with pytest.raises(dec.DecisionError):
        dec.parse_gate(resp, card())


def test_parse_judge_maps_score_to_one_to_five():
    resp = dec.DecisionResponse.model_validate(
        {
            "id": "x", "model": "perplexity/pplx-decider-v1.2-20261016",
            "answers": {
                "quality": {"type": "score", "score": 3.2},
                "unsupported": {"type": "noul", "noul": 0.1},
                "generic": {"type": "noul", "noul": 0.2},
            },
        }
    )
    v = dec.parse_judge(resp)
    assert v.score == pytest.approx(4.2) and v.passed and v.quality == pytest.approx(0.8)
    worse = v.model_copy(update={"p_generic": 0.5})
    assert not worse.passed and "generic" in dec.judge_feedback(worse)
