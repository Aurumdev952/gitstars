from __future__ import annotations

import asyncio
import json
import time
from typing import Annotated, Any

import typer
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from gitstars.cards import load_card, load_gate
from gitstars.config import Paths, openrouter_key
from gitstars.context import Ctx, cache_key
from gitstars.db import DB
from gitstars.extract import assemble
from gitstars.llm.openrouter import read_quota
from gitstars.naming import cluster_name
from gitstars.stages import STAGES
from gitstars.summarize import SUMMARY_VERSION, Provider
from gitstars.tokens import count_tokens

app = typer.Typer(no_args_is_help=True, add_completion=False, help="gitstars pipeline: GitHub stars → galaxy export.")
console = Console()

Limit = Annotated[int | None, typer.Option("--limit", "-n", help="Process at most N repos (dry runs).")]
Force = Annotated[bool, typer.Option("--force", help="Ignore caches for this stage.")]
ProviderOpt = Annotated[str, typer.Option("--provider", help="openrouter (free pool) or local (vLLM).")]
Reserve = Annotated[int, typer.Option("--reserve", help="Free requests to keep in reserve.")]


def _ctx(limit: int | None = None, force: bool = False) -> Ctx:
    paths = Paths.resolve()
    return Ctx(paths=paths, db=DB(paths.db), console=console, limit=limit, force=force)


def _run(stage: str, limit: int | None, force: bool, **kwargs: Any) -> dict:
    ctx = _ctx(limit, force)
    t0 = time.monotonic()
    try:
        result = STAGES[stage](ctx, **kwargs)
    finally:
        ctx.db.close()
    _print_result(stage, result, time.monotonic() - t0)
    return result


def _print_result(stage: str, result: dict, seconds: float) -> None:
    table = Table(title=f"gs {stage}  ({seconds:.1f}s)", show_header=False, title_justify="left")
    for k, v in result.items():
        table.add_row(k, json.dumps(v) if isinstance(v, (dict, list)) else str(v))
    console.print(table)


@app.command()
def fetch(limit: Limit = None, force: Force = False) -> None:
    """GitHub stars (minus your own repos), depth-2 trees, README/manifest/doc blobs."""
    _run("fetch", limit, force)


@app.command()
def homepage(limit: Limit = None, force: Force = False) -> None:
    """Fetch homepages that aren't package-registry or GitHub mirrors; extract their main text."""
    _run("homepage", limit, force)


@app.command()
def card(limit: Limit = None, force: Force = False) -> None:
    """Build a card per repo and report its token count."""
    _run("card", limit, force)


@app.command()
def gate(limit: Limit = None, force: Force = False) -> None:
    """pplx-decider: keep project-specific candidates, rate the README. Most-starred first."""
    _run("gate", limit, force)


@app.command()
def summarize(limit: Limit = None, force: Force = False, provider: ProviderOpt = "openrouter", reserve: Reserve = 100) -> None:
    """Summarize on the model pool and judge each summary. Most-starred first; stops at the quota reserve."""
    if provider not in ("openrouter", "local"):
        raise typer.BadParameter("provider must be openrouter or local")
    p: Provider = provider  # type: ignore[assignment]
    _run("summarize", limit, force, provider=p, reserve=reserve)


@app.command()
def embed(limit: Limit = None, force: Force = False) -> None:
    """EmbeddingGemma 2 on the GPU: clustering + search vectors (summary text, or the raw card in v0)."""
    _run("embed", limit, force)


@app.command()
def layout(force: Force = False) -> None:
    """UMAP + HDBSCAN systems, Ward galaxies, 3-d/2-d positions, top-8 neighbours, c-TF-IDF names."""
    _run("layout", None, force)


@app.command()
def name(limit: Limit = None, force: Force = False, reserve: Reserve = 100) -> None:
    """LLM names for systems on the free pool; galaxies are named from their systems."""
    _run("name", limit, force, reserve=reserve)


@app.command()
def export(force: Force = False) -> None:
    """Validate against the contract, then write galaxy.json and vectors.f16.bin."""
    _run("export", None, force)


@app.command()
def run(
    limit: Limit = None,
    provider: ProviderOpt = "openrouter",
    llm: Annotated[bool, typer.Option("--llm/--no-llm", help="Include gate, summarize and name.")] = True,
) -> None:
    """Every stage in order. `--no-llm` builds the v0 map."""
    for stage in STAGES.values():
        if stage.uses_llm and not llm:
            continue
        kwargs: dict[str, Any] = {"provider": provider} if stage.name == "summarize" else {}
        _run(stage.name, None if stage.name in ("layout", "export") else limit, False, **kwargs)


