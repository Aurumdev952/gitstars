# gitstars pipeline

`gs` turns the GitHub stars of `gh auth`'s user into `web/public/data/galaxy.json` and `vectors.f16.bin`.

```sh
uv sync
uv run gs run --no-llm          # v0 map: fetch → homepage → card → embed → layout → export
uv run gs gate -n 30            # pplx-decider gate (paid, ~$0.00002/repo)
uv run gs summarize -n 30       # free OpenRouter pool, most-starred first, judged by the decider
uv run gs summarize --provider local   # vLLM at 127.0.0.1:8000 (infra/vllm)
uv run gs embed && uv run gs layout && uv run gs export
uv run gs show owner/name       # card, gate verdict, summary, judge scores
uv run gs report                # galaxies and systems with sample members
uv run gs status                # progress per stage and quota left
uv run pytest
```

Data lives in `<main checkout>/data/gitstars.db` (override with `GITSTARS_DATA`); exports go to
`<main checkout>/web/public/data` (override with `GITSTARS_EXPORT`). Per-repo stage output is cached under
`(full_name, head_oid, stage_version)`, plus a digest of the stage's input where an upstream stage can change
without a new commit, so every stage can be rerun or resumed.

Secrets: the OpenRouter key comes from `keysvc get or-key` at run time and is never logged or stored; the GitHub
token comes from `gh auth token`.

Stages are listed in `src/gitstars/stages.py`. Export validates against `contract/galaxy.schema.json`.
