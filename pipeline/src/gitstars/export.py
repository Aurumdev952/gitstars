"""Stage 9: galaxy.json + vectors.f16.bin, validated against contract/galaxy.schema.json before writing."""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from functools import cache
from pathlib import Path
from typing import Any

import numpy as np
from jsonschema import Draft202012Validator, FormatChecker

from gitstars.config import BROWSER_EMBED_MODEL, DOC_PREFIX, EMBED_MODEL, QUERY_PREFIX, SEARCH_DIMS, VIEWER, main_checkout_root
from gitstars.context import Ctx
from gitstars.db import DB
from gitstars.domain import Repo, sha
from gitstars.embed import truncate
from gitstars.naming import cluster_name
from gitstars.summarize import load_summary

CLUSTER_RADIUS_PERCENTILE = 90
PROBE_TOP = 10


class ExportInvalid(ValueError):
    pass


def contract_path() -> Path:
    env = os.environ.get("GITSTARS_CONTRACT")
    if env:
        return Path(env)
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / "contract" / "galaxy.schema.json"
        if candidate.exists():
            return candidate
    return main_checkout_root() / "contract" / "galaxy.schema.json"


@cache
def validator() -> Draft202012Validator:
    schema = json.loads(contract_path().read_text())
    return Draft202012Validator(schema, format_checker=FormatChecker())


def validate(doc: dict[str, Any]) -> None:
    errors = sorted(validator().iter_errors(doc), key=lambda e: list(e.absolute_path))
    if errors:
        head = "; ".join(f"{'/'.join(map(str, e.absolute_path)) or '<root>'}: {e.message[:160]}" for e in errors[:5])
        raise ExportInvalid(f"{len(errors)} contract violations: {head}")


def iso(ts: str | None) -> str | None:
    return ts.replace("+00:00", "Z") if ts else None


def guess_kind(repo: Repo) -> str:
    text = " ".join([repo.name, *repo.topics]).lower()
    return "awesome-list" if "awesome" in text else "other"


def one_liner_for(db: DB, repo: Repo) -> str:
    art = load_summary(db, repo)
    if art:
        return art["summary"]["one_liner"]
    return repo.description or repo.name


def repo_record(db: DB, repo: Repo, i: int, layout: dict[str, Any]) -> dict[str, Any]:
    art = load_summary(db, repo)
    s = art["summary"] if art else None
    return {
        "fullName": repo.full_name,
        "url": repo.url,
        "homepage": repo.homepage,
        "description": repo.description,
        "oneLiner": s["one_liner"] if s else (repo.description or repo.name),
        "summary": s["summary"] if s else None,
        "kind": s["kind"] if s else guess_kind(repo),
        "domain": s["domain"] if s else None,
        "tags": s["tags"] if s else [t.lower() for t in repo.topics][:10],
        "stack": s["stack"] if s else repo.languages[:6],
        "language": repo.language,
        "stars": repo.stars,
        "pushedAt": iso(repo.pushed_at),
        "starredAt": iso(repo.starred_at),
        "archived": repo.archived,
        "pos": layout["pos"][i],
        "pos2": layout["pos2"][i],
        "galaxyId": layout["galaxy"][i],
        "systemId": layout["system"][i],
        "outlier": bool(layout["outlier"][i]),
        "neighbors": [[int(j), float(c)] for j, c in layout["neighbors"][i]],
        "quality": art["quality"] if art else None,
        "summarized": art is not None,
    }


def cluster_records(db: DB, layout: dict[str, Any]) -> list[dict[str, Any]]:
    pos = np.asarray(layout["pos"], dtype=np.float64)
    names = layout["names"]
    out: list[dict[str, Any]] = []
    for level, ids in ((0, layout["galaxy"]), (1, layout["system"])):
        for cid in sorted(set(ids)):
            members = [i for i, x in enumerate(ids) if x == cid]
            pts = pos[members]
            centroid = pts.mean(axis=0)
            radius = float(np.percentile(np.linalg.norm(pts - centroid, axis=1), CLUSTER_RADIUS_PERCENTILE))
            nm = cluster_name(db, layout, cid, [names[i] for i in members])
            out.append(
                {
                    "id": cid,
                    "level": level,
                    "parentId": None if level == 0 else cid.split(".")[0],
                    "name": nm["name"],
                    "blurb": nm["blurb"],
                    "keywords": nm["keywords"],
                    "centroid": [round(float(x), 3) for x in centroid],
                    "radius": round(radius, 3),
                    "members": members,
                }
            )
    return out


