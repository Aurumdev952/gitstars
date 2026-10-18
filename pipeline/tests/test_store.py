import json

import numpy as np
import pytest
from rich.console import Console

from gitstars.config import Paths
from gitstars.context import Ctx, cache_key, sha
from gitstars.db import DB
from gitstars.domain import CacheKey, Repo
from gitstars.export import ExportInvalid, build, validate
from gitstars.llm.schema import Summary, parse_summary
from gitstars.summarize import SUMMARY_VERSION


def repo(name: str, oid: str = "a1", stars: int = 10, starred: str = "2024-01-01T00:00:00Z") -> Repo:
    return Repo(
        full_name=name,
        owner=name.split("/")[0],
        head_oid=oid,
        url=f"https://github.com/{name}",
        starred_at=starred,
        stars=stars,
        description=f"{name} desc",
        topics=["cli"],
        language="Rust",
        languages=["Rust"],
    )


@pytest.fixture
def db(tmp_path):
    d = DB(tmp_path / "t.db")
    yield d
    d.close()


def test_cache_key_reuse_and_invalidation(db, tmp_path):
    r = repo("o/a")
    db.upsert_repos([r])
    ctx = Ctx(paths=Paths(tmp_path, tmp_path), db=db, console=Console())
    db.put_artifact("card", cache_key(r, 1), {"x": 1, "input_sha": "s1"})
    assert ctx.cached("card", r, 1) == {"x": 1, "input_sha": "s1"}
    assert ctx.cached("card", r, 1, input_sha="s1") is not None
    assert ctx.cached("card", r, 1, input_sha="s2") is None, "same key, different input digest"
    assert ctx.cached("card", r, 2) is None, "stage version bump"
    moved = r.model_copy(update={"head_oid": "b2"})
    assert ctx.cached("card", moved, 1) is None, "default branch moved"
    assert db.get_artifact("card", CacheKey(full_name="o/a", head_oid="a1", stage_version=1)) is not None
    ctx.force = True
    assert ctx.cached("card", r, 1) is None
    assert db.fresh_count("card", 1) == 1
    db.upsert_repos([moved])
    assert db.fresh_count("card", 1) == 0


def test_upsert_marks_unstarred_inactive(db):
    db.upsert_repos([repo("o/a"), repo("o/b")])
    db.upsert_repos([repo("o/b")])
    assert [r.full_name for r in db.repos()] == ["o/b"]


def test_parse_summary_tolerates_fences_and_normalizes():
    raw = (
        'Sure!\n```json\n{"one_liner":"A fast find","summary":"fd is a fast alternative to find.","kind":"cli",'
        '"domain":null,"tags":["CLI","Rust","cli","file search"],"stack":["Rust"],"audience":null,"highlights":[]}\n```'
    )
    s = parse_summary(raw)
    assert s.tags == ["cli", "rust", "file-search"]
    with pytest.raises(json.JSONDecodeError):
        parse_summary("not json at all")
    with pytest.raises(ValueError):
        Summary.model_validate({**s.model_dump(), "kind": "spaceship"})


def _seed_export(db: DB, n: int = 3) -> None:
    repos = [repo(f"o/r{i}", stars=i, starred=f"2024-01-0{i + 1}T00:00:00Z") for i in range(n)]
    db.upsert_repos(repos)
    names = [r.full_name for r in sorted(repos, key=lambda r: r.starred_at, reverse=True)]
    rng = np.random.default_rng(0)
    vecs = rng.normal(size=(n, 768)).astype(np.float32)
    vecs /= np.linalg.norm(vecs, axis=1, keepdims=True)
    db.put_embeddings("cluster", 1, [(nm, "a1", f"t{i}", vecs[i]) for i, nm in enumerate(names)])
    db.put_embeddings("search", 1, [(nm, "a1", f"t{i}", vecs[i]) for i, nm in enumerate(names)])
    summary = Summary(
        one_liner="Does r1 things",
        summary="r1 does specific things well.",
        kind="library",
        domain="x",
        tags=["a", "b"],
        stack=["Rust"],
        audience=None,
        highlights=[],
    )
    db.put_artifact("summary", cache_key(repos[1], SUMMARY_VERSION), {"summary": summary.model_dump(), "quality": 0.75})
    db.put_global("probe_vectors", {"queries": ["q"], "vectors": vecs[:1, :256].tolist()})
    db.put_global(
        "layout",
        {
            "names": names,
            "input_sha": sha([f"t{i}" for i in range(n)]),
            "galaxy": ["g00"] * n,
            "system": ["g00.s00", "g00.s00", "g00.s01"],
            "outlier": [False, False, True],
            "pos": [[0, 0, 0], [1, 2, 3], [-100, 100, 50]],
            "pos2": [[0, 0], [1, 2], [-100, 100]],
            "neighbors": [[[1, 0.5], [2, 0.1]], [[0, 0.5]], [[0, 0.1]]],
            "ctfidf": {c: {"name": c, "blurb": "", "keywords": ["k"]} for c in ("g00", "g00.s00", "g00.s01")},
        },
    )


def test_tiny_export_validates_against_contract(db):
    _seed_export(db)
    doc, vecs = build(db, "Aurumdev952")
    validate(doc)
    assert doc["meta"]["counts"] == {"repos": 3, "galaxies": 1, "systems": 2, "summarized": 1}
    assert vecs.shape == (3, 256) and np.allclose(np.linalg.norm(vecs, axis=1), 1, atol=1e-5)
    by_name = {r["fullName"]: r for r in doc["repos"]}
    assert by_name["o/r1"]["summarized"] and by_name["o/r1"]["oneLiner"] == "Does r1 things" and by_name["o/r1"]["quality"] == 0.75
    assert not by_name["o/r0"]["summarized"] and by_name["o/r0"]["oneLiner"] == "o/r0 desc" and by_name["o/r0"]["quality"] is None
    assert doc["meta"]["searchProbes"][0]["topIdx"][0] == 0, "probe built from row 0 finds row 0"
    assert [c["id"] for c in doc["clusters"]] == ["g00", "g00.s00", "g00.s01"]
    assert doc["clusters"][1]["parentId"] == "g00" and doc["clusters"][0]["parentId"] is None


def test_contract_rejects_bad_export(db):
    _seed_export(db)
    doc, _ = build(db, "Aurumdev952")
    doc["clusters"][1]["id"] = "galaxy-1"
    with pytest.raises(ExportInvalid, match="clusters/1/id"):
        validate(doc)
    doc, _ = build(db, "Aurumdev952")
    doc["repos"][0]["neighbors"] = [[0, 0.1]] * 9
    with pytest.raises(ExportInvalid):
        validate(doc)
