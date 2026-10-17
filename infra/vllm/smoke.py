#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx"]
# ///
"""Smoke test and concurrency sweep for the local gemma-4-26b vLLM server.

Timing is done in Python from usage.completion_tokens. Shell tools mis-parse
decimals under this laptop's comma locale (measured on this laptop).
"""

import argparse
import asyncio
import json
import statistics
import sys
import time

import httpx

MODEL = "gemma-4-26b"

SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "kind": {"type": "string", "enum": ["library", "app", "tool", "dataset"]},
        "tags": {"type": "array", "items": {"type": "string"}, "maxItems": 5},
    },
    "required": ["name", "kind", "tags"],
    "additionalProperties": False,
}

# Distinct filler per request so prefix caching cannot hide prefill cost.
WORDS = (
    "repository cluster embedding vector galaxy telescope survey index latency "
    "throughput kernel scheduler memory token stream render graph signal"
).split()


def make_prompt(seed: int, target_tokens: int = 1500) -> str:
    n = int(target_tokens / 1.3)
    body = " ".join(WORDS[(seed * 7 + i * 3) % len(WORDS)] + str((seed + i) % 97) for i in range(n))
    return f"Document {seed}:\n{body}\n\nSummarize the document above in about 250 words."


async def wait_health(client: httpx.AsyncClient, base: str, timeout_s: float) -> None:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        try:
            if (await client.get(f"{base}/health")).status_code == 200:
                return
        except httpx.TransportError:
            pass
        await asyncio.sleep(3)
    sys.exit(f"server not healthy after {timeout_s:.0f}s")


async def structured_check(client: httpx.AsyncClient, base: str) -> None:
    resp = await client.post(
        f"{base}/v1/chat/completions",
        json={
            "model": MODEL,
            "messages": [{"role": "user", "content": "Describe the repo torvalds/linux as JSON."}],
            "max_tokens": 200,
            "temperature": 0.3,
            "top_p": 0.95,
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": "repo", "schema": SCHEMA, "strict": True},
            },
            "chat_template_kwargs": {"enable_thinking": False},
        },
    )
    resp.raise_for_status()
    content = resp.json()["choices"][0]["message"]["content"]
    obj = json.loads(content)
    missing = [k for k in SCHEMA["required"] if k not in obj]
    if missing or obj["kind"] not in SCHEMA["properties"]["kind"]["enum"]:
        sys.exit(f"structured output violates schema: {content!r}")
    print(f"structured output ok: {content}")


async def one_stream(client: httpx.AsyncClient, base: str, seed: int, max_tokens: int):
    t0 = time.perf_counter()
    first = None
    completion_tokens = 0
    async with client.stream(
        "POST",
        f"{base}/v1/chat/completions",
        json={
            "model": MODEL,
            "messages": [{"role": "user", "content": make_prompt(seed)}],
            "max_tokens": max_tokens,
            "min_tokens": max_tokens,
            "temperature": 0.3,
            "top_p": 0.95,
            "stream": True,
            "stream_options": {"include_usage": True},
            "chat_template_kwargs": {"enable_thinking": False},
        },
    ) as r:
        r.raise_for_status()
        async for line in r.aiter_lines():
            if not line.startswith("data: ") or line.endswith("[DONE]"):
                continue
            chunk = json.loads(line[6:])
            if chunk.get("usage"):
                completion_tokens = chunk["usage"]["completion_tokens"]
            choices = chunk.get("choices") or []
            if first is None and choices and (choices[0]["delta"].get("content") or choices[0]["delta"].get("reasoning")):
                first = time.perf_counter()
    end = time.perf_counter()
    first = first or end
    return {
        "ttft": first - t0,
        "decode_s": max(end - first, 1e-9),
        "tokens": completion_tokens,
        "total_s": end - t0,
    }


async def sweep(base: str, levels: list[int], max_tokens: int) -> None:
    limits = httpx.Limits(max_connections=max(levels) + 8)
    async with httpx.AsyncClient(timeout=httpx.Timeout(600), limits=limits) as client:
        await one_stream(client, base, 0, 16)  # warm CUDA graphs and tokenizer
        print(f"{'conc':>5} {'per-seq tok/s':>14} {'agg tok/s':>10} {'TTFT p50 s':>11} {'TTFT max s':>11} {'tokens':>7}")
        for c in levels:
            t0 = time.perf_counter()
            runs = await asyncio.gather(*(one_stream(client, base, 1000 * c + i, max_tokens) for i in range(c)))
            wall = time.perf_counter() - t0
            total = sum(r["tokens"] for r in runs)
            per_seq = statistics.mean(r["tokens"] / r["decode_s"] for r in runs)
            ttfts = sorted(r["ttft"] for r in runs)
            print(
                f"{c:>5} {per_seq:>14.1f} {total / wall:>10.0f} "
                f"{statistics.median(ttfts):>11.2f} {ttfts[-1]:>11.2f} {total:>7}"
            )
            short = [r["tokens"] for r in runs if r["tokens"] != max_tokens]
            if short:
                print(f"      warning: {len(short)} streams returned != {max_tokens} tokens: {short[:5]}")


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default="http://127.0.0.1:8000")
    ap.add_argument("--levels", default="16,32,64")
    ap.add_argument("--max-tokens", type=int, default=300)
    ap.add_argument("--health-timeout", type=float, default=600)
    args = ap.parse_args()

    async with httpx.AsyncClient(timeout=60) as client:
        await wait_health(client, args.base_url, args.health_timeout)
        print("health ok")
        await structured_check(client, args.base_url)
    await sweep(args.base_url, [int(x) for x in args.levels.split(",")], args.max_tokens)


if __name__ == "__main__":
    asyncio.run(main())
