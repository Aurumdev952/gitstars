"""OpenRouter boundary: catalog, endpoint health, chat transport, and the free-quota guard."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

import httpx

from gitstars.config import OPENROUTER_API
from gitstars.llm.pool import ModelSlot, Pool, eligible, endpoint_healthy, rank
from gitstars.llm.schema import OutputSchema

MAX_IN_FLIGHT = 15
PER_MODEL_RPM = 18
FREE_RESERVE = 100
MIN_BALANCE_USD = 0.20


class TransportError(RuntimeError):
    """A request failed in a way that should move the job to the next model."""

    def __init__(self, message: str, retry_after: float | None = None, permanent: bool = False):
        super().__init__(message)
        self.retry_after = retry_after
        self.permanent = permanent


class FatalProviderError(RuntimeError):
    """The provider refuses every request (auth, payment); stop the run."""


@dataclass
class ChatTransport:
    base_url: str
    headers: dict[str, str]
    temperature: float = 0.3
    top_p: float = 0.95
    max_tokens: int = 1500
    extra_body: dict[str, Any] | None = None
    timeout: float = 120.0

    def __post_init__(self) -> None:
        self.client = httpx.AsyncClient(timeout=httpx.Timeout(self.timeout, connect=15.0))

    async def aclose(self) -> None:
        await self.client.aclose()

    def body(self, slot: ModelSlot, messages: list[dict[str, str]], schema: OutputSchema) -> dict[str, Any]:
        body: dict[str, Any] = {
            "model": slot.id,
            "messages": messages,
            "temperature": self.temperature,
            "top_p": self.top_p,
            "max_tokens": self.max_tokens * (3 if slot.reasoning and "effort" in slot.reasoning else 1),
        }
        if slot.structured:
            body["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": schema.name, "strict": True, "schema": schema.schema},
            }
        if slot.reasoning:
            body["reasoning"] = slot.reasoning
        if self.extra_body:
            body.update(self.extra_body)
        return body

    async def complete(self, slot: ModelSlot, messages: list[dict[str, str]], schema: OutputSchema) -> str:
        try:
            resp = await self.client.post(f"{self.base_url}/chat/completions", headers=self.headers, json=self.body(slot, messages, schema))
        except httpx.HTTPError as exc:
            raise TransportError(f"{type(exc).__name__}") from exc
        if resp.status_code in (401, 402):
            raise FatalProviderError(f"http {resp.status_code}: {resp.text[:200]}")
        if resp.status_code == 403:
            # A moderation flag is about this input; anything else (e.g. "only available on agentic harnesses")
            # means the model will never serve us.
            moderated = any(w in resp.text.lower() for w in ("moderation", "flagged"))
            raise TransportError(f"http 403: {resp.text[:160]}", permanent=not moderated)
        if resp.status_code == 429:
            raise TransportError("http 429", retry_after=_retry_after(resp))
        if resp.status_code >= 400:
            raise TransportError(f"http {resp.status_code}: {resp.text[:200]}")
        try:
            data = resp.json()
        except ValueError as exc:
            raise TransportError("non-JSON response body") from exc
        if data.get("error"):
            err = data["error"]
            code = err.get("code") if isinstance(err, dict) else None
            raise TransportError(f"provider error {code}: {str(err)[:200]}", retry_after=60.0 if code == 429 else None)
        choices = data.get("choices") or []
        content = (choices[0].get("message") or {}).get("content") if choices else None
        if not content:
            raise TransportError("empty completion")
        return content


def _retry_after(resp: httpx.Response) -> float:
    raw = resp.headers.get("retry-after")
    try:
        return max(1.0, float(raw)) if raw else 30.0
    except ValueError:
        return 30.0


def openrouter_headers(key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {key}", "X-Title": "gitstars", "HTTP-Referer": "http://localhost/gitstars"}


async def fetch_catalog(client: httpx.AsyncClient) -> list[dict[str, Any]]:
    resp = await client.get(f"{OPENROUTER_API}/models")
    resp.raise_for_status()
    return resp.json()["data"]


async def fetch_health(client: httpx.AsyncClient, model_ids: list[str]) -> dict[str, bool]:
    async def one(mid: str) -> tuple[str, bool]:
        try:
            resp = await client.get(f"{OPENROUTER_API}/models/{mid}/endpoints")
            resp.raise_for_status()
            eps = resp.json()["data"]["endpoints"]
        except (httpx.HTTPError, KeyError, ValueError):
            return mid, False
        return mid, any(endpoint_healthy(e) for e in eps)

    return dict(await asyncio.gather(*(one(m) for m in model_ids)))


async def build_pool(key: str, exclude: frozenset[str] = frozenset()) -> tuple[Pool, ChatTransport]:
    """`exclude`: models that refused us for good on an earlier run (see `DB.disabled_models`)."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        catalog = await fetch_catalog(client)
        health = await fetch_health(client, [m["id"] for m in catalog if eligible(m) and m["id"] not in exclude])
    slots = rank(catalog, health, rpm=PER_MODEL_RPM, exclude=exclude)
    return Pool(slots, concurrency=MAX_IN_FLIGHT, name="openrouter"), ChatTransport(OPENROUTER_API, openrouter_headers(key))


@dataclass(frozen=True)
class Quota:
    free_used: int
    free_limit: int
    free_remaining: int
    balance_usd: float

    def headroom(self, reserve: int = FREE_RESERVE) -> int:
        """Free requests this run may still spend; 0 when the credit balance is too low to trust free models."""
        if self.balance_usd <= MIN_BALANCE_USD:
            return 0
        return max(0, self.free_remaining - reserve)


async def read_quota(key: str) -> Quota:
    async with httpx.AsyncClient(timeout=20.0, headers={"Authorization": f"Bearer {key}"}) as client:
        k, c = await asyncio.gather(client.get(f"{OPENROUTER_API}/key"), client.get(f"{OPENROUTER_API}/credits"))
    k.raise_for_status()
    c.raise_for_status()
    free = k.json()["data"]["free_model_daily_requests"]
    credits = c.json()["data"]
    return Quota(
        free_used=int(free["used"]),
        free_limit=int(free["limit"]),
        free_remaining=int(free["remaining"]),
        balance_usd=round(float(credits["total_credits"]) - float(credits["total_usage"]), 6),
    )