def search_vectors(db: DB, names: list[str]) -> np.ndarray:
    return truncate(db.embedding_matrix("search", names), SEARCH_DIMS)


def probes(db: DB, vectors: np.ndarray) -> list[dict[str, Any]]:
    stored = db.get_global("probe_vectors")
    if not stored:
        return []
    q = np.asarray(stored["vectors"], dtype=np.float32)
    # Score against the exported f16 values, which is what the browser will search.
    sims = q @ vectors.astype(np.float16).astype(np.float32).T
    return [{"query": query, "topIdx": [int(j) for j in np.argsort(-row)[:PROBE_TOP]]} for query, row in zip(stored["queries"], sims)]


def build(db: DB, viewer: str) -> tuple[dict[str, Any], np.ndarray]:
    layout = db.get_global("layout")
    if not layout:
        raise RuntimeError("no layout; run `gs layout` first")
    repos = {r.full_name: r for r in db.repos()}
    names = layout["names"]
    if set(names) != set(repos):
        raise RuntimeError(f"layout covers {len(names)} repos but {len(repos)} are starred; rerun `gs embed` and `gs layout`")
    current = db.embeddings_digest(names)
    if current != layout["input_sha"]:
        raise RuntimeError("embeddings changed since the last layout; rerun `gs layout`")
    ordered = [repos[n] for n in names]
    records = [repo_record(db, r, i, layout) for i, r in enumerate(ordered)]
    vecs = search_vectors(db, names)
    pos = np.asarray(layout["pos"])
    starred = sorted(r["starredAt"] for r in records)
    doc = {
        "schemaVersion": 1,
        "meta": {
            "generatedAt": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "viewer": viewer,
            "counts": {
                "repos": len(records),
                "galaxies": len(set(layout["galaxy"])),
                "systems": len(set(layout["system"])),
                "summarized": sum(r["summarized"] for r in records),
            },
            "bounds": {"min": [round(float(x), 3) for x in pos.min(axis=0)], "max": [round(float(x), 3) for x in pos.max(axis=0)]},
            "starredRange": [starred[0], starred[-1]],
            "embedding": {
                "model": EMBED_MODEL,
                "browserModel": BROWSER_EMBED_MODEL,
                "dims": SEARCH_DIMS,
                "dtype": "float16",
                "normalized": True,
                "queryPrefix": QUERY_PREFIX,
                "docPrefix": DOC_PREFIX,
            },
            "searchProbes": probes(db, vecs),
        },
        "clusters": cluster_records(db, layout),
        "repos": records,
    }
    return doc, vecs


def write_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def run_export(ctx: Ctx) -> dict:
    stats = ctx.db.get_global("fetch") or {}
    doc, vecs = build(ctx.db, stats.get("viewer") or VIEWER)
    validate(doc)
    body = json.dumps(doc, separators=(",", ":"), ensure_ascii=False).encode()
    f16 = np.ascontiguousarray(vecs.astype("<f2"))
    write_atomic(ctx.paths.export / "galaxy.json", body)
    write_atomic(ctx.paths.export / "vectors.f16.bin", f16.tobytes())
    ctx.db.put_global("export", {"at": doc["meta"]["generatedAt"], "counts": doc["meta"]["counts"], "sha": sha(body.decode())})
    return {
        "path": str(ctx.paths.export / "galaxy.json"),
        "bytes": len(body),
        "vectors_bytes": f16.nbytes,
        "vectors_shape": list(f16.shape),
        **doc["meta"]["counts"],
        "probes": len(doc["meta"]["searchProbes"]),
    }
