from __future__ import annotations

from functools import cache

from tokenizers import Tokenizer

from gitstars.config import EMBED_MODEL


@cache
def _tokenizer() -> Tokenizer:
    # The Gemma tokenizer stands in for every summarizer model; card budgets only need to be roughly right.
    return Tokenizer.from_pretrained(EMBED_MODEL)


def count_tokens(text: str) -> int:
    return len(_tokenizer().encode(text, add_special_tokens=False).ids)
