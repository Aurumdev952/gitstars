"""Stage 5: summarize each card on the model pool, judge it with the decider, keep the best attempt."""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass, field, replace
from typing import Literal

from pydantic import ValidationError
from rich.progress import Progress

from gitstars import decider as dec
from gitstars.cards import load_card, load_gate
from gitstars.config import openrouter_key
from gitstars.context import Ctx
from gitstars.db import DB
from gitstars.domain import CacheKey, JudgeVerdict, Repo, sha
from gitstars.extract import assemble
from gitstars.llm import local, openrouter
from gitstars.llm.openrouter import ChatTransport, FatalProviderError, RequestBudget, TransportError, read_quota
from gitstars.llm.pool import ModelSlot, Pool, PoolExhausted
from gitstars.llm.prompts import PROMPT_VERSION, SYSTEM, repair_prompt, user_prompt
from gitstars.llm.schema import SUMMARY_SCHEMA, Summary, parse_summary
from gitstars.tokens import count_tokens

SUMMARY_VERSION = 1
MAX_JUDGE_RETRIES = 2
# Free upstreams 429 often (22 of 66 requests in the first 30-repo run); a 429 is cheap, so hop further.
MAX_MODEL_HOPS = 6
BATCH_SIZE = 30

Provider = Literal["openrouter", "local"]


@dataclass
class Attempt:
    model: str
    summary: Summary
    verdict: JudgeVerdict | None

    def record(self) -> dict:
        return {"model": self.model, "verdict": self.verdict.model_dump() if self.verdict else None, "passed": self.passed}

    @property
    def passed(self) -> bool:
        return bool(self.verdict and self.verdict.passed)


@dataclass
class RunState:
    provider: Provider
    pool: Pool
    transport: ChatTransport
    decider: dec.Decider
    budget: RequestBudget = field(default_factory=RequestBudget)
    requests: int = 0
    judged: int = 0
    passed: int = 0
    failed_repos: int = 0
    judge_cost: float = 0.0
    models: dict[str, int] = field(default_factory=dict)
    stop: str | None = None


async def _generate(
    state: RunState, ctx: Ctx, repo: Repo, card_text: str, feedback: str | None, tried: set[str]
) -> tuple[Summary, str] | None:
    """One summary from the best available model; transport errors and unparseable output move to the next model."""
    messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user_prompt(card_text, feedback)}]
    for _ in range(MAX_MODEL_HOPS):
        if state.stop is not None:
            return None
        if not state.budget.take():
            state.stop = f"free request budget spent ({state.requests} sent this run)"
            return None
        try:
            slot = await state.pool.acquire(exclude=tried)
        except PoolExhausted:
            state.budget.refund()
            return None
        tried.add(slot.id)
        t0 = time.monotonic()
        try:
            summary = await _complete_and_parse(state, slot, messages)
        except TransportError as exc:
            state.pool.release(slot, False, exc.retry_after, disable=exc.permanent)
            if exc.permanent:
                ctx.db.disable_model(slot.id, str(exc))
            ctx.db.log_llm_call(repo.full_name, state.provider, slot.id, f"error: {exc}"[:200], time.monotonic() - t0)
            continue
        except FatalProviderError as exc:
            state.pool.release(slot, False)
            state.stop = f"provider refused requests: {exc}"
            return None
        except BaseException:
            state.pool.release(slot, False)
            raise
        state.pool.release(slot, True)
        ctx.db.log_llm_call(repo.full_name, state.provider, slot.id, "ok", time.monotonic() - t0)
        return summary, slot.id
    return None


