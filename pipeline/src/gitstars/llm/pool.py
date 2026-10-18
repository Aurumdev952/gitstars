"""Model pool: ranked slots, each with its own rate window and bench state, dispatched highest-rank-first."""

from __future__ import annotations

import asyncio
import math
import re
import time
from collections import deque
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any, Protocol

BENCH_AFTER_FAILURES = 3
BENCH_SECONDS = 600.0
WINDOW_SECONDS = 60.0
MIN_PARAMS_B = 8.0
MIN_UPTIME = 80.0
POOL_SIZE = 15
POLL_SECONDS = 0.5


class Clock(Protocol):
    def now(self) -> float: ...
    async def sleep(self, seconds: float) -> None: ...


class RealClock:
    def now(self) -> float:
        return time.monotonic()

    async def sleep(self, seconds: float) -> None:
        await asyncio.sleep(seconds)


@dataclass
class ModelSlot:
    id: str
    params_b: float | None = None
    created: int = 0
    structured: bool = False
    reasoning: dict[str, Any] | None = None
    rpm: int | None = 18
    max_in_flight: int | None = None
    in_flight: int = 0
    starts: deque[float] = field(default_factory=deque)
    consecutive_failures: int = 0
    benched_until: float = 0.0
    cooldown_until: float = 0.0
    ok: int = 0
    failed: int = 0

    def _trim(self, now: float) -> None:
        while self.starts and now - self.starts[0] >= WINDOW_SECONDS:
            self.starts.popleft()

    def available(self, now: float) -> bool:
        self._trim(now)
        if now < self.benched_until or now < self.cooldown_until:
            return False
        if self.max_in_flight is not None and self.in_flight >= self.max_in_flight:
            return False
        # One request at a time until the model has answered once, so a model that refuses us costs one
        # request instead of a burst of fifteen.
        if self.ok == 0 and self.in_flight >= 1:
            return False
        return self.rpm is None or len(self.starts) < self.rpm

    def free_at(self, now: float) -> float:
        """Earliest time this slot could accept a request, ignoring in-flight limits."""
        self._trim(now)
        t = max(now, self.benched_until, self.cooldown_until)
        if self.rpm is not None and len(self.starts) >= self.rpm:
            t = max(t, self.starts[0] + WINDOW_SECONDS)
        return t

    def start(self, now: float) -> None:
        self.starts.append(now)
        self.in_flight += 1

    def finish(self, now: float, success: bool, retry_after: float | None = None, disable: bool = False) -> None:
        self.in_flight -= 1
        if disable:
            self.failed += 1
            self.benched_until = math.inf
            return
        if success:
            self.ok += 1
            self.consecutive_failures = 0
            return
        self.failed += 1
        self.consecutive_failures += 1
        if retry_after:
            self.cooldown_until = max(self.cooldown_until, now + retry_after)
        if self.consecutive_failures >= BENCH_AFTER_FAILURES:
            self.benched_until = now + BENCH_SECONDS
            self.consecutive_failures = 0


class PoolExhausted(RuntimeError):
    pass


def pick(slots: list[ModelSlot], now: float, exclude: set[str]) -> ModelSlot | None:
    """Highest-ranked slot with capacity right now, skipping `exclude`."""
    for s in slots:
        if s.id not in exclude and s.available(now):
            return s
    return None


class Pool:
    def __init__(self, slots: list[ModelSlot], concurrency: int, clock: Clock | None = None, name: str = "pool"):
        if not slots:
            raise PoolExhausted("pool has no models")
        self.slots = slots
        self.name = name
        self.clock = clock or RealClock()
        self.sem = asyncio.Semaphore(concurrency)

    async def acquire(self, exclude: set[str] | None = None, max_wait: float = 900.0) -> ModelSlot:
        """Wait for the global semaphore and for the best non-excluded slot with capacity."""
        exclude = exclude or set()
        candidates = [s for s in self.slots if s.id not in exclude]
        if not candidates:
            raise PoolExhausted("every model already tried for this job")
        await self.sem.acquire()
        deadline = self.clock.now() + max_wait
        try:
            while True:
                now = self.clock.now()
                slot = pick(self.slots, now, exclude)
                if slot:
                    slot.start(now)
                    return slot
                if now >= deadline:
                    raise PoolExhausted("no model became available")
                wake = min(s.free_at(now) for s in candidates)
                if math.isinf(wake):
                    raise PoolExhausted("every remaining model is disabled")
                # Capped so a slot freed by a finishing request (not visible in free_at) is noticed promptly.
                await self.clock.sleep(max(0.05, min(wake - now, deadline - now, POLL_SECONDS)))
        except BaseException:
            self.sem.release()
            raise

    def release(self, slot: ModelSlot, success: bool, retry_after: float | None = None, disable: bool = False) -> None:
        slot.finish(self.clock.now(), success, retry_after, disable)
        self.sem.release()


