import json

import numpy as np
import pytest
from rich.console import Console

from gitstars import naming
from gitstars.config import Paths
from gitstars.context import Ctx
from gitstars.db import DB
from gitstars.domain import Repo, sha
from gitstars.llm.openrouter import FatalProviderError
from gitstars.llm.pool import ModelSlot, Pool


def repo(name: str) -> Repo:
    return Repo(
        full_name=name,
        owner="o",
        head_oid="a1",
        url=f"https://github.com/{name}",
        starred_at="2024-01-01T00:00:00Z",
        stars=1,
        description=f"{name} desc",
    )


class ScriptedTransport:
    def __init__(self, replies):
        self.replies = list(replies)
        self.prompts: list[str] = []

    async def complete(self, slot, messages, schema):
        self.prompts.append(messages[-1]["content"])
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return json.dumps(reply)

    async def aclose(self):
        pass


@pytest.fixture
def ctx(tmp_path):
    db = DB(tmp_path / "t.db")
    names = [f"o/r{i}" for i in range(4)]
    db.upsert_repos([repo(n) for n in names])
    v = np.eye(4, 8, dtype=np.float32)
    db.put_embeddings(1, {"cluster": [(n, f"t{i}", v[i]) for i, n in enumerate(names)]})
    ids = ["g00", "g00.s00", "g00.s01"]
    db.put_global(
        "layout",
        {
            "names": names,
            "galaxy": ["g00"] * 4,
            "system": ["g00.s00", "g00.s00", "g00.s01", "g00.s01"],
            "ctfidf": {c: {"name": "a · b · c", "blurb": "", "keywords": ["a", "b"]} for c in ids},
        },
    )
    db.put_global("llm_names", {"g07.s03": {"name": "Gone", "blurb": "", "members_sha": "x"}})
    yield Ctx(paths=Paths(tmp_path, tmp_path), db=db, console=Console(quiet=True))
    db.close()


def use(monkeypatch, transport):
    monkeypatch.setattr(naming.local, "build_pool", lambda: (Pool([ModelSlot("gemma", rpm=None)], concurrency=4), transport))


async def test_galaxies_are_named_from_this_runs_system_names(ctx, monkeypatch):
    t = ScriptedTransport(
        [
            {"name": "Terminal Emulators", "blurb": "Terminals."},
            {"name": "Shell Prompts", "blurb": "Prompts."},
            {"name": "Command Line Life", "blurb": "Everything for the terminal."},
        ]
    )
    use(monkeypatch, t)
    out = await naming.run_name(ctx, provider="local")
    stored = ctx.db.get_global("llm_names")
    assert out["systems_named"] == 2 and out["galaxies_named"] == 1
    assert "g07.s03" not in stored, "names for clusters no longer in the layout are dropped"
    assert "Terminal Emulators" in t.prompts[-1] and "Shell Prompts" in t.prompts[-1]
    first, second = (t.prompts[-1].index(stored[s]["name"]) for s in ("g00.s00", "g00.s01"))
    assert first < second, "equal-size systems are listed by id, not set order, so the prompt digest is stable"
    lay = ctx.db.get_global("layout")
    assert naming.cluster_name(ctx.db, lay, "g00", lay["names"])["name"] == "Command Line Life"

    use(monkeypatch, ScriptedTransport([]))
    again = await naming.run_name(ctx, provider="local")
    assert again["requests"] == 0, "unchanged inputs are not renamed"


async def test_keyword_soup_is_rejected_and_names_survive_a_fatal_error(ctx, monkeypatch):
    t = ScriptedTransport(
        [
            {"name": "javascript · typescript · editor", "blurb": "x"},
            {"name": "Code Editors", "blurb": "Editors."},
            FatalProviderError("http 402"),
        ]
    )
    use(monkeypatch, t)
    monkeypatch.setattr(naming, "NAME_ATTEMPTS", 2)
    out = await naming.run_name(ctx, provider="local")
    stored = ctx.db.get_global("llm_names")
    named = {cid: v["name"] for cid, v in stored.items()}
    assert list(named.values()) == ["Code Editors"], "the keyword list was rejected, the good name was kept"
    (cid,) = named
    members = {"g00.s00": ["o/r0", "o/r1"], "g00.s01": ["o/r2", "o/r3"]}[cid]
    assert stored[cid]["members_sha"] == sha(members)
    assert out["stopped"] and "402" in out["stopped"]
