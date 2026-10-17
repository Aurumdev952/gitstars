# gitstars

A 3D map of my GitHub stars. An offline pipeline summarizes every starred repo, embeds the summaries
with EmbeddingGemma 2, clusters them, and lays them out in 3D. A TanStack Start app renders that space
as an explorable galaxy with semantic search.

- `pipeline/` builds the data. Python, uv, CLI `gs`.
- `web/` is the app. TanStack Start, React Three Fiber, bun.
- `infra/vllm/` serves Gemma 4 26B A4B NVFP4 locally for summarization.
- `contract/galaxy.schema.json` is the export format both sides agree on.

Data lives in `data/` and `web/public/data/`, both gitignored.
