import asyncio
import json
import sqlite3
import time

import pytest
from rich.console import Console

from gitstars import summarize
from gitstars.cards import gate_key, load_card, pending_gate_jobs, run_card
from gitstars.config import Paths
from gitstars.context import Ctx
from gitstars.db import DB
from gitstars.domain import GateVerdict, ReadmeQuality, Repo, sha
from gitstars.llm.openrouter import RequestBudget, TransportError
from gitstars.llm.pool import ModelSlot, Pool, rank
from gitstars.summarize import RunState, job_for, load_summary, pending_jobs

VALID = json.dumps(
    {
        "one_liner": "A fast find",
        "summary": "fd is a fast alternative to find.",
        "kind": "cli",
        "domain": None,
        "tags": ["cli", "rust"],
        "stack": ["Rust"],
        "audience": None,
        "highlights": [],
    }
)


def repo(name: str, oid: str = "a1", stars: int = 10) -> Repo:
    return Repo(
        full_name=name,
        owner=name.split("/")[0],
        head_oid=oid,
        url=f"https://github.com/{name}",
        starred_at="2024-01-01T00:00:00Z",
        stars=stars,
        description=f"{name} does a specific thing",
        topics=["cli"],
        language="Rust",
        languages=["Rust"],
    )


@pytest.fixture
def ctx(tmp_path):
    db = DB(tmp_path / "t.db")
    yield Ctx(paths=Paths(tmp_path, tmp_path), db=db, console=Console(quiet=True))
    db.close()


def summarized(ctx: Ctx, r: Repo) -> None:
    verdict = {"score": 4.2, "p_unsupported": 0.1, "p_generic": 0.1, "model": "judge"}
    ctx.db.put_artifact("summary", job_for(ctx.db, r).key, {"summary": json.loads(VALID), "verdict": verdict, "quality": 0.8})


def test_push_that_keeps_the_card_keeps_gate_and_summary(ctx):
    r = repo("o/a")
    ctx.db.upsert_repos([r])
    run_card(ctx)
    card_sha = load_card(ctx.db, r)[1]["input_sha"]
    gate = GateVerdict(keep={}, readme_quality=ReadmeQuality.missing, model="m")
    ctx.db.put_artifact("gate", gate_key(r, card_sha), {"verdict": gate.model_dump(mode="json")})
    summarized(ctx, r)

    pushed = r.model_copy(update={"head_oid": "b2"})
    ctx.db.upsert_repos([pushed])
    run_card(ctx)
    assert pending_gate_jobs(ctx) == [], "gate verdict survives a push that leaves the card alone"
    assert load_summary(ctx.db, pushed) is not None, "summary survives a push that leaves the card alone"
    assert pending_jobs(ctx) == []

    edited = pushed.model_copy(update={"description": "now it does something else entirely"})
    ctx.db.upsert_repos([edited])
    run_card(ctx)
    assert load_summary(ctx.db, edited) is None, "a changed card re-summarizes"
    assert [j.repo.full_name for j in pending_jobs(ctx)] == ["o/a"]


def test_prompt_version_is_part_of_the_summary_key(ctx, monkeypatch):
    r = repo("o/a")
    ctx.db.upsert_repos([r])
    run_card(ctx)
    summarized(ctx, r)
    monkeypatch.setattr(summarize, "PROMPT_VERSION", 2)
    assert load_summary(ctx.db, r) is None


def test_legacy_head_oid_rows_are_rekeyed_on_their_digest(tmp_path):
    path = tmp_path / "legacy.db"
    conn = sqlite3.connect(path)
    conn.executescript(
        "CREATE TABLE artifacts (stage TEXT NOT NULL, full_name TEXT NOT NULL, head_oid TEXT NOT NULL, version INTEGER NOT NULL,"
        " payload TEXT NOT NULL, updated_at REAL NOT NULL, PRIMARY KEY (stage, full_name));"
        "CREATE TABLE embeddings (full_name TEXT NOT NULL, space TEXT NOT NULL, head_oid TEXT NOT NULL, version INTEGER NOT NULL,"
        " text_sha TEXT NOT NULL, vec BLOB NOT NULL, PRIMARY KEY (full_name, space));"
    )
    conn.execute("INSERT INTO artifacts VALUES ('summary', 'o/a', 'oldhead', 1, ?, 0)", (json.dumps({"input_sha": "s1", "x": 1}),))
    conn.execute("INSERT INTO artifacts VALUES ('gate', 'o/a', 'oldhead', 2, ?, 0)", (json.dumps({"input_sha": "c1"}),))
    conn.execute("INSERT INTO artifacts VALUES ('tree', 'o/a', 'oldhead', 1, '{}', 0)")
    conn.execute("INSERT INTO embeddings VALUES ('o/a', 'cluster', 'oldhead', 1, 't1', x'00000000')")
    conn.commit()
    conn.close()

    db = DB(path)
    rows = dict(db.conn.execute("SELECT stage, digest FROM artifacts").fetchall())
    assert rows == {"summary": sha(["s1", 1, 1]), "gate": sha(["c1", 1]), "tree": "oldhead"}
    assert db.embedding_shas("cluster") == {"o/a": ("t1", 1)}
    db.close()
    DB(path).close()


