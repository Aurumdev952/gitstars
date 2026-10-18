import asyncio
import json
from pathlib import Path

import pytest

from gitstars.llm.pool import BENCH_SECONDS, ModelSlot, Pool, PoolExhausted, endpoint_healthy, parse_params_b, pick, rank

FIX = Path(__file__).parent / "fixtures"


class FakeClock:
    def __init__(self) -> None:
        self.t = 1000.0

    def now(self) -> float:
        return self.t

    async def sleep(self, seconds: float) -> None:
        self.t += seconds
        await asyncio.sleep(0)


def catalog():
    return json.loads((FIX / "openrouter_models.json").read_text())["data"]


def test_parse_params_from_id_and_description():
    assert parse_params_b("nvidia/nemotron-3-super-120b-a12b:free", "") == 120
    assert parse_params_b("x/xing4.0-29b-a4b:free", "It has 29B total parameters") == 29
    assert parse_params_b("dots/dots-3:free", "with 16B active parameters out of 280B total.") == 280
    assert parse_params_b("google/gemma-4-31b-it:free", "Gemma 4 31B Instruct is a 30.7B dense model") == 30.7
    assert parse_params_b("liquid/lfm-2.5-2.6b:free", "compact") == 2.6
    assert parse_params_b("acme/mystery:free", "no size here") is None


def test_rank_bigger_then_newer_and_filters():
    cat = catalog()
    healthy = {m["id"]: True for m in cat}
    healthy["poolside/laguna-s-2.1:free"] = False
    slots = rank(cat, healthy)
    ids = [s.id for s in slots]
    assert ids[0] == "thinkingmachines/inkling:free", "975B total is the biggest"
    assert ids[1] == "nvidia/nemotron-3-ultra-550b-a55b:free"
    sizes = [s.params_b for s in slots if s.params_b is not None]
    assert sizes == sorted(sizes, reverse=True)
    super_vl = ids.index("nvidia/nemotron-3.5-super-vl:free")
    assert super_vl < ids.index("nvidia/nemotron-3-super-120b-a12b:free"), "same size: newer first"
    assert "openrouter/free" not in ids and "openrouter/auto" not in ids, "routers dropped"
    assert not any("safety" in i for i in ids), "guard models dropped"
    assert "liquid/lfm-2.5-2.6b:free" not in ids, "under 8B dropped"
    assert "poolside/laguna-s-2.1:free" not in ids, "unhealthy dropped"
    assert all(i.endswith(":free") for i in ids) and len(ids) <= 15
    assert next(s for s in slots if s.id == "nvidia/nemotron-3-super-120b-a12b:free").structured


def test_endpoint_health():
    assert endpoint_healthy({"status": 0, "uptime_last_30m": 99})
    assert not endpoint_healthy({"status": -2, "uptime_last_30m": 99})
    assert not endpoint_healthy({"status": 0, "uptime_last_30m": 50})
    assert endpoint_healthy({"status": 0, "uptime_last_30m": None, "uptime_last_1d": None})


def test_pick_prefers_rank_and_respects_rpm():
    clock = FakeClock()
    a, b = ModelSlot("a", rpm=2, ok=1), ModelSlot("b", rpm=2, ok=1)
    slots = [a, b]
    for _ in range(2):
        s = pick(slots, clock.now(), set())
        assert s is a
        s.start(clock.now())
    assert pick(slots, clock.now(), set()) is b, "a's minute is full, overflow to b"
    assert pick(slots, clock.now(), {"b"}) is None
    clock.t += 60
    assert pick(slots, clock.now(), set()) is a, "window slid"


async def test_dispatch_waits_for_capacity_with_fake_clock():
    clock = FakeClock()
    pool = Pool([ModelSlot("a", rpm=1)], concurrency=5, clock=clock)
    s1 = await pool.acquire()
    pool.release(s1, True)
    t0 = clock.now()
    s2 = await pool.acquire()
    assert s2.id == "a" and clock.now() - t0 >= 60, "second request waits for the rate window"


async def test_bench_after_three_failures_and_exclude():
    clock = FakeClock()
    a, b = ModelSlot("a", rpm=None), ModelSlot("b", rpm=None)
    pool = Pool([a, b], concurrency=15, clock=clock)
    for _ in range(3):
        s = await pool.acquire()
        assert s is a
        pool.release(s, False)
    assert a.benched_until == pytest.approx(clock.now() + BENCH_SECONDS)
    assert (await pool.acquire()) is b, "benched model is skipped"
    with pytest.raises(PoolExhausted):
        await pool.acquire(exclude={"a", "b"})


async def test_retry_after_cools_down_one_model():
    clock = FakeClock()
    a, b = ModelSlot("a", rpm=None), ModelSlot("b", rpm=None)
    pool = Pool([a, b], concurrency=15, clock=clock)
    s = await pool.acquire()
    pool.release(s, False, retry_after=30)
    assert (await pool.acquire()) is b
    clock.t += 31
    assert (await pool.acquire()) is a


async def test_permanent_refusal_disables_model():
    clock = FakeClock()
    a, b = ModelSlot("a", rpm=None), ModelSlot("b", rpm=None)
    pool = Pool([a, b], concurrency=15, clock=clock)
    pool.release(await pool.acquire(), False, disable=True)
    clock.t += 10 * BENCH_SECONDS
    assert (await pool.acquire()) is b, "a 403 model never comes back"
    with pytest.raises(PoolExhausted, match="disabled"):
        await pool.acquire(exclude={"b"})


async def test_unproven_model_gets_one_request_at_a_time():
    clock = FakeClock()
    a, b = ModelSlot("a", rpm=None), ModelSlot("b", rpm=None)
    pool = Pool([a, b], concurrency=15, clock=clock)
    first, second = await pool.acquire(), await pool.acquire()
    assert (first, second) == (a, b), "a is busy with its first request, so the burst overflows"
    pool.release(first, True)
    assert [await pool.acquire() for _ in range(3)] == [a, a, a], "proven, a takes the traffic"


async def test_global_concurrency_and_in_flight_cap():
    clock = FakeClock()
    local = ModelSlot("gemma", rpm=None, max_in_flight=2, ok=1)
    pool = Pool([local], concurrency=64, clock=clock)
    await pool.acquire()
    await pool.acquire()
    with pytest.raises(PoolExhausted):
        await pool.acquire(max_wait=5)
