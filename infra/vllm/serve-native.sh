#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
venv="$here/.venv"

export CUDA_HOME=/usr/local/cuda-13.1
export PATH="$CUDA_HOME/bin:$PATH"
# Uncapped, ninja runs one nvcc per core (16 here) during FlashInfer JIT and hung the box.
export MAX_JOBS=2
export NVCC_THREADS=1
export VLLM_USE_V2_MODEL_RUNNER=1

for tool in uv ninja nvcc; do
  command -v "$tool" >/dev/null || { echo "missing $tool (see README prerequisites)" >&2; exit 1; }
done

if [ ! -x "$venv/bin/vllm" ]; then
  uv venv --python 3.12 "$venv"
  uv pip install --python "$venv/bin/python" "vllm==0.31.0" --torch-backend=cu130
fi

exec "$venv/bin/vllm" serve RedHatAI/gemma-4-26B-A4B-it-NVFP4 \
  --served-model-name gemma-4-26b \
  --max-model-len 32768 --gpu-memory-utilization 0.95 --kv-cache-dtype fp8 \
  --max-num-seqs 64 --max-num-batched-tokens 2048 \
  --enable-prefix-caching --enable-chunked-prefill --async-scheduling \
  --language-model-only --reasoning-parser gemma4 \
  --default-chat-template-kwargs '{"enable_thinking": false}' \
  --structured-outputs-config.backend xgrammar \
  --host 127.0.0.1 --port 8000 \
  "$@"
