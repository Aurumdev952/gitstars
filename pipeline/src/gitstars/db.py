"""SQLite store. Per-repo stage output is cached under (stage, full_name), valid while its version and input digest match."""

from __future__ import annotations

import json
import sqlite3
import time
from collections.abc import Iterable, Iterator
from pathlib import Path
from typing import Any

import numpy as np

from gitstars.domain import CacheKey, Repo, sha

SCHEMA = """
CREATE TABLE IF NOT EXISTS repos (
  full_name TEXT PRIMARY KEY,
  head_oid TEXT NOT NULL,
  starred_at TEXT NOT NULL,
  stars INTEGER NOT NULL,
  data TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  fetched_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS blobs (
  full_name TEXT NOT NULL,
  head_oid TEXT NOT NULL,
  path TEXT NOT NULL,
  text TEXT,
  PRIMARY KEY (full_name, head_oid, path)
);
CREATE TABLE IF NOT EXISTS artifacts (
  stage TEXT NOT NULL,
  full_name TEXT NOT NULL,
  digest TEXT NOT NULL,
  version INTEGER NOT NULL,
  payload TEXT NOT NULL,
  updated_at REAL NOT NULL,
  PRIMARY KEY (stage, full_name)
);
CREATE TABLE IF NOT EXISTS homepages (
  url TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  payload TEXT NOT NULL,
  fetched_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  purpose TEXT NOT NULL,
  request TEXT NOT NULL,
  response TEXT,
  error TEXT,
  created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS llm_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  outcome TEXT NOT NULL,
  latency_s REAL,
  created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS embeddings (
  full_name TEXT NOT NULL,
  space TEXT NOT NULL,
  version INTEGER NOT NULL,
  text_sha TEXT NOT NULL,
  vec BLOB NOT NULL,
  PRIMARY KEY (full_name, space)
);
CREATE TABLE IF NOT EXISTS globals (
  name TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at REAL NOT NULL
);
"""

DISABLED_MODEL_TTL_S = 7 * 86400


