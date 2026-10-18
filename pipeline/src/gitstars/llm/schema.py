from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Kind = Literal["library", "framework", "app", "cli", "tool", "service", "model", "dataset", "awesome-list", "tutorial", "template", "other"]


ONE_LINER_HARD_MAX_WORDS = 26


class Summary(BaseModel):
    """The fixed summary template. Prefer null over guessing."""

    model_config = ConfigDict(extra="forbid")

    one_liner: str = Field(description="What it is, at most 20 words.")
    summary: str = Field(description="2-4 specific sentences: what it is, what problem it solves, what makes it different.")
    kind: Kind
    domain: str | None = Field(description='Field it belongs to, e.g. "LLM inference". null if unclear.')
    tags: list[str] = Field(description="5-10 lowercase tags.")
    stack: list[str] = Field(description="Up to 6 main languages, frameworks or platforms.")
    audience: str | None = Field(description="Who it is for. null if unclear.")
    highlights: list[str] = Field(description="Up to 3 distinguishing features.")

    @field_validator("one_liner")
    @classmethod
    def _one_liner_len(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("one_liner is empty")
        # Models overshoot 20 by a word or two; rejecting those would burn a free request on a repair.
        if len(v.split()) > ONE_LINER_HARD_MAX_WORDS:
            raise ValueError("one_liner is longer than 20 words")
        return v

    @field_validator("summary")
    @classmethod
    def _summary_nonempty(cls, v: str) -> str:
        if len(v.strip()) < 20:
            raise ValueError("summary is too short")
        return v.strip()

    @field_validator("tags")
    @classmethod
    def _tags(cls, v: list[str]) -> list[str]:
        out: list[str] = []
        for t in v:
            t = re.sub(r"\s+", "-", t.strip().lower().lstrip("#"))
            if t and t not in out:
                out.append(t)
        return out[:10]

    @field_validator("stack")
    @classmethod
    def _stack(cls, v: list[str]) -> list[str]:
        return [s.strip() for s in v if s.strip()][:6]

    @field_validator("highlights")
    @classmethod
    def _highlights(cls, v: list[str]) -> list[str]:
        return [s.strip() for s in v if s.strip()][:3]


@dataclass(frozen=True)
class OutputSchema:
    """What a structured-output request asks the model for (sent as response_format json_schema, strict)."""

    name: str
    schema: dict[str, Any]


def json_schema() -> dict[str, Any]:
    """Strict-mode JSON schema: every property required, nullable fields typed as unions with null."""
    kinds = list(Kind.__args__)
    nullable = {"type": ["string", "null"]}
    strings = {"type": "array", "items": {"type": "string"}}
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["one_liner", "summary", "kind", "domain", "tags", "stack", "audience", "highlights"],
        "properties": {
            "one_liner": {"type": "string"},
            "summary": {"type": "string"},
            "kind": {"type": "string", "enum": kinds},
            "domain": nullable,
            "tags": strings,
            "stack": strings,
            "audience": nullable,
            "highlights": strings,
        },
    }


SUMMARY_SCHEMA = OutputSchema("repo_summary", json_schema())

_FENCED = re.compile(r"```(?:json)?\s*(\{.*\})\s*```", re.S)


def parse_summary(text: str) -> Summary:
    """Validate model output. Tolerates code fences and leading prose around a single JSON object."""
    text = text.strip()
    m = _FENCED.search(text)
    if m:
        text = m.group(1)
    elif not text.startswith("{"):
        start, end = text.find("{"), text.rfind("}")
        if start >= 0 and end > start:
            text = text[start : end + 1]
    data = json.loads(text)
    return Summary.model_validate(data)