_TOTAL_PATTERNS = [
    re.compile(r"(\d+(?:\.\d+)?)\s*B\s+total", re.I),
    re.compile(r"out of\s+(\d+(?:\.\d+)?)\s*B", re.I),
    re.compile(r"(\d+(?:\.\d+)?)\s*B[- ]total[- ]parameter", re.I),
    re.compile(r"\b(\d+(?:\.\d+)?)b-a\d+(?:\.\d+)?b\b", re.I),
    re.compile(r"(\d+(?:\.\d+)?)\s*B[- ]parameter", re.I),
    re.compile(r"(\d+(?:\.\d+)?)B\s+dense", re.I),
]
_ID_SIZE = re.compile(r"[-_/](\d+(?:\.\d+)?)b(?:[-_:.]|$)", re.I)
_EXCLUDED = re.compile(r"guard|safety|moderat|shield", re.I)


def parse_params_b(model_id: str, description: str) -> float | None:
    """Total parameters in billions, from the id first (`120b-a12b`), then the description (`29B total`)."""
    base = model_id.split(":")[0]
    m = _TOTAL_PATTERNS[3].search(base)
    if m:
        return float(m.group(1))
    for pat in _TOTAL_PATTERNS:
        m = pat.search(description or "")
        if m:
            return float(m.group(1))
    m = _ID_SIZE.search(base)
    return float(m.group(1)) if m else None


def endpoint_healthy(ep: dict[str, Any]) -> bool:
    if (ep.get("status") or 0) < 0:
        return False
    uptime = ep.get("uptime_last_30m")
    if uptime is None:
        uptime = ep.get("uptime_last_1d")
    return uptime is None or uptime >= MIN_UPTIME


def eligible(m: dict[str, Any]) -> bool:
    mid = m["id"]
    arch = m.get("architecture") or {}
    return (
        mid.endswith(":free")
        and not mid.startswith("openrouter/")
        and "text" in (arch.get("output_modalities") or [])
        and "text" in (arch.get("input_modalities") or ["text"])
        and not _EXCLUDED.search(mid + " " + (m.get("name") or ""))
    )


def rank(
    catalog: Iterable[dict[str, Any]],
    healthy: dict[str, bool],
    size: int = POOL_SIZE,
    rpm: int = 18,
    exclude: frozenset[str] = frozenset(),
) -> list[ModelSlot]:
    """Bigger first, then newer; unknown sizes after known ones. Drops ineligible, small, unhealthy and excluded models."""
    slots: list[ModelSlot] = []
    for m in catalog:
        if not eligible(m) or not healthy.get(m["id"], False) or m["id"] in exclude:
            continue
        params = parse_params_b(m["id"], m.get("description") or "")
        if params is not None and params < MIN_PARAMS_B:
            continue
        supported = set(m.get("supported_parameters") or [])
        reasoning = None
        if "reasoning" in supported:
            mandatory = bool((m.get("reasoning") or {}).get("mandatory"))
            reasoning = {"effort": "low", "exclude": True} if mandatory else {"enabled": False}
        slots.append(
            ModelSlot(
                id=m["id"],
                params_b=params,
                created=int(m.get("created") or 0),
                structured="structured_outputs" in supported and "response_format" in supported,
                reasoning=reasoning,
                rpm=rpm,
            )
        )
    slots.sort(key=lambda s: (s.params_b is None, -(s.params_b or 0), -s.created))
    return slots[:size]