@app.command()
def show(repo: str) -> None:
    """Card (with token count), gate verdict, summary, judge scores and the model used."""
    ctx = _ctx()
    r = ctx.db.repo(repo)
    if r is None:
        raise typer.BadParameter(f"{repo} is not an active star")
    console.print(Panel.fit(f"[bold]{r.full_name}[/]  ★{r.stars}  {r.language or ''}  starred {r.starred_at[:10]}\n"
                            f"{r.description or '(no description)'}\nhomepage: {r.homepage or '-'}  head {r.head_oid[:10]}"))
    loaded = load_card(ctx.db, r)
    if loaded is None:
        console.print("[yellow]no card; run `gs card`[/]")
        return
    card, art = loaded
    gate = load_gate(ctx.db, r, art["input_sha"])
    text = assemble(card, gate, count_tokens)
    cands = Table("candidate", "source", "chars", "gate p(keep)", title="candidate pool", title_justify="left")
    for cid, c in card.candidates.items():
        p = gate.keep.get(cid) if gate else None
        cands.add_row(cid.value, c.source[:60], str(len(c.text)), "-" if p is None else f"{p:.2f}")
    console.print(cands)
    console.print(f"gate: {('readme_quality=' + gate.readme_quality.value + ' model=' + gate.model) if gate else 'none (heuristic budget)'}")
    console.print(Panel(text, title=f"card sent to summarizer · {count_tokens(text)} tokens", title_align="left"))
    s = ctx.db.get_artifact("summary", cache_key(r, SUMMARY_VERSION))
    if not s:
        console.print("[yellow]not summarized[/]")
        return
    console.print(Panel(json.dumps(s["summary"], indent=2, ensure_ascii=False), title=f"summary · {s['model']} ({s['provider']})", title_align="left"))
    v = s.get("verdict")
    if v:
        console.print(
            f"judge: score {v['score']:.2f}/5  p(unsupported) {v['p_unsupported']:.2f}  p(generic) {v['p_generic']:.2f}"
            f"  passed={s['passed']}  quality={s['quality']}  attempts={len(s['attempts'])}"
        )
        for a in s["attempts"]:
            av = a.get("verdict") or {}
            console.print(f"  · {a['model']}: score {av.get('score', float('nan')):.2f} passed={a['passed']}")


@app.command()
def report(samples: int = 5) -> None:
    """Every galaxy and system with its name, size and sample members (most-starred)."""
    ctx = _ctx()
    lay = ctx.db.get_global("layout")
    if not lay:
        raise typer.BadParameter("no layout; run `gs layout`")
    repos = {r.full_name: r for r in ctx.db.repos()}
    names = lay["names"]
    for g in sorted(set(lay["galaxy"])):
        gm = [i for i, x in enumerate(lay["galaxy"]) if x == g]
        gn = cluster_name(ctx.db, lay, g, [names[i] for i in gm])
        console.print(f"\n[bold cyan]{g}[/] [bold]{gn['name']}[/]  ({len(gm)} repos)  kw: {', '.join(gn['keywords'][:6])}")
        for s in sorted({lay["system"][i] for i in gm}):
            sm = [i for i, x in enumerate(lay["system"]) if x == s]
            sn = cluster_name(ctx.db, lay, s, [names[i] for i in sm])
            top = sorted(sm, key=lambda i: -repos[names[i]].stars)[:samples]
            outl = sum(lay["outlier"][i] for i in sm)
            console.print(f"  [cyan]{s}[/] {sn['name']}  ({len(sm)}, {outl} outliers): " + ", ".join(names[i] for i in top))


@app.command()
def status() -> None:
    """Progress per stage, fetch stats, OpenRouter quota left."""
    ctx = _ctx()
    repos = ctx.db.repos()
    t = Table("stage", "version", "fresh", "of", title=f"data: {ctx.paths.data}", title_justify="left")
    for st in STAGES.values():
        if st.name in ("fetch",):
            t.add_row(st.name, str(st.version), str(ctx.db.fresh_count("tree", st.version)), str(len(repos)))
        elif st.name in ("card", "gate", "summarize"):
            stage_key = "summary" if st.name == "summarize" else st.name
            t.add_row(st.name, str(st.version), str(ctx.db.fresh_count(stage_key, st.version)), str(len(repos)))
    n_emb = ctx.db.conn.execute("SELECT COUNT(*) FROM embeddings WHERE space='cluster'").fetchone()[0]
    t.add_row("embed", str(STAGES["embed"].version), str(n_emb), str(len(repos)))
    n_hp = ctx.db.conn.execute("SELECT COUNT(*), SUM(json_extract(payload,'$.doc') IS NOT NULL) FROM homepages").fetchone()
    t.add_row("homepage", str(STAGES["homepage"].version), f"{n_hp[1] or 0} ok", f"{n_hp[0]} urls")
    lay = ctx.db.get_global("layout")
    t.add_row("layout", str(STAGES["layout"].version), "yes" if lay else "no", f"{len(set(lay['system'])) if lay else 0} systems")
    exp = ctx.db.get_global("export")
    t.add_row("export", "1", exp["at"] if exp else "never", json.dumps(exp["counts"]) if exp else "")
    console.print(t)
    fs = ctx.db.get_global("fetch")
    if fs:
        console.print(
            f"fetch: viewer {fs['viewer']} · starred {fs['total_starred']} · own dropped {fs['own_dropped']} · kept {fs['kept']}"
            f" · with README {fs['with_readme']} · with homepage {fs['with_homepage']}"
        )
    calls = ctx.db.conn.execute(
        "SELECT provider, SUM(outcome='ok'), COUNT(*) FROM llm_calls GROUP BY provider"
    ).fetchall()
    for prov, ok, total in calls:
        console.print(f"llm calls ({prov}): {ok} ok / {total} total")
    dec = ctx.db.conn.execute(
        "SELECT purpose, COUNT(*), SUM(error IS NULL), SUM(json_extract(response,'$.usage.cost')) FROM decisions GROUP BY purpose"
    ).fetchall()
    for purpose, n, ok, cost in dec:
        console.print(f"decider {purpose}: {ok}/{n} ok, ${cost or 0:.5f}")
    try:
        q = asyncio.run(read_quota(openrouter_key()))
        console.print(f"openrouter: free {q.free_remaining}/{q.free_limit} remaining today (used {q.free_used}) · balance ${q.balance_usd:.4f}")
    except Exception as exc:  # status must still print when the key service or network is down
        console.print(f"openrouter quota: unavailable ({type(exc).__name__})")
