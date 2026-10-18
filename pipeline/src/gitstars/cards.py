"""Stages 1-4: fetch stars, fetch homepages, build cards, gate candidates."""

from __future__ import annotations

import asyncio
import statistics
import time

from rich.progress import Progress

from gitstars import decider as dec
from gitstars.config import github_token, openrouter_key
from gitstars.context import Ctx, cache_key, sha
from gitstars.db import DB
from gitstars.domain import Card, GateVerdict, HomepageDoc, ReadmeQuality, Repo, TreeEntry
from gitstars.extract import assemble, build_card, choose_blob_paths, symlink_target
from gitstars.github import GitHub
from gitstars.homepage import HomepageFetcher, normalize_url, worth_fetching
from gitstars.llm.openrouter import MIN_BALANCE_USD, read_quota
from gitstars.tokens import count_tokens

TREE_VERSION = 1
HOMEPAGE_VERSION = 1
CARD_VERSION = 2
GATE_VERSION = 2
GATE_CONCURRENCY = 8


def _percentile(values: list[int], q: float) -> int:
    if not values:
        return 0
    s = sorted(values)
    return s[min(len(s) - 1, int(round(q * (len(s) - 1))))]


async def run_fetch(ctx: Ctx) -> dict:
    gh = GitHub(github_token())
    t0 = time.monotonic()
    try:
        login, rows = await gh.stars(log=ctx.console.log)
        own = [r for r in rows if r.owner.lower() == login.lower()]
        kept = [r for r in rows if r.owner.lower() != login.lower()]
        ctx.db.upsert_repos(kept)
        stars_s = time.monotonic() - t0

        pending = [r for r in kept if r.head_oid and ctx.cached("tree", r, TREE_VERSION) is None]
        if ctx.limit is not None:
            pending = pending[: ctx.limit]
        trees: dict[str, list[TreeEntry]] = {}
        with Progress(console=ctx.console, transient=True) as prog:
            task = prog.add_task("trees", total=len(pending))

            async def one(r: Repo) -> None:
                trees[r.full_name] = await gh.tree(r.full_name, r.head_oid)
                prog.advance(task)

            await asyncio.gather(*(one(r) for r in pending))

        wanted = {r.full_name: (r.head_oid, choose_blob_paths(trees[r.full_name])) for r in pending}
        t1 = time.monotonic()
        blobs = await gh.blobs(wanted)
        blobs_s = time.monotonic() - t1
        for r in pending:
            if r.full_name in blobs:
                ctx.db.put_blobs(r.full_name, r.head_oid, blobs[r.full_name])
            ctx.db.put_artifact(
                "tree",
                ctx.key(r, TREE_VERSION),
                {"entries": [e.model_dump() for e in trees[r.full_name]], "blobs": wanted[r.full_name][1]},
            )
        backfilled = await fill_missing_blobs(ctx, gh, kept)
        symlinks = await resolve_symlinks(ctx.db, gh, kept)
    finally:
        await gh.aclose()

    repos = kept
    stats = {
        "viewer": login,
        "total_starred": len(rows),
        "own_dropped": len(own),
        "kept": len(kept),
        "with_readme": sum(1 for r in repos if _has_readme(ctx.db, r)),
        "with_homepage": sum(1 for r in repos if normalize_url(r.homepage)),
        "trees_fetched": len(pending),
        "blobs_requested": sum(len(p) for _, p in wanted.values()),
        "blobs_backfilled": backfilled,
        "symlinks_resolved": symlinks,
        "stars_seconds": round(stars_s, 1),
        "blobs_seconds": round(blobs_s, 1),
        "seconds": round(time.monotonic() - t0, 1),
        "fetched_at": time.time(),
    }
    ctx.db.put_global("fetch", stats)
    return stats


