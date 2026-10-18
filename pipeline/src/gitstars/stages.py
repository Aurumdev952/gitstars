"""Stage registry: name → version → runner, in pipeline order. `gs run` walks it; each CLI command looks one up."""

from __future__ import annotations

import asyncio
import inspect
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from gitstars import cards, embed, export, layout, naming, summarize
from gitstars.context import Ctx


@dataclass(frozen=True)
class Stage:
    name: str
    version: int
    run: Callable[..., Any]
    help: str
    uses_llm: bool = False

    def __call__(self, ctx: Ctx, **kwargs: Any) -> dict:
        result = self.run(ctx, **kwargs)
        return asyncio.run(result) if inspect.iscoroutine(result) else result


STAGES: dict[str, Stage] = {
    s.name: s
    for s in [
        Stage("fetch", cards.TREE_VERSION, cards.run_fetch, "GitHub stars, depth-2 trees, README/manifests/docs blobs."),
        Stage("homepage", cards.HOMEPAGE_VERSION, cards.run_homepage, "Fetch homepages and extract main text."),
        Stage("card", cards.CARD_VERSION, cards.run_card, "Build cards (candidate pool) and count tokens."),
        Stage("gate", cards.GATE_VERSION, cards.run_gate, "pplx-decider keeps project-specific candidates.", uses_llm=True),
        Stage(
            "summarize",
            summarize.SUMMARY_VERSION,
            summarize.run_summarize,
            "Summarize on the model pool, judge with the decider.",
            uses_llm=True,
        ),
        Stage("embed", embed.EMBED_VERSION, embed.run_embed, "EmbeddingGemma 2 vectors (summary, or v0 card)."),
        Stage("layout", layout.LAYOUT_VERSION, layout.run_layout, "Systems, galaxies, 3-d/2-d positions, neighbours."),
        Stage("name", naming.NAME_VERSION, naming.run_name, "LLM names for systems (c-TF-IDF names otherwise).", uses_llm=True),
        Stage("export", 1, export.run_export, "Write galaxy.json and vectors.f16.bin."),
    ]
}
