from __future__ import annotations

from dataclasses import dataclass
from typing import Any, TypeVar

from rich.console import Console

from gitstars.config import Paths
from gitstars.db import DB
from gitstars.domain import CacheKey, Repo

T = TypeVar("T")


def commit_key(repo: Repo, version: int) -> CacheKey:
    """For stages that read the repo at its default-branch commit (tree, card)."""
    return CacheKey(full_name=repo.full_name, stage_version=version, digest=repo.head_oid)


@dataclass
class Ctx:
    paths: Paths
    db: DB
    console: Console
    limit: int | None = None
    force: bool = False
    only: tuple[str, ...] = ()

    def selected(self, order: str = "stars") -> list[Repo]:
        """Active repos in `order`, narrowed to `only` (owner/name, any case) when given."""
        repos = self.db.repos(order=order)
        if not self.only:
            return repos
        wanted = {n.lower() for n in self.only}
        return [r for r in repos if r.full_name.lower() in wanted]

    def take(self, pending: list[T]) -> list[T]:
        """`--limit N`: process at most N of the items that actually need work this run."""
        return pending if self.limit is None else pending[: self.limit]

    def cached(self, stage: str, key: CacheKey) -> Any | None:
        return None if self.force else self.db.get_artifact(stage, key)
