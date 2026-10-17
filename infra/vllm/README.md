# Local Gemma 4 on vLLM

Serves `RedHatAI/gemma-4-26B-A4B-it-NVFP4` as `gemma-4-26b` on `http://127.0.0.1:8000/v1` for the
summarize and cluster-naming passes. Target box is the RTX 5090 Laptop (SM120, 24 GB). Config D from
earlier vLLM notes for this laptop, retuned for 32k context on vLLM 0.31.0.

## Start and stop

Docker (default). Prebuilt kernels avoid the FlashInfer JIT, which hung this box when it ran natively.

```bash
docker compose -f infra/vllm/compose.yaml up -d
docker compose -f infra/vllm/compose.yaml logs -f gemma4
docker compose -f infra/vllm/compose.yaml down
```

First start takes about 2.5 minutes to reach healthy. Stop any other GPU process first, since this
config takes 95% of VRAM.

Native, in a `uv` venv at `infra/vllm/.venv` (gitignored):

```bash
infra/vllm/serve-native.sh          # extra args are appended to vllm serve
```

Prerequisites from doc 18: `sudo apt-get install -y python3.12-dev ninja-build`, and CUDA 13.1 at
`/usr/local/cuda-13.1` (the script exports `CUDA_HOME` and `PATH`). Do not install the distro
`nvidia-cuda-toolkit`; it is CUDA 12.0 and mismatches the cu130 torch build. The first native start
JIT-compiles for about 10 minutes. `MAX_JOBS=2 NVCC_THREADS=1` is what keeps it from exhausting the
machine.

Verify:

```bash
uv run infra/vllm/smoke.py
```

It waits for `/health`, checks one `json_schema` structured response, then sweeps c=16/32/64 with
~1.5k-token prompts and 300 output tokens. Per-seq tok/s, aggregate tok/s and TTFT are timed in
Python from `usage.completion_tokens` because this box's comma locale breaks `curl -w` and `awk`
timing. For reference, doc 18 measured about 2.9k aggregate tok/s at c=16 and 4.2k at c=64 on config D
with 400 output tokens. Expect similar, not identical, numbers.

## Log lines to confirm before trusting the config

A config that passes `/health` is not necessarily a working config, so check the startup log.

| Line | Expect | If not |
|---|---|---|
| attention backend | `TRITON_ATTN` selected | Gemma 4's heterogeneous head sizes can pick a backend that is slow or wrong on SM120. Do not tune further until this holds. |
| NVFP4 MoE backend | A non-Marlin backend (a FlashInfer or CUTLASS FP4 path) | Marlin works but dequantizes weights. Treat it as a fallback, not the target. |
| `Maximum concurrency for 32,768 tokens per request` | 8x or more | KV pool is too small. Lower `--max-num-batched-tokens` before lowering utilization. |
| `GPU KV cache size` | tens of thousands of tokens | Do not tune by this number alone. At high utilization the planner can eat activation headroom and OOM on the first real request. |

## Fallbacks

- Garbage or repeated-token output: add `--moe-backend marlin`. Compose: append it to `command`.
  Native: `infra/vllm/serve-native.sh --moe-backend marlin`.
- OOM during CUDA-graph capture or under load: lower `--max-num-batched-tokens` to 2048 first
  (doc 18 config C), then `--gpu-memory-utilization` to 0.92.
- Garbage from `/v1/completions`: expected. Use `/v1/chat/completions`; the raw endpoint skips the
  chat template.

## Why each flag

- `--max-model-len 32768`. An admission cap, not a reservation. vLLM refuses to start unless it can
  admit one request at the model's full 262k native length, and a cap lowers that bar without
  shrinking the KV pool. Gemma 4's hybrid attention (25 sliding-window layers of 1,024 plus 5 global)
  costs about 0.45 GiB of fp8 KV per full 32k sequence.
- `--gpu-memory-utilization 0.95`, CUDA graphs on. Doc 18 measured this as stable. Lower values
  starve graph capture.
- `--kv-cache-dtype fp8`. `nvfp4` KV corrupts output on SM120. `fp8_per_token_head` loses about 22%
  capacity.
- No `--quantization`. compressed-tensors is auto-detected from the checkpoint.
- `--max-num-seqs 64 --max-num-batched-tokens 4096`. Our requests are 2-3k tokens. Larger batched
  tokens buy prefill speed but take activation memory from the KV pool, and 16384 OOMed in graph
  capture in doc 18.
- `--enable-prefix-caching --enable-chunked-prefill`. Summarize prompts share a long system
  prefix. Chunking keeps decode latency steady beside long prefills.
- `--async-scheduling`. Overlaps scheduling with GPU execution. Pairs with
  `VLLM_USE_V2_MODEL_RUNNER=1`.
- `--language-model-only`. Supported way to disable the vision tower. No `--skip-mm-profiling`
  needed on this model. Drop it if images are ever needed.
- `--reasoning-parser gemma4` plus `--default-chat-template-kwargs '{"enable_thinking": false}'`.
  Thinking is off by default so extraction output is not spent on reasoning tokens. A request can
  turn it on with `chat_template_kwargs`.
- `--structured-outputs-config.backend xgrammar`. Pins the grammar backend for `json_schema`
  responses rather than relying on auto selection.
- Sampling is a client choice. Use `temperature 0.3, top_p 0.95` for extraction.
- Tool calling is not enabled. Add `--enable-auto-tool-choice --tool-call-parser gemma4` if needed.
- Loopback bind (`127.0.0.1:8000`). vLLM has no auth or TLS and this is a laptop. Widen it
  deliberately and firewall it.
