"""Stage 7b: semantic reassignment. pplx-decider picks each repo's system from a short candidate list (its
current one, four neighbours' systems, or none); a different pick with enough confidence moves the repo, `none`
flags it an outlier, and the layout's galaxies and positions are recomputed to follow. Picks are cached per
(repo, candidate cards), so a rerun or a second round only pays for what changed."""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Any

import numpy as np
from pydantic import BaseModel

from gitstars import decider as dec
from gitstars.candidates import LETTERS, Candidates, SystemCard, system_cards
from gitstars.config import openrouter_key
from gitstars.context import Ctx
from gitstars.db import DB
from gitstars.domain import CacheKey, sha
from gitstars.layout import assign_ids, cluster_space, finish, store_layout
from gitstars.summarize import load_summary

REASSIGN_VERSION = 1
# Bump when the question text changes meaning; it is part of each pick's cache digest.
PROMPT_VERSION = 1
# Calibrated against the Gemma misfit judge on the 408-repo sample: the judge agreed with 63-66% of off-system
# picks at any threshold from 0.3 to 0.7 and 73% at 0.8 with half as many moves, so confidence mostly sets how
# many repos move (0.6 moved 253 of 2,284) and the end-to-end misfit rate chose the value.
MOVE_THRESHOLD = 0.6
ROUNDS = 2
IN_FLIGHT = 16


class Pick(BaseModel):
    """The decider's answer for one repo: the chosen system (None for `none`) and its probability."""

    choice: str | None
    p: float
    current: str
    candidates: list[str]


@dataclass(frozen=True)
class Move:
    index: int
    src: str
    dst: str
    p: float


def pick_request(repo_name: str, summary: dict[str, Any], cards: list[SystemCard]) -> dec.DecisionRequest:
    keys = LETTERS[: len(cards)]
    state = {
        "repository": {"name": repo_name, "one_liner": summary["one_liner"], "summary": summary["summary"]},
        "groups": {k: card.as_state() for k, card in zip(keys, cards)},
    }
    criteria = {k: f"{card.name}: {card.blurb}" for k, card in zip(keys, cards)}
    criteria["none"] = "None of these groups: the repository is a different kind of thing from all of their members."
    question = dec.ChoiceQuestion(
        instructions="Which group in `groups` does `repository` belong in, the way a person sorting a shelf would place it: "
        "the same kind of thing or the same purpose as that group's central members, not merely the same programming "
        "language or ecosystem?",
        criteria=criteria,
    )
    return dec.DecisionRequest(state=state, questions={"home": question})


def parse_pick(resp: dec.DecisionResponse, candidates: list[str]) -> Pick:
    ans = resp.get("home", dec.ChoiceAnswer)
    choice = None if ans.choice == "none" else candidates[LETTERS.index(ans.choice)]
    p = ans.probabilities.get(ans.choice, 1.0) if ans.probabilities else 1.0
    return Pick(choice=choice, p=p, current=candidates[0], candidates=candidates)


def apply_picks(
    system: list[str], outlier: np.ndarray, picks: dict[int, Pick], threshold: float = MOVE_THRESHOLD
) -> tuple[list[str], np.ndarray, list[Move]]:
    """The reassignment rule. A repo moves only when the decider prefers another system with p >= threshold; a
    `none` pick leaves the repo where it is but flags it an outlier; anything else keeps the kNN result."""
    out = list(system)
    flags = outlier.copy()
    moves: list[Move] = []
    for i, pick in picks.items():
        if pick.choice is None:
            flags[i] = True
        elif pick.choice != system[i] and pick.p >= threshold:
            moves.append(Move(i, system[i], pick.choice, pick.p))
            out[i] = pick.choice
            flags[i] = False
    return out, flags, moves


def pick_key(repo_name: str, summary: dict[str, Any], cards: list[SystemCard]) -> CacheKey:
    digest = sha([summary["one_liner"], summary["summary"], [c.as_state() for c in cards], PROMPT_VERSION])
    return CacheKey(full_name=repo_name, stage_version=REASSIGN_VERSION, digest=digest)


