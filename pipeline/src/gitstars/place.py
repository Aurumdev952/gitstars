"""Incremental layout: new stars join the stored galaxy without rerunning UMAP, which would reshuffle a map the user
already knows. Every placed repo keeps its position, system, galaxy and name; unstarred repos leave."""

from __future__ import annotations

import time
from dataclasses import dataclass

import numpy as np

from gitstars.context import Ctx
from gitstars.db import DB
from gitstars.domain import sha
from gitstars.layout import EXTENT, HOME_SHARE, NEIGHBORS, cluster_space, top_neighbors

PLACE_VERSION = 1
VOTE_K = NEIGHBORS
# Jitter is this share of how far the voting neighbours sit from their weighted mean, so a new star lands among
# them rather than on a point any other new star with the same neighbours would also take.
JITTER = 0.15
MIN_SPREAD = EXTENT * 0.005


@dataclass
class Placement:
    system: str
    outlier: bool
    pos: list[float]
    pos2: list[float]


def _near(centre_of: np.ndarray, weights: np.ndarray, rng: np.random.Generator) -> list[float]:
    centre = (centre_of * weights[:, None]).sum(axis=0) / weights.sum()
    spread = max(float(np.linalg.norm(centre_of - centre, axis=1).mean()), MIN_SPREAD)
    return np.round(centre + rng.normal(size=centre.shape) * JITTER * spread, 3).tolist()


def place_new(
    existing: np.ndarray, system: list[str], pos: np.ndarray, pos2: np.ndarray, new: np.ndarray, new_names: list[str], k: int = VOTE_K
) -> list[Placement]:
    """Each new repo joins the system most of its k nearest existing repos (cosine, cluster space) belong to; ties go
    to the higher summed similarity. Its positions are the similarity-weighted mean of those winning neighbours plus
    a jitter seeded by its name. Neighbours from other systems don't pull it, since they may sit in another galaxy.
    Like HDBSCAN noise in `vote_noise`, a repo whose winner holds less than HOME_SHARE of the vote is an outlier."""
    k = min(k, len(existing))
    if k == 0:
        raise RuntimeError("the stored layout has no repos left to place beside; run `gs layout`")
    out = []
    for v, name in zip(new, new_names):
        sims = existing @ v
        top = np.argpartition(-sims, kth=k - 1)[:k]
        tally: dict[str, tuple[int, float]] = {}
        for j in top.tolist():
            n, s = tally.get(system[j], (0, 0.0))
            tally[system[j]] = (n + 1, s + float(sims[j]))
        winner = max(tally, key=lambda s: tally[s])
        members = np.array([j for j in top.tolist() if system[j] == winner])
        weights = np.clip(sims[members], 1e-3, None)
        rng = np.random.default_rng(int(sha([name, PLACE_VERSION]), 16))
        out.append(
            Placement(
                system=winner,
                outlier=tally[winner][0] / k < HOME_SHARE,
                pos=_near(pos[members], weights, rng),
                pos2=_near(pos2[members], weights, rng),
            )
        )
    return out


def carry_names(db: DB, before: dict[str, list[str]], after: dict[str, list[str]]) -> int:
    """An LLM name made for a cluster's old members follows the cluster to its new members: placement only adds
    and drops a few repos, and a renamed system on every new star would defeat keeping the map familiar."""
    stored = db.get_global("llm_names") or {}
    carried = 0
    for cid, members in after.items():
        llm = stored.get(cid)
        if llm and members != before.get(cid) and llm.get("members_sha") == sha(before.get(cid, [])):
            stored[cid] = {**llm, "members_sha": sha(members)}
            carried += 1
    if carried:
        db.put_global("llm_names", stored)
    return carried


def members_by_cluster(names: list[str], galaxy: list[str], system: list[str]) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for ids in (galaxy, system):
        for n, cid in zip(names, ids):
            out.setdefault(cid, []).append(n)
    return out


def run_place(ctx: Ctx) -> dict:
    stored = ctx.db.get_global("layout")
    if not stored:
        raise RuntimeError("no layout to place new stars into; run `gs layout` first")
    t0 = time.monotonic()
    old_names: list[str] = stored["names"]
    active = [r.full_name for r in ctx.db.repos(order="starred")]
    active_set, known = set(active), set(old_names)
    kept = [i for i, n in enumerate(old_names) if n in active_set]
    # Appended rather than merged in starred order, so every kept repo keeps its index and its neighbour lists.
    added = [n for n in active if n not in known]
    names = [old_names[i] for i in kept] + added
    vectors = cluster_space(ctx.db.embedding_matrix("cluster", names))
    digest = ctx.db.embeddings_digest(names)
    dropped = len(old_names) - len(kept)
    stats = {"placed": len(added), "dropped": dropped, "total": len(names)}
    if not added and not dropped and digest == stored["input_sha"] and not ctx.force:
        return {**stats, "seconds": round(time.monotonic() - t0, 1)}

    old_pos, old_pos2 = np.asarray(stored["pos"]), np.asarray(stored["pos2"])
    system = [stored["system"][i] for i in kept]
    outlier = [bool(stored["outlier"][i]) for i in kept]
    pos = [stored["pos"][i] for i in kept]
    pos2 = [stored["pos2"][i] for i in kept]
    n_kept = len(kept)
    for p in place_new(vectors[:n_kept], system, old_pos[kept], old_pos2[kept], vectors[n_kept:], added):
        system.append(p.system)
        outlier.append(p.outlier)
        pos.append(p.pos)
        pos2.append(p.pos2)

    # Kept repos keep their neighbour lists, re-indexed; only a list that named an unstarred repo is recomputed.
    index = {old: new for new, old in enumerate(kept)}
    neighbors: list[list] = []
    fresh: list[list[tuple[int, float]]] | None = None
    for new_i, old_i in enumerate(kept):
        row = stored["neighbors"][old_i]
        if all(j in index for j, _ in row):
            neighbors.append([[index[j], c] for j, c in row])
            continue
        fresh = fresh or top_neighbors(vectors)
        neighbors.append(fresh[new_i])
    if added:
        fresh = fresh or top_neighbors(vectors)
        neighbors.extend(fresh[n_kept:])

    galaxy = [s.split(".")[0] for s in system]
    carried = carry_names(
        ctx.db,
        members_by_cluster(old_names, stored["galaxy"], stored["system"]),
        members_by_cluster(names, galaxy, system),
    )
    ctx.db.put_global(
        "layout",
        {
            **stored,
            "names": names,
            "input_sha": digest,
            "galaxy": galaxy,
            "system": system,
            "outlier": outlier,
            "pos": pos,
            "pos2": pos2,
            "neighbors": neighbors,
            "placed": {"version": PLACE_VERSION, "added": len(added), "dropped": dropped},
        },
    )
    return {**stats, "names_carried": carried, "seconds": round(time.monotonic() - t0, 1)}