def test_limit_counts_repos_that_need_work(ctx):
    rs = [repo(f"o/r{i}", stars=100 - i) for i in range(5)]
    ctx.db.upsert_repos(rs)
    run_card(ctx)
    for r in rs[:2]:
        summarized(ctx, r)
        card_sha = load_card(ctx.db, r)[1]["input_sha"]
        gate = GateVerdict(keep={}, readme_quality=ReadmeQuality.missing, model="m")
        ctx.db.put_artifact("gate", gate_key(r, card_sha), {"verdict": gate.model_dump(mode="json")})
    ctx.limit = 2
    assert [j.repo.full_name for j in pending_jobs(ctx)] == ["o/r2", "o/r3"]
    assert [j[0].full_name for j in pending_gate_jobs(ctx)] == ["o/r2", "o/r3"]


class RefusingTransport:
    """Model `a:free` refuses for good; `b:free` answers."""

    async def complete(self, slot, messages, schema):
        if slot.id == "a:free":
            raise TransportError("http 403: only available on agentic harnesses", permanent=True)
        return VALID


async def test_permanent_refusal_is_remembered_across_runs(ctx):
    r = repo("o/a")
    ctx.db.upsert_repos([r])
    pool = Pool([ModelSlot("a:free"), ModelSlot("b:free")], concurrency=2)
    state = RunState("openrouter", pool, RefusingTransport(), decider=None)
    summary, model = await summarize._generate(state, ctx, r, "card text", None, set())
    assert model == "b:free"
    assert ctx.db.disabled_models() == {"a:free"}

    catalog = [
        {"id": mid, "architecture": {"output_modalities": ["text"]}, "created": 1, "description": "a 70B model"}
        for mid in ("a:free", "b:free", "c:free")
    ]
    healthy = {m["id"]: True for m in catalog}
    slots = rank(catalog, healthy, size=2, exclude=ctx.db.disabled_models())
    assert [s.id for s in slots] == ["b:free", "c:free"], "the refused model gives up its slot"

    stale = {"a:free": {"reason": "x", "at": time.time() - 8 * 86400}}
    ctx.db.put_global("disabled_models", stale)
    assert ctx.db.disabled_models() == frozenset(), "a refusal expires after a week"


class FakeDecider:
    def __init__(self, fail_first: int = 0, score: float = 3.0):
        self.calls = 0
        self.fail_first = fail_first
        self.score = score

    async def decide(self, req):
        from gitstars.decider import DecisionError, DecisionResponse

        self.calls += 1
        if self.calls <= self.fail_first:
            raise DecisionError("decisions http 503")
        raw = {
            "id": "d1",
            "model": "judge",
            "answers": {
                "quality": {"type": "score", "score": self.score},
                "unsupported": {"type": "noul", "noul": 0.05},
                "generic": {"type": "noul", "noul": 0.05},
            },
        }
        return DecisionResponse.model_validate(raw), raw


class CountingTransport:
    """Every reply parses as JSON but breaks the schema, so each hop also asks for a repair."""

    def __init__(self):
        self.calls = 0

    async def complete(self, slot, messages, schema):
        self.calls += 1
        return '{"one_liner": 1}'


async def test_request_budget_caps_hops_and_repairs_across_concurrent_jobs(ctx):
    rs = [repo(f"o/r{i}") for i in range(6)]
    ctx.db.upsert_repos(rs)
    run_card(ctx)
    slots = [ModelSlot(f"m{i}:free", rpm=None) for i in range(15)]
    transport = CountingTransport()
    state = RunState("openrouter", Pool(slots, concurrency=15), transport, FakeDecider(), budget=RequestBudget(10))
    await asyncio.gather(*(summarize.summarize_repo(state, ctx, j) for j in pending_jobs(ctx)))
    assert transport.calls == 10 and state.requests == 10, "never more requests than the budget"
    assert state.stop and "budget" in state.stop
    assert state.failed_repos == 0, "repos cut off by the budget stay pending instead of counting as failures"
    assert len(pending_jobs(ctx)) == 6


async def test_a_summary_whose_judge_failed_is_judged_again_without_regenerating(ctx):
    r = repo("o/a")
    ctx.db.upsert_repos([r])
    run_card(ctx)
    pool = Pool([ModelSlot("b:free", rpm=None)], concurrency=1)
    decider = FakeDecider(fail_first=2, score=3.5)
    state = RunState("openrouter", pool, RefusingTransport(), decider)
    await summarize.summarize_repo(state, ctx, pending_jobs(ctx)[0])
    assert load_summary(ctx.db, r)["verdict"] is None, "both judge tries failed, the summary is kept unjudged"

    (job,) = pending_jobs(ctx)
    assert job.unjudged is not None
    transport = CountingTransport()
    state = RunState("openrouter", pool, transport, decider)
    await summarize.summarize_repo(state, ctx, job)
    art = load_summary(ctx.db, r)
    assert transport.calls == 0, "re-judging spends no summarizer requests"
    assert art["passed"] and art["quality"] == 0.875, "score 3.5 on the 0-based scale is 4.5 of 5"
    assert pending_jobs(ctx) == []