async def _complete_and_parse(state: RunState, slot: ModelSlot, messages: list[dict[str, str]]) -> Summary:
    state.requests += 1
    raw = await state.transport.complete(slot, messages, SUMMARY_SCHEMA)
    try:
        return parse_summary(raw)
    except json.JSONDecodeError as exc:
        raise TransportError(f"invalid JSON: {exc}") from exc
    except ValidationError as exc:
        # Parsed JSON that breaks a field rule gets one repair turn on the same model, when the slot's rate window
        # and the run's request budget both allow one more request.
        now = state.pool.clock.now()
        if slot.free_at(now) > now or not state.budget.take():
            raise TransportError(f"invalid, no room to repair: {str(exc)[:120]}") from exc
        slot.starts.append(now)
        state.requests += 1
        repaired = await state.transport.complete(
            slot,
            [*messages, {"role": "assistant", "content": raw}, {"role": "user", "content": repair_prompt(str(exc))}],
            SUMMARY_SCHEMA,
        )
        try:
            return parse_summary(repaired)
        except (json.JSONDecodeError, ValidationError) as exc2:
            raise TransportError(f"invalid after repair: {str(exc2)[:120]}") from exc2


async def _judge(state: RunState, ctx: Ctx, repo: Repo, card_text: str, summary: Summary) -> JudgeVerdict | None:
    """The decider's verdict, retried once on a transport or parse failure; None if both fail."""
    req = dec.judge_request(card_text, summary)
    for attempt in range(2):
        try:
            resp, raw = await state.decider.decide(req)
            verdict = dec.parse_judge(resp)
        except (dec.DecisionError, ValueError) as exc:
            ctx.db.log_decision(repo.full_name, "judge", req.model_dump(mode="json"), None, str(exc)[:500])
            if attempt == 0:
                await asyncio.sleep(2.0)
            continue
        ctx.db.log_decision(repo.full_name, "judge", req.model_dump(mode="json"), raw, None)
        if resp.usage and resp.usage.cost:
            state.judge_cost += resp.usage.cost
        return verdict
    return None


def _better(a: Attempt | None, b: Attempt) -> Attempt:
    if a is None:
        return b
    ka = a.verdict.rank_key() if a.verdict else (False, -1.0)
    kb = b.verdict.rank_key() if b.verdict else (False, -1.0)
    return b if kb > ka else a


@dataclass(frozen=True)
class Job:
    """One repo to summarize. Its cache digest covers the exact text the model sees plus the prompt and judge
    versions, so a new gate verdict or budget change re-summarizes it and a push that leaves the card alone doesn't."""

    repo: Repo
    card_text: str
    gated: bool
    # A stored summary whose judge call failed: judge it again before generating anything new.
    unjudged: dict | None = None

    @property
    def input_sha(self) -> str:
        return sha(self.card_text)

    @property
    def key(self) -> CacheKey:
        return CacheKey(
            full_name=self.repo.full_name,
            stage_version=SUMMARY_VERSION,
            digest=sha([self.input_sha, PROMPT_VERSION, dec.JUDGE_PROMPT_VERSION]),
        )


def job_for(db: DB, repo: Repo) -> Job | None:
    loaded = load_card(db, repo)
    if loaded is None:
        return None
    card, art = loaded
    gate = load_gate(db, repo, art["input_sha"])
    return Job(repo, assemble(card, gate, count_tokens), gate is not None)


def load_summary(db: DB, repo: Repo) -> dict | None:
    """The summary artifact made from the repo's current card text, or None."""
    job = job_for(db, repo)
    return db.get_artifact("summary", job.key) if job else None


def pending_jobs(ctx: Ctx) -> list[Job]:
    jobs: list[Job] = []
    for repo in ctx.selected("stars"):
        if ctx.limit is not None and len(jobs) >= ctx.limit:
            break
        job = job_for(ctx.db, repo)
        if job is None:
            continue
        cached = ctx.cached("summary", job.key)
        if cached is None:
            jobs.append(job)
        elif cached.get("verdict") is None:
            jobs.append(replace(job, unjudged=cached))
    return jobs


