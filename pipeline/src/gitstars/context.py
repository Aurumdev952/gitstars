from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any

from rich.console import Console

from gitstars.config import Paths
from gitstars.db import DB
from gitstars.domain import CacheKey, Repo


def cache_key(repo: Repo, version: int) -> CacheKey:
    return CacheKey(full_name=repo.full_name, head_oid=repo.head_oid, stage_version=version)


@dataclass
class Ctx:
    paths: Paths
    db: DB
    console: Console
    limit: int | None = None
    force: bool = False

    def key(self, repo: Repo, version: int) -> CacheKey:
        return cache_key(repo, version)

    def cached(self, stage: str, repo: Repo, version: int, input_sha: str | None = None) -> Any | None:
        """A stage's cached payload when (full_name, head_oid, version) match and, if given, its input digest too."""
        if self.force:
            return None
        payload = self.db.get_artifact(stage, self.key(repo, version))
        if payload is None or (input_sha is not None and payload.get("input_sha") != input_sha):
            return None
        return payload


def sha(obj: Any) -> str:
    data = obj if isinstance(obj, str) else json.dumps(obj, sort_keys=True, default=str)
    return hashlib.sha256(data.encode()).hexdigest()[:16]
