"""What a judge sees of a system, and which systems are worth asking about for a repo. Shared by the misfit
metric (`gs misfits`, local Gemma) and the semantic reassignment (`gs reassign`, pplx-decider)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

from gitstars.db import DB
from gitstars.naming import cluster_name, nearest_to_centroid

CORE_SAMPLES = 5
OTHER_CANDIDATES = 4
VOTE_K = 15
# Candidate keys as a judge sees them; "A" is always the current system.
LETTERS = "ABCDE"


@dataclass(frozen=True)
class SystemCard:
    id: str
    name: str
    blurb: str
    core: tuple[str, ...]

    def as_state(self) -> dict[str, Any]:
        return {"name": self.name, "blurb": self.blurb, "central_members": list(self.core)}


def system_cards(db: DB, layout: dict[str, Any], vectors: np.ndarray) -> dict[str, SystemCard]:
    """One card per system: its name and blurb, and the `CORE_SAMPLES` non-outlier members nearest its centroid."""
    from gitstars.export import one_liner_for

    names = layout["names"]
    repos = {r.full_name: r for r in db.repos()}
    members: dict[str, list[int]] = {}
    for i, cid in enumerate(layout["system"]):
        members.setdefault(cid, []).append(i)
    out: dict[str, SystemCard] = {}
    for cid, idx in members.items():
        nm = cluster_name(db, layout, cid, [names[i] for i in idx])
        core = [i for i in idx if not layout["outlier"][i]] or idx
        central = nearest_to_centroid(vectors, core, CORE_SAMPLES)
        out[cid] = SystemCard(cid, nm["name"], nm["blurb"], tuple(f"{names[i]}: {one_liner_for(db, repos[names[i]])}" for i in central))
    return out


class Candidates:
    """Per repo, the current system first, then `OTHER_CANDIDATES` others: those its nearest repos belong to, by
    vote weight, then the nearest system centroids. The vote finds the right home for a repo at a wide system's
    edge; the centroid finds it when no neighbour lives there."""

    def __init__(self, system: list[str], vectors: np.ndarray, k: int = VOTE_K, others: int = OTHER_CANDIDATES):
        self.system = system
        self.others = others
        ids = sorted(set(system))
        self.ids = ids
        cents = np.stack([vectors[[i for i, s in enumerate(system) if s == c]].mean(axis=0) for c in ids])
        cents /= np.linalg.norm(cents, axis=1, keepdims=True)
        self.centroid_rank = np.argsort(-(vectors @ cents.T), axis=1)
        sims = vectors @ vectors.T
        np.fill_diagonal(sims, -np.inf)
        kk = min(k, len(system) - 1)
        self.nb = np.argpartition(-sims, kth=kk - 1, axis=1)[:, :kk]
        self.nb_w = np.take_along_axis(sims, self.nb, axis=1)

    def for_repo(self, i: int) -> list[str]:
        cur = self.system[i]
        weight: dict[str, float] = {}
        for j, w in zip(self.nb[i], self.nb_w[i]):
            weight[self.system[j]] = weight.get(self.system[j], 0.0) + float(w)
        out = [cur]
        for s in sorted(weight, key=lambda s: -weight[s]):
            if s != cur and s not in out:
                out.append(s)
        for c in self.centroid_rank[i]:
            if len(out) > self.others:
                break
            if self.ids[c] not in out:
                out.append(self.ids[c])
        return out[: self.others + 1]