async def summarize_repo(state: RunState, ctx: Ctx, job: Job) -> None:
    repo, card_text = job.repo, job.card_text
    tried: set[str] = set()
    best: Attempt | None = None
    attempts: list[dict] = []
    feedback: str | None = None
    if job.unjudged:
        prev = job.unjudged
        summary = Summary.model_validate(prev["summary"])
        best = Attempt(prev["model"], summary, await _judge(state, ctx, repo, card_text, summary))
        attempts = [a for a in prev.get("attempts", []) if a.get("verdict")] + [best.record()]
        tried = {a["model"] for a in prev.get("attempts", [])}
        if best.verdict is not None and not best.passed:
            feedback = dec.judge_feedback(best.verdict)
    rounds = 0 if best is not None and (best.verdict is None or best.passed) else 1 + MAX_JUDGE_RETRIES - len(attempts)
    for _ in range(max(0, rounds)):
        generated = await _generate(state, ctx, repo, card_text, feedback, tried)
        if generated is None:
            break
        summary, model = generated
        attempt = Attempt(model, summary, await _judge(state, ctx, repo, card_text, summary))
        attempts.append(attempt.record())
        best = _better(best, attempt)
        if attempt.verdict is None or attempt.passed:
            break
        feedback = dec.judge_feedback(attempt.verdict)
    if best is None:
        if state.stop is None:
            state.failed_repos += 1
        return
    state.models[best.model] = state.models.get(best.model, 0) + 1
    if best.verdict:
        state.judged += 1
        state.passed += best.passed
    ctx.db.put_artifact(
        "summary",
        job.key,
        {
            "summary": best.summary.model_dump(mode="json"),
            "model": best.model,
            "provider": state.provider,
            "verdict": best.verdict.model_dump() if best.verdict else None,
            "passed": best.passed,
            "quality": best.verdict.quality if best.verdict else None,
            "attempts": attempts,
            "gated": job.gated,
            "card_tokens": count_tokens(card_text),
            "input_sha": job.input_sha,
        },
    )


async def run_summarize(ctx: Ctx, provider: Provider = "openrouter", reserve: int = openrouter.FREE_RESERVE) -> dict:
    key = openrouter_key()
    if provider == "local":
        pool, transport = local.build_pool()
    else:
        pool, transport = await openrouter.build_pool(key, exclude=ctx.db.disabled_models())
    quota_start = await read_quota(key)
    # Free requests are metered per request, so in-flight jobs, model hops and repair turns can't overshoot the
    # reserve. /key's counter lags our own requests, so the run-start headroom is spent down locally too.
    budget = RequestBudget(quota_start.headroom(reserve) if provider == "openrouter" else None)
    state = RunState(provider, pool, transport, dec.Decider(key), budget=budget)
    jobs = pending_jobs(ctx)

    t0 = time.monotonic()
    done = 0
    try:
        with Progress(console=ctx.console, transient=True) as prog:
            task = prog.add_task(f"summarize ({provider})", total=len(jobs))
            while done < len(jobs) and state.stop is None:
                quota = await read_quota(key)
                if quota.balance_usd <= openrouter.MIN_BALANCE_USD:
                    state.stop = f"credit balance ${quota.balance_usd:.2f} ≤ ${openrouter.MIN_BALANCE_USD:.2f}"
                    break
                if provider == "openrouter":
                    budget.cap(quota.headroom(reserve))
                    if budget.spent:
                        state.stop = f"free headroom exhausted (remaining {quota.free_remaining}, sent {state.requests}, reserve {reserve})"
                        break
                batch = jobs[done : done + (BATCH_SIZE if provider == "openrouter" else local.CONCURRENCY * 2)]

                async def one(job: Job) -> None:
                    await summarize_repo(state, ctx, job)
                    prog.advance(task)

                await asyncio.gather(*(one(j) for j in batch))
                done += len(batch)
        quota_end = await read_quota(key)
    finally:
        await transport.aclose()
        await state.decider.aclose()

    return {
        "provider": provider,
        "pool": [s.id for s in pool.slots],
        "attempted": done,
        "summarized": sum(state.models.values()),
        "judged": state.judged,
        "passed": state.passed,
        "failed": state.failed_repos,
        "requests": state.requests,
        "free_requests_used": quota_end.free_used - quota_start.free_used,
        "free_remaining": quota_end.free_remaining,
        "balance_usd": quota_end.balance_usd,
        "judge_cost_usd": round(state.judge_cost, 6),
        "by_model": dict(sorted(state.models.items(), key=lambda kv: -kv[1])),
        "slot_stats": {s.id: {"ok": s.ok, "failed": s.failed} for s in pool.slots if s.ok or s.failed},
        "stopped": state.stop,
        "seconds": round(time.monotonic() - t0, 1),
    }