async def fill_missing_blobs(ctx: Ctx, gh: GitHub, repos: list[Repo]) -> int:
    """Read blobs the current selection rules want but an earlier run never requested (rules change; trees don't)."""
    wanted: dict[str, tuple[str, list[str]]] = {}
    for r in repos:
        tree_art = ctx.db.get_artifact("tree", ctx.key(r, TREE_VERSION))
        if not tree_art:
            continue
        stored = ctx.db.blobs(r.full_name, r.head_oid)
        entries = [TreeEntry.model_validate(e) for e in tree_art["entries"]]
        missing = [p for p in choose_blob_paths(entries) if p not in stored]
        if missing:
            wanted[r.full_name] = (r.head_oid, missing)
    if not wanted:
        return 0
    fetched = await gh.blobs(wanted)
    for name, blobs in fetched.items():
        repo_oid = wanted[name][0]
        ctx.db.put_blobs(name, repo_oid, blobs)
    return sum(len(p) for _, p in wanted.values())


async def resolve_symlinks(db: DB, gh: GitHub, repos: list[Repo]) -> int:
    """Monorepos often symlink README.md to a package README; GitHub serves the link's target path as the
    blob text. Scans every stored blob, not just this run's, so data fetched before this fix converges too."""
    wanted: dict[str, tuple[str, list[str]]] = {}
    links: dict[str, dict[str, str]] = {}
    for r in repos:
        for path, text in db.blobs(r.full_name, r.head_oid).items():
            target = symlink_target(path, text)
            if target:
                links.setdefault(r.full_name, {})[path] = target
                wanted.setdefault(r.full_name, (r.head_oid, []))[1].append(target)
    if not wanted:
        return 0
    fetched = await gh.blobs(wanted)
    resolved = 0
    for r in repos:
        for path, target in links.get(r.full_name, {}).items():
            text = fetched.get(r.full_name, {}).get(target)
            if text and not symlink_target(target, text):
                db.put_blobs(r.full_name, r.head_oid, {path: text})
                resolved += 1
    return resolved


def _has_readme(db: DB, r: Repo) -> bool:
    blobs = db.blobs(r.full_name, r.head_oid)
    return any(t for p, t in blobs.items() if "/" not in p and p.lower().startswith("readme"))


async def run_homepage(ctx: Ctx) -> dict:
    urls = sorted({u for r in ctx.db.repos() if worth_fetching(r.homepage) and (u := normalize_url(r.homepage))})
    pending = [u for u in urls if ctx.force or _should_fetch(ctx.db.get_homepage(u, HOMEPAGE_VERSION))]
    if ctx.limit is not None:
        pending = pending[: ctx.limit]
    fetcher = HomepageFetcher()
    ok = 0
    t0 = time.monotonic()
    try:
        with Progress(console=ctx.console, transient=True) as prog:
            task = prog.add_task("homepages", total=len(pending))

            async def one(url: str) -> None:
                nonlocal ok
                doc, err = await fetcher.fetch(url)
                ok += doc is not None and bool(doc.text or doc.description)
                ctx.db.put_homepage(url, HOMEPAGE_VERSION, {"doc": doc.model_dump() if doc else None, "error": err})
                prog.advance(task)

            await asyncio.gather(*(one(u) for u in pending))
    finally:
        await fetcher.aclose()
    return {"eligible_urls": len(urls), "fetched": len(pending), "with_text": ok, "seconds": round(time.monotonic() - t0, 1)}


TRANSIENT_ERRORS = ("ConnectError", "ConnectTimeout", "ReadTimeout", "TimeoutError", "RemoteProtocolError", "http 5", "http 429")


def _should_fetch(cached: dict | None) -> bool:
    """Never fetched, or failed in a way a later run might not."""
    return cached is None or (cached.get("doc") is None and str(cached.get("error", "")).startswith(TRANSIENT_ERRORS))


def homepage_doc(db: DB, repo: Repo) -> HomepageDoc | None:
    url = normalize_url(repo.homepage)
    if not url or not worth_fetching(url):
        return None
    cached = db.get_homepage(url, HOMEPAGE_VERSION)
    return HomepageDoc.model_validate(cached["doc"]) if cached and cached.get("doc") else None


def make_card(db: DB, repo: Repo) -> Card:
    tree_art = db.latest_artifact("tree", repo.full_name)
    entries = [TreeEntry.model_validate(e) for e in tree_art["entries"]] if tree_art else []
    return build_card(repo, entries, db.blobs(repo.full_name, repo.head_oid), homepage_doc(db, repo))