def carry_names(db: DB, names: list[str], new_systems: list[str]) -> None:
    """Keep an LLM name whose system kept exactly its members but got a new size-ordered id."""
    stored = db.get_global("llm_names") or {}
    by_members = {v["members_sha"]: v for v in stored.values() if "members_sha" in v}
    members: dict[str, list[str]] = {}
    for n, cid in zip(names, new_systems):
        members.setdefault(cid, []).append(n)
    for cid, ms in members.items():
        found = by_members.get(sha(ms))
        if found is not None:
            stored[cid] = found
    db.put_global("llm_names", stored)


async def run_reassign(ctx: Ctx, threshold: float = MOVE_THRESHOLD, rounds: int = ROUNDS, dry_run: bool = False) -> dict:
    layout = ctx.db.get_global("layout")
    if not layout:
        raise RuntimeError("no layout; run `gs layout` first")
    names: list[str] = layout["names"]
    vectors = cluster_space(ctx.db.embedding_matrix("cluster", names))
    repos = {r.full_name: r for r in ctx.db.repos()}
    system: list[str] = list(layout["system"])
    outlier = np.asarray(layout["outlier"], dtype=bool)
    decider = dec.Decider(openrouter_key())
    slots = asyncio.Semaphore(IN_FLIGHT)
    stats: dict[str, Any] = {"requests": 0, "cached": 0, "errors": 0, "cost": 0.0, "moved": 0, "flagged_none": 0, "rounds": 0}
    moves_log: list[dict[str, Any]] = []
    t0 = time.monotonic()

    async def ask(i: int, cards: list[SystemCard], ids: list[str]) -> tuple[int, Pick] | None:
        art = load_summary(ctx.db, repos[names[i]])
        if not art:
            return None
        key = pick_key(names[i], art["summary"], cards)
        cached = ctx.cached("reassign", key)
        if cached:
            stats["cached"] += 1
            return i, Pick.model_validate(cached)
        req = pick_request(names[i], art["summary"], cards)
        async with slots:
            stats["requests"] += 1
            try:
                resp, raw = await decider.decide(req)
                pick = parse_pick(resp, ids)
            except dec.DecisionError as exc:
                stats["errors"] += 1
                ctx.db.log_decision(names[i], "reassign", req.model_dump(mode="json"), None, str(exc)[:500])
                return None
        ctx.db.log_decision(names[i], "reassign", req.model_dump(mode="json"), raw, None)
        stats["cost"] += (resp.usage.cost or 0.0) if resp.usage else 0.0
        ctx.db.put_artifact("reassign", key, pick.model_dump())
        return i, pick

    picks: dict[int, Pick] = {}
    try:
        for _ in range(rounds):
            stats["rounds"] += 1
            working = {"names": names, "system": system, "outlier": outlier.tolist(), "ctfidf": layout["ctfidf"]}
            cards = system_cards(ctx.db, working, vectors)
            cands = Candidates(system, vectors)
            jobs = []
            for i in ctx.take(list(range(len(names)))):
                ids = cands.for_repo(i)
                jobs.append(ask(i, [cards[s] for s in ids], ids))
            picks = dict(r for r in await asyncio.gather(*jobs) if r)
            system, outlier, moves = apply_picks(system, outlier, picks, threshold)
            moves_log.extend({"repo": names[m.index], "from": m.src, "to": m.dst, "p": round(m.p, 3)} for m in moves)
            stats["moved"] += len(moves)
            if not moves:
                break
        stats["flagged_none"] = sum(1 for p in picks.values() if p.choice is None)
    finally:
        await decider.aclose()
    stats["cost"] = round(stats["cost"], 5)
    ctx.db.put_global("reassign_moves", moves_log)
    if dry_run:
        return {**stats, "seconds": round(time.monotonic() - t0, 1), "dry_run": True}
    ids = sorted(set(system))
    lay = finish(vectors, names, np.array([ids.index(s) for s in system]), outlier)
    carry_names(ctx.db, names, assign_ids(lay)[1])
    summary = store_layout(ctx, lay, {"reassigned": {"threshold": threshold, "moved": stats["moved"], "version": REASSIGN_VERSION}})
    return {**summary, **stats, "seconds": round(time.monotonic() - t0, 1)}
