import numpy as np
import pytest
from rich.console import Console

from gitstars.config import Paths
from gitstars.context import Ctx
from gitstars.db import DB
from gitstars.domain import Repo, sha
from gitstars.place import run_place


def repo(name: str, starred: str) -> Repo:
    return Repo(full_name=name, owner="o", head_oid="a1", url=f"https://github.com/{name}", starred_at=starred, stars=1)


def at_degrees(*deg):
    return np.column_stack([np.cos(np.radians(deg)), np.sin(np.radians(deg)), np.zeros(len(deg))]).astype(np.float32)


# Two tight systems: s00 around 0 degrees in galaxy g00, s01 around 90 degrees in galaxy g01.
A = [f"o/a{i}" for i in range(6)]
B = [f"o/b{i}" for i in range(6)]
DEG = dict(zip(A + B, [0, 2, 4, 6, 8, 10, 80, 82, 84, 86, 88, 90]))


@pytest.fixture
def ctx(tmp_path):
    db = DB(tmp_path / "t.db")
    yield Ctx(paths=Paths(tmp_path, tmp_path), db=db, console=Console(quiet=True))
    db.close()


def embed(db: DB, degrees: dict[str, float]) -> None:
    db.put_embeddings(1, {"cluster": [(n, sha(n), at_degrees(d)[0]) for n, d in degrees.items()]})


def star(db: DB, names: list[str]) -> None:
    db.upsert_repos([repo(n, f"2024-01-{i + 1:02d}T00:00:00Z") for i, n in enumerate(names)])


def stored_layout(ctx: Ctx) -> dict:
    """A layout as `gs layout` would leave it, built by hand: a galaxy per system, positions far apart."""
    names = A + B
    star(ctx.db, names)
    embed(ctx.db, DEG)
    lay = {
        "version": 3,
        "names": names,
        "input_sha": ctx.db.embeddings_digest(names),
        "galaxy": ["g00"] * 6 + ["g01"] * 6,
        "system": ["g00.s00"] * 6 + ["g01.s00"] * 6,
        "outlier": [False] * 12,
        "pos": [[float(i), 0.0, 0.0] for i in range(6)] + [[50.0 + i, 50.0, 0.0] for i in range(6)],
        "pos2": [[float(i), 0.0] for i in range(6)] + [[50.0 + i, 50.0] for i in range(6)],
        "neighbors": [[[j, 0.9] for j in range(6) if j != i][:3] for i in range(6)]
        + [[[j, 0.9] for j in range(6, 12) if j != i][:3] for i in range(6, 12)],
        "ctfidf": {},
    }
    ctx.db.put_global("layout", lay)
    return lay


def test_no_layout_asks_for_gs_layout(ctx):
    star(ctx.db, A)
    with pytest.raises(RuntimeError, match="gs layout"):
        run_place(ctx)


def test_new_star_joins_its_neighbours_system_and_existing_stars_do_not_move(ctx):
    before = stored_layout(ctx)
    star(ctx.db, A + B + ["o/new"])
    embed(ctx.db, {"o/new": 85})
    stats = run_place(ctx)
    after = ctx.db.get_global("layout")
    assert stats["placed"] == 1 and stats["dropped"] == 0 and stats["total"] == 13
    assert after["names"] == before["names"] + ["o/new"], "new stars are appended so kept indices hold"
    for key in ("galaxy", "system", "outlier", "pos", "pos2", "neighbors"):
        assert after[key][:12] == before[key], key
    assert after["system"][12] == "g01.s00" and after["galaxy"][12] == "g01"
    assert not after["outlier"][12], "all eight nearest repos agree"
    assert 45 < after["pos"][12][0] < 61 and 45 < after["pos"][12][1] < 55, "lands among its system's stars"
    assert len(after["neighbors"][12]) == 8 and all(j != 12 for j, _ in after["neighbors"][12])
    assert after["input_sha"] == ctx.db.embeddings_digest(after["names"])


def test_the_majority_of_eight_neighbours_picks_the_system(ctx):
    stored_layout(ctx)
    star(ctx.db, A + B + ["o/new"])
    # At 30 degrees its 8 nearest are all six of s00 plus two of s01: s00 wins six to two.
    embed(ctx.db, {"o/new": 30})
    run_place(ctx)
    after = ctx.db.get_global("layout")
    assert after["system"][12] == "g00.s00"
    assert after["pos"][12][0] < 10, "pulled only by the winning system's stars, not across the galaxy gap"


def test_unstarred_repo_is_dropped_and_neighbour_indices_follow(ctx):
    before = stored_layout(ctx)
    star(ctx.db, [n for n in A + B if n != "o/a0"])
    assert "o/a0" not in {r.full_name for r in ctx.db.repos()}, "fetch's upsert marks unstarred repos inactive"
    stats = run_place(ctx)
    after = ctx.db.get_global("layout")
    assert stats["dropped"] == 1 and stats["placed"] == 0
    assert after["names"] == before["names"][1:]
    assert after["pos"] == before["pos"][1:] and after["system"] == before["system"][1:]
    for i, row in enumerate(after["neighbors"]):
        assert all(0 <= j < 11 and j != i for j, _ in row)
    # b0 (old index 6) listed b1..b3 (old 7..9): now 6..8, unchanged repos.
    assert [after["names"][j] for j, _ in after["neighbors"][5]] == [before["names"][j] for j, _ in before["neighbors"][6]]


def test_llm_names_follow_a_system_that_gained_a_star(ctx):
    before = stored_layout(ctx)
    ctx.db.put_global("llm_names", {"g01.s00": {"name": "Right", "blurb": "", "members_sha": sha(before["names"][6:])}})
    star(ctx.db, A + B + ["o/new"])
    embed(ctx.db, {"o/new": 85})
    run_place(ctx)
    assert ctx.db.get_global("llm_names")["g01.s00"]["members_sha"] == sha(B + ["o/new"])


def test_nothing_new_leaves_the_layout_untouched(ctx):
    before = stored_layout(ctx)
    assert run_place(ctx)["placed"] == 0
    assert ctx.db.get_global("layout") == before
