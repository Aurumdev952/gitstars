"""Core records shared by every stage. Stages read and write these, never raw API payloads."""

from __future__ import annotations

import hashlib
import json
from enum import StrEnum
from typing import Any, ClassVar

from pydantic import BaseModel, Field


class Repo(BaseModel):
    """One starred repository, keyed by `full_name` and versioned by its default-branch `head_oid`."""

    full_name: str
    owner: str
    head_oid: str = Field(description="Default-branch commit; empty string for an empty repo.")
    url: str
    description: str | None = None
    homepage: str | None = None
    topics: list[str] = []
    language: str | None = None
    languages: list[str] = []
    stars: int = 0
    pushed_at: str | None = None
    created_at: str | None = None
    starred_at: str
    archived: bool = False
    fork: bool = False
    license: str | None = None

    @property
    def name(self) -> str:
        return self.full_name.split("/", 1)[1]


def sha(obj: Any) -> str:
    data = obj if isinstance(obj, str) else json.dumps(obj, sort_keys=True, default=str)
    return hashlib.sha256(data.encode()).hexdigest()[:16]


class CacheKey(BaseModel, frozen=True):
    """A stage's output is reused while its version and the digest of everything it read are unchanged."""

    full_name: str
    stage_version: int
    digest: str


class TreeEntry(BaseModel, frozen=True):
    path: str
    type: str
    size: int | None = None


class CandidateId(StrEnum):
    readme = "readme"
    homepage = "homepage"
    manifest = "manifest"
    agents_md = "agents_md"
    claude_md = "claude_md"
    docs_index = "docs_index"
    architecture = "architecture"
    changelog_head = "changelog_head"


class Candidate(BaseModel):
    """A named snippet in the card pool. `preview` is what the gate sees; `text` is what the summarizer may get."""

    id: CandidateId
    source: str = Field(description="Path in the repo or the homepage URL.")
    text: str

    PREVIEW_CHARS: ClassVar[int] = 600

    @property
    def preview(self) -> str:
        return self.text[: self.PREVIEW_CHARS]


class Manifest(BaseModel):
    kind: str
    name: str | None = None
    description: str | None = None
    keywords: list[str] = []
    scripts: list[str] = []
    dependencies: list[str] = []


class HomepageDoc(BaseModel):
    url: str
    title: str | None = None
    description: str | None = None
    text: str = ""


class Card(BaseModel):
    """Everything the extractor knows about a repo before any LLM touches it."""

    full_name: str
    description: str | None
    topics: list[str]
    languages: list[str]
    tree: str
    manifests: list[Manifest] = []
    candidates: dict[CandidateId, Candidate] = {}

    def candidate_text(self, cid: CandidateId) -> str:
        c = self.candidates.get(cid)
        return c.text if c else ""


class ReadmeQuality(StrEnum):
    rich = "rich"
    partial = "partial"
    template = "template"
    missing = "missing"


class GateVerdict(BaseModel):
    keep: dict[CandidateId, float] = Field(description="Candidate id to p(project-specific).")
    readme_quality: ReadmeQuality
    model: str

    KEEP_THRESHOLD: ClassVar[float] = 0.5

    def kept(self, cid: CandidateId) -> bool:
        return self.keep.get(cid, 0.0) >= self.KEEP_THRESHOLD


class JudgeVerdict(BaseModel):
    score: float = Field(description="1..5, probability-weighted level position + 1.")
    p_unsupported: float
    p_generic: float
    model: str

    MIN_SCORE: ClassVar[float] = 3.5
    MAX_UNSUPPORTED: ClassVar[float] = 0.3
    MAX_GENERIC: ClassVar[float] = 0.4

    @property
    def passed(self) -> bool:
        return self.score >= self.MIN_SCORE and self.p_unsupported < self.MAX_UNSUPPORTED and self.p_generic < self.MAX_GENERIC

    @property
    def quality(self) -> float:
        return round(max(0.0, min(1.0, (self.score - 1.0) / 4.0)), 4)

    def rank_key(self) -> tuple[bool, float]:
        return (self.passed, self.quality)
