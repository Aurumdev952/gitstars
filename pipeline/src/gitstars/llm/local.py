"""Local vLLM provider: the same pool and transport, one slot, no per-minute limit."""

from __future__ import annotations

from gitstars.config import LOCAL_BASE_URL, LOCAL_MODEL
from gitstars.llm.openrouter import ChatTransport
from gitstars.llm.pool import ModelSlot, Pool

CONCURRENCY = 64


def build_pool(base_url: str = LOCAL_BASE_URL, model: str = LOCAL_MODEL) -> tuple[Pool, ChatTransport]:
    slot = ModelSlot(id=model, structured=True, rpm=None, max_in_flight=CONCURRENCY)
    transport = ChatTransport(
        base_url=base_url,
        headers={"Authorization": "Bearer local"},
        temperature=0.3,
        top_p=0.95,
        extra_body={"chat_template_kwargs": {"enable_thinking": False}},
        timeout=300.0,
    )
    return Pool([slot], concurrency=CONCURRENCY, name="local"), transport