def run_card(ctx: Ctx) -> dict:
    repos = ctx.db.repos(order="stars", limit=ctx.limit)
    tokens: list[int] = []
    changed = 0
    for repo in repos:
        card = make_card(ctx.db, repo)
        card_sha = sha(card.model_dump(mode="json"))
        cached = ctx.cached("card", repo, CARD_VERSION, input_sha=card_sha)
        if cached is None:
            text = assemble(card, None, count_tokens)
            cached = {"card": card.model_dump(mode="json"), "text": text, "tokens": count_tokens(text), "input_sha": card_sha}
            ctx.db.put_artifact("card", ctx.key(repo, CARD_VERSION), cached)
            changed += 1
        tokens.append(cached["tokens"])
    return {
        "cards": len(repos),
        "rebuilt": changed,
        "tokens_median": int(statistics.median(tokens)) if tokens else 0,
        "tokens_p95": _percentile(tokens, 0.95),
        "tokens_max": max(tokens, default=0),
        "over_budget": sum(1 for t in tokens if t > 1800),
    }


def load_card(db: DB, repo: Repo) -> tuple[Card, dict] | None:
    art = db.get_artifact("card", cache_key(repo, CARD_VERSION))
    if art is None:
        return None
    return Card.model_validate(art["card"]), art


def load_gate(db: DB, repo: Repo, card_sha: str) -> GateVerdict | None:
    art = db.get_artifact("gate", cache_key(repo, GATE_VERSION))
    if art is None or art.get("input_sha") != card_sha:
        return None
    return GateVerdict.model_validate(art["verdict"])


async def run_gate(ctx: Ctx) -> dict:
    key = openrouter_key()
    quota = await read_quota(key)
    if quota.balance_usd <= MIN_BALANCE_USD:
        raise RuntimeError(f"credit balance ${quota.balance_usd:.2f} is at or below ${MIN_BALANCE_USD:.2f}; not gating")
    jobs: list[tuple[Repo, Card, str]] = []
    for repo in ctx.selected("stars")[: ctx.limit]:
        loaded = load_card(ctx.db, repo)
        if loaded is None:
            continue
        card, art = loaded
        if ctx.cached("gate", repo, GATE_VERSION, input_sha=art["input_sha"]) is None:
            jobs.append((repo, card, art["input_sha"]))

    decider = dec.Decider(key)
    sem = asyncio.Semaphore(GATE_CONCURRENCY)
    stats = {"gated": 0, "skipped_no_candidates": 0, "errors": 0, "cost_usd": 0.0, "input_tokens": 0}
    quality_counts: dict[str, int] = {}

    async def one(repo: Repo, card: Card, card_sha: str) -> None:
        if not any(cid in dec.GATED for cid in card.candidates):
            verdict = GateVerdict(keep={}, readme_quality=ReadmeQuality.missing, model="code:no-candidates")
            stats["skipped_no_candidates"] += 1
        else:
            req = dec.gate_request(card)
            async with sem:
                try:
                    resp, raw = await decider.decide(req)
                    verdict = dec.parse_gate(resp, card)
                except (dec.DecisionError, ValueError) as exc:
                    ctx.db.log_decision(repo.full_name, "gate", req.model_dump(mode="json"), None, str(exc)[:500])
                    stats["errors"] += 1
                    return
            ctx.db.log_decision(repo.full_name, "gate", req.model_dump(mode="json"), raw, None)
            if resp.usage:
                stats["cost_usd"] += resp.usage.cost or 0.0
                stats["input_tokens"] += resp.usage.input_tokens or 0
            stats["gated"] += 1
        quality_counts[verdict.readme_quality.value] = quality_counts.get(verdict.readme_quality.value, 0) + 1
        ctx.db.put_artifact("gate", ctx.key(repo, GATE_VERSION), {"verdict": verdict.model_dump(mode="json"), "input_sha": card_sha})

    try:
        await asyncio.gather(*(one(*j) for j in jobs))
    finally:
        await decider.aclose()
    stats["cost_usd"] = round(stats["cost_usd"], 6)
    return {**stats, "readme_quality": quality_counts, "pending_before": len(jobs)}
