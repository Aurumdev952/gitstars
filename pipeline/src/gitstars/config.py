from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Literal

Provider = Literal["openrouter", "local"]

DECIDER_MODEL = "perplexity/pplx-decider-v1.2"
EMBED_MODEL = "google/embeddinggemma-2"
BROWSER_EMBED_MODEL = "onnx-community/embeddinggemma-2-ONNX"
QUERY_PREFIX = "task: search result | query: "
DOC_PREFIX = "title: {title} | text: {text}"
SEARCH_DIMS = 256

LOCAL_BASE_URL = "http://127.0.0.1:8000/v1"
LOCAL_MODEL = "gemma-4-26b"
OPENROUTER_API = "https://openrouter.ai/api/v1"
DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions"


@cache
def main_checkout_root() -> Path:
    """The main checkout, even when running from a linked worktree, so every worktree shares one data dir."""
    out = subprocess.run(
        ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
        capture_output=True,
        text=True,
        check=True,
        cwd=Path(__file__).resolve().parent,
    )
    return Path(out.stdout.strip()).parent


@dataclass(frozen=True)
class Paths:
    data: Path
    export: Path

    @property
    def db(self) -> Path:
        return self.data / "gitstars.db"

    @classmethod
    def resolve(cls) -> Paths:
        data = os.environ.get("GITSTARS_DATA")
        export = os.environ.get("GITSTARS_EXPORT")
        root = None if (data and export) else main_checkout_root()
        return cls(
            data=Path(data) if data else root / "data",
            export=Path(export) if export else root / "web" / "public" / "data",
        )


def github_token() -> str:
    return subprocess.run(["gh", "auth", "token"], capture_output=True, text=True, check=True).stdout.strip()


def openrouter_key() -> str:
    """Read at call time and keep only in memory; never log, print, or persist it."""
    if key := os.environ.get("OPENROUTER_API_KEY", "").strip():
        return key
    try:
        out = subprocess.run(["keysvc", "get", "or-key"], capture_output=True, text=True)
    except FileNotFoundError:
        out = None
    if out is None or out.returncode != 0 or not out.stdout.strip():
        raise RuntimeError("set OPENROUTER_API_KEY (or provide it through `keysvc get or-key`)")
    return out.stdout.strip()