class DB:
    def __init__(self, path: Path | str):
        if isinstance(path, Path):
            path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(path))
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA synchronous=NORMAL")
        _migrate_digest_keys(self.conn)
        self.conn.executescript(SCHEMA)

    def close(self) -> None:
        self.conn.close()

    def upsert_repos(self, repos: Iterable[Repo]) -> None:
        """Replace the active star set. Repos no longer starred stay in the table, marked inactive."""
        now = time.time()
        with self.conn:
            self.conn.execute("UPDATE repos SET active = 0")
            self.conn.executemany(
                "INSERT INTO repos (full_name, head_oid, starred_at, stars, data, active, fetched_at)"
                " VALUES (?, ?, ?, ?, ?, 1, ?)"
                " ON CONFLICT(full_name) DO UPDATE SET head_oid=excluded.head_oid, starred_at=excluded.starred_at,"
                " stars=excluded.stars, data=excluded.data, active=1, fetched_at=excluded.fetched_at",
                [(r.full_name, r.head_oid, r.starred_at, r.stars, r.model_dump_json(), now) for r in repos],
            )

    def repos(self, order: str = "starred", limit: int | None = None) -> list[Repo]:
        """Active repos. `order`: 'starred' (newest star first) or 'stars' (most stargazers first)."""
        order_sql = {"starred": "starred_at DESC", "stars": "stars DESC, full_name"}[order]
        sql = f"SELECT data FROM repos WHERE active = 1 ORDER BY {order_sql}"
        if limit is not None:
            sql += f" LIMIT {int(limit)}"
        return [Repo.model_validate_json(row[0]) for row in self.conn.execute(sql)]

    def repo(self, full_name: str) -> Repo | None:
        row = self.conn.execute("SELECT data FROM repos WHERE full_name = ? COLLATE NOCASE", (full_name,)).fetchone()
        return Repo.model_validate_json(row[0]) if row else None

    def put_blobs(self, full_name: str, head_oid: str, blobs: dict[str, str | None]) -> None:
        with self.conn:
            self.conn.executemany(
                "INSERT OR REPLACE INTO blobs (full_name, head_oid, path, text) VALUES (?, ?, ?, ?)",
                [(full_name, head_oid, p, t) for p, t in blobs.items()],
            )

    def blobs(self, full_name: str, head_oid: str) -> dict[str, str | None]:
        rows = self.conn.execute("SELECT path, text FROM blobs WHERE full_name = ? AND head_oid = ?", (full_name, head_oid))
        return dict(rows.fetchall())

    def get_artifact(self, stage: str, key: CacheKey) -> Any | None:
        """The cached payload only when stage version and input digest both match; otherwise a miss."""
        row = self.conn.execute(
            "SELECT payload FROM artifacts WHERE stage = ? AND full_name = ? AND digest = ? AND version = ?",
            (stage, key.full_name, key.digest, key.stage_version),
        ).fetchone()
        return json.loads(row[0]) if row else None

    def latest_artifact(self, stage: str, full_name: str) -> Any | None:
        row = self.conn.execute("SELECT payload FROM artifacts WHERE stage = ? AND full_name = ?", (stage, full_name)).fetchone()
        return json.loads(row[0]) if row else None

    def put_artifact(self, stage: str, key: CacheKey, payload: Any) -> None:
        with self.conn:
            self.conn.execute(
                "INSERT OR REPLACE INTO artifacts (stage, full_name, digest, version, payload, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                (stage, key.full_name, key.digest, key.stage_version, json.dumps(payload), time.time()),
            )

    def artifacts(self, stage: str) -> Iterator[tuple[str, Any]]:
        for name, payload in self.conn.execute("SELECT full_name, payload FROM artifacts WHERE stage = ?", (stage,)):
            yield name, json.loads(payload)

    def get_homepage(self, url: str, version: int) -> Any | None:
        row = self.conn.execute("SELECT payload FROM homepages WHERE url = ? AND version = ?", (url, version)).fetchone()
        return json.loads(row[0]) if row else None

    def put_homepage(self, url: str, version: int, payload: Any) -> None:
        with self.conn:
            self.conn.execute(
                "INSERT OR REPLACE INTO homepages (url, version, payload, fetched_at) VALUES (?, ?, ?, ?)",
                (url, version, json.dumps(payload), time.time()),
            )

    def log_decision(self, full_name: str, purpose: str, request: Any, response: Any | None, error: str | None) -> None:
        with self.conn:
            self.conn.execute(
                "INSERT INTO decisions (full_name, purpose, request, response, error, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (full_name, purpose, json.dumps(request), json.dumps(response) if response is not None else None, error, time.time()),
            )

    def log_llm_call(self, full_name: str, provider: str, model: str, outcome: str, latency_s: float | None) -> None:
        with self.conn:
            self.conn.execute(
                "INSERT INTO llm_calls (full_name, provider, model, outcome, latency_s, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (full_name, provider, model, outcome, latency_s, time.time()),
            )

    def get_embedding(self, full_name: str, space: str) -> tuple[str, int, np.ndarray] | None:
        """(text_sha, version, vector)."""
        row = self.conn.execute(
            "SELECT text_sha, version, vec FROM embeddings WHERE full_name = ? AND space = ?", (full_name, space)
        ).fetchone()
        if not row:
            return None
        return row[0], row[1], np.frombuffer(row[2], dtype=np.float32)

    def embedding_shas(self, space: str) -> dict[str, tuple[str, int]]:
        rows = self.conn.execute("SELECT full_name, text_sha, version FROM embeddings WHERE space = ?", (space,))
        return {n: (t, v) for n, t, v in rows}

    def embeddings_digest(self, names: list[str]) -> str:
        """Digest of the texts behind the `cluster` vectors, in `names` order; a layout is valid while this holds."""
        shas = self.embedding_shas("cluster")
        return sha([shas[n][0] for n in names])

    def put_embeddings(self, space: str, version: int, rows: Iterable[tuple[str, str, np.ndarray]]) -> None:
        with self.conn:
            self.conn.executemany(
                "INSERT OR REPLACE INTO embeddings (full_name, space, version, text_sha, vec) VALUES (?, ?, ?, ?, ?)",
                [(n, space, version, sha, np.asarray(v, dtype=np.float32).tobytes()) for n, sha, v in rows],
            )

    def embedding_matrix(self, space: str, names: list[str]) -> np.ndarray:
        found = dict(
            self.conn.execute(
                f"SELECT full_name, vec FROM embeddings WHERE space = ? AND full_name IN ({','.join('?' * len(names))})",
                (space, *names),
            ).fetchall()
        )
        missing = [n for n in names if n not in found]
        if missing:
            raise LookupError(f"{len(missing)} repos have no '{space}' embedding (first: {missing[0]}); run `gs embed`")
        return np.stack([np.frombuffer(found[n], dtype=np.float32) for n in names])

    def disable_model(self, model: str, reason: str) -> None:
        """Remember a model that refused us permanently (HTTP 403) so later runs leave it out of the pool."""
        disabled = self.get_global("disabled_models") or {}
        disabled[model] = {"reason": reason[:200], "at": time.time()}
        self.put_global("disabled_models", disabled)

    def disabled_models(self, max_age_s: float = DISABLED_MODEL_TTL_S) -> frozenset[str]:
        """Expiring, because an upstream can lift a restriction; one probe request a week is cheap."""
        now = time.time()
        return frozenset(m for m, v in (self.get_global("disabled_models") or {}).items() if now - v["at"] < max_age_s)

    def get_global(self, name: str) -> Any | None:
        row = self.conn.execute("SELECT payload FROM globals WHERE name = ?", (name,)).fetchone()
        return json.loads(row[0]) if row else None

    def put_global(self, name: str, payload: Any) -> None:
        with self.conn:
            self.conn.execute(
                "INSERT OR REPLACE INTO globals (name, payload, updated_at) VALUES (?, ?, ?)",
                (name, json.dumps(payload), time.time()),
            )


def _migrate_digest_keys(conn: sqlite3.Connection) -> None:
    """Pre-digest stores keyed gate and summary rows on head_oid, so any push invalidated them. Re-key them on the
    digest of what the stage read; those rows were all made by prompt version 1. Embeddings drop head_oid."""
    if "head_oid" not in {r[1] for r in conn.execute("PRAGMA table_info(artifacts)")}:
        return
    conn.execute("BEGIN IMMEDIATE")
    try:
        conn.execute("ALTER TABLE artifacts RENAME COLUMN head_oid TO digest")
        rows = conn.execute("SELECT stage, full_name, payload FROM artifacts WHERE stage IN ('gate', 'summary')").fetchall()
        for stage, name, payload in rows:
            input_sha = json.loads(payload)["input_sha"]
            digest = sha([input_sha, 1]) if stage == "gate" else sha([input_sha, 1, 1])
            conn.execute("UPDATE artifacts SET digest = ? WHERE stage = ? AND full_name = ?", (digest, stage, name))
        if "head_oid" in {r[1] for r in conn.execute("PRAGMA table_info(embeddings)")}:
            conn.execute("ALTER TABLE embeddings DROP COLUMN head_oid")
    except BaseException:
        conn.rollback()
        raise
    conn.commit()
