# gitstars pipeline

`gs` turns the GitHub stars of `gh auth`'s user into `web/public/data/galaxy.json` and `vectors.f16.bin`.

```sh
uv sync
uv run gs run --no-llm          # v0 map: fetch → homepage → card → embed → layout → export
uv run gs gate -n 30            # pplx-decider gate (paid, ~$0.00002/repo)
uv run gs summarize -n 30       # free OpenRouter pool, most-starred first, judged by the decider
uv run gs summarize --provider local   # vLLM at 127.0.0.1:8000 (infra/vllm); judge stays on the decider
uv run gs embed && uv run gs layout
uv run gs reassign              # pplx-decider (paid, ~$0.06 a pass) moves repos the kNN vote left in the wrong system
uv run gs name --provider local        # or the free pool; systems, then galaxies from their systems
uv run gs export
uv run gs show owner/name       # card, gate verdict, summary, judge scores
uv run gs report                # galaxies and systems with sample members
uv run gs coherence             # 8-NN same-system rates, kNN modularity, galaxy separation of the layout
uv run gs misfits --label after # local Gemma judges a fixed 400-repo sample (plus watched repos): misfit rate
uv run gs status                # progress per stage and quota left
uv run pytest
```

Data lives in `<main checkout>/data/gitstars.db` (override with `GITSTARS_DATA`); exports go to
`<main checkout>/web/public/data` (override with `GITSTARS_EXPORT`). Per-repo stage output is cached under
`(stage, full_name)` and reused while its stage version and input digest match: tree and card use the
default-branch commit, gate uses the card digest plus the gate prompt version, and summaries use the digest of
the exact text the model sees plus the summarize and judge prompt versions. A push that leaves the card unchanged
keeps its gate verdict and summary. Bump `PROMPT_VERSION` (`llm/prompts.py`) or `GATE_PROMPT_VERSION` /
`JUDGE_PROMPT_VERSION` (`decider.py`) when prompt text changes meaning. `--limit N` processes at most N repos
that need work.

Secrets: the OpenRouter key comes from `OPENROUTER_API_KEY` (or `keysvc get or-key`) at run time and is never logged or stored; the GitHub
token comes from `gh auth token`.

Stages are listed in `src/gitstars/stages.py`. Export validates against `contract/galaxy.schema.json`.
