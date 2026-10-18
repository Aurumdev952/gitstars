"""Stage 6: EmbeddingGemma 2 on the local GPU. Two spaces per repo: `cluster` (layout) and `search` (export)."""

from __future__ import annotations

import time
from typing import Any

import numpy as np

from gitstars.cards import load_card
from gitstars.config import DOC_PREFIX, EMBED_MODEL, QUERY_PREFIX, SEARCH_DIMS
from gitstars.context import Ctx
from gitstars.domain import Repo, sha
from gitstars.extract import v0_text
from gitstars.llm.schema import Summary
from gitstars.summarize import load_summary

EMBED_VERSION = 1
BATCH = 32
MAX_SEQ_TOKENS = 2048
CLUSTER_PROMPT_NAME = "Clustering"
QUERY_PROMPT_NAME = "SearchQuery"

SEARCH_PROBES = [
    "run large language models locally on my GPU",
    "vector database for semantic search",
    "terminal user interface library",
    "self-hosted alternative to a SaaS product",
    "react component library with accessible primitives",
    "rust command line tool that replaces a unix utility",
    "curated list of resources",
    "build AI agents that use tools",
    "static site generator for documentation",
    "speech to text transcription model",
]


def summary_text(repo: Repo, s: Summary) -> str:
    lines = [f"{repo.name} — {s.one_liner}", s.summary]
    facts = [f"Kind: {s.kind}."]
    if s.domain:
        facts.append(f"Domain: {s.domain}.")
    if s.tags:
        facts.append("Tags: " + ", ".join(s.tags) + ".")
    lines.append(" ".join(facts))
    return "\n".join(lines)


def embedding_input(ctx: Ctx, repo: Repo) -> tuple[str, bool] | None:
    """(text, summarized). A fresh summary wins; otherwise the raw card (v0 mode)."""
    summary = load_summary(ctx.db, repo)
    if summary:
        return summary_text(repo, Summary.model_validate(summary["summary"])), True
    loaded = load_card(ctx.db, repo)
    if loaded is None:
        return None
    return v0_text(loaded[0], repo), False


def load_model() -> Any:
    import torch
    from sentence_transformers import SentenceTransformer

    # bf16, never fp16: Gemma activations overflow fp16. Nulling the vision/audio configs skips those towers
    # (744M → 271M params); the processor still imports PIL and torchvision, hence those deps.
    model = SentenceTransformer(
        EMBED_MODEL,
        device="cuda",
        model_kwargs={"dtype": torch.bfloat16},
        config_kwargs={"vision_config": None, "audio_config": None},
    )
    model.max_seq_length = MAX_SEQ_TOKENS
    return model


def encode(model: Any, texts: list[str], **kwargs: Any) -> np.ndarray:
    """float32 unit vectors; bf16 outputs come back with norms off by ~0.3%, so renormalize after the cast."""
    v = np.asarray(model.encode(texts, batch_size=BATCH, convert_to_numpy=True, **kwargs), dtype=np.float32)
    return v / np.linalg.norm(v, axis=1, keepdims=True).clip(min=1e-12)


def truncate(vectors: np.ndarray, dims: int = SEARCH_DIMS) -> np.ndarray:
    """Matryoshka truncation + renormalization."""
    v = np.asarray(vectors, dtype=np.float32)[:, :dims]
    return v / np.linalg.norm(v, axis=1, keepdims=True).clip(min=1e-12)


def embed_freshness(ctx: Ctx) -> dict[str, int]:
    """Repos whose stored vectors were made from their current embedding text, split by summary vs v0 card."""
    stored = ctx.db.embedding_shas("cluster")
    out = {"fresh_summary": 0, "fresh_card": 0, "stale": 0, "missing": 0}
    for repo in ctx.db.repos():
        inp = embedding_input(ctx, repo)
        have = stored.get(repo.full_name)
        if inp is None or have is None:
            out["missing"] += 1
        elif have == (sha(inp[0]), EMBED_VERSION):
            out["fresh_summary" if inp[1] else "fresh_card"] += 1
        else:
            out["stale"] += 1
    return out


def run_embed(ctx: Ctx) -> dict:
    repos = ctx.db.repos(order="stars")
    pending: list[tuple[Repo, str, str]] = []
    summarized = 0
    for repo in repos:
        inp = embedding_input(ctx, repo)
        if inp is None:
            continue
        text, is_summary = inp
        summarized += is_summary
        text_sha = sha(text)
        stored = ctx.db.get_embedding(repo.full_name, "cluster")
        if ctx.force or stored is None or stored[:2] != (text_sha, EMBED_VERSION):
            pending.append((repo, text, text_sha))
    pending = ctx.take(pending)

    t0 = time.monotonic()
    model = load_model() if pending or ctx.db.get_global("probe_vectors") is None else None
    load_s = time.monotonic() - t0
    if pending:
        texts = [t for _, t, _ in pending]
        docs = [DOC_PREFIX.format(title=r.full_name, text=t) for r, t, _ in pending]
        t1 = time.monotonic()
        cluster = encode(model, texts, prompt_name=CLUSTER_PROMPT_NAME)
        # prompt="" so a model-level default prompt can't sneak in; the doc prefix is already in the text.
        search = encode(model, docs, prompt="")
        encode_s = time.monotonic() - t1
        ctx.db.put_embeddings("cluster", EMBED_VERSION, [(r.full_name, s, v) for (r, _, s), v in zip(pending, cluster)])
        ctx.db.put_embeddings("search", EMBED_VERSION, [(r.full_name, s, v) for (r, _, s), v in zip(pending, search)])
    else:
        encode_s = 0.0
    if model is not None:
        if model.prompts.get(QUERY_PROMPT_NAME) != QUERY_PREFIX:
            raise RuntimeError(f"model prompt {QUERY_PROMPT_NAME!r} differs from meta.embedding.queryPrefix; the browser would drift")
        q = encode(model, SEARCH_PROBES, prompt_name=QUERY_PROMPT_NAME)
        ctx.db.put_global("probe_vectors", {"queries": SEARCH_PROBES, "vectors": truncate(q).tolist()})
    return {
        "repos": len(repos),
        "embedded": len(pending),
        "summarized_inputs": summarized,
        "v0_inputs": len(repos) - summarized,
        "model_load_seconds": round(load_s, 1),
        "encode_seconds": round(encode_s, 1),
        "dims": int(cluster.shape[1]) if pending else None,
    }
