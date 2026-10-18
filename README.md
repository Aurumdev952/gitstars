# gitstars

A 3D map of my GitHub stars. An offline pipeline summarizes every starred repo, embeds the summaries
with EmbeddingGemma 2, clusters them, and lays them out in 3D. A TanStack Start app renders that space
as an explorable galaxy with semantic search.

- `pipeline/` builds the data. Python, uv, CLI `gs`.
- `web/` is the app. TanStack Start, React Three Fiber, bun.
- `infra/vllm/` serves Gemma 4 26B A4B NVFP4 locally for summarization.
- `contract/galaxy.schema.json` is the export format both sides agree on.

Data lives in `data/` and `web/public/data/`, both gitignored.

## Run it

```bash
cd web && bun install && bun run dev    # http://localhost:3000
```

The app reads `web/public/data/galaxy.json` and `vectors.f16.bin`. Search runs the EmbeddingGemma 2
text tower in the browser; `bun run models:fetch` vendors it into `web/public/models/` so it works
offline. Static hosting needs the same `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: credentialless` headers the dev server sets.

To refresh after starring more repos, run the pipeline (`pipeline/README.md`):

```bash
cd pipeline
uv run gs fetch && uv run gs homepage && uv run gs card && uv run gs gate
uv run gs summarize                     # free OpenRouter pool until the daily quota guard stops it
docker compose -f ../infra/vllm/compose.yaml up -d
uv run gs summarize --provider local    # the rest on local Gemma 4
uv run gs name --provider local
docker compose -f ../infra/vllm/compose.yaml down    # free the GPU before embedding
uv run gs embed && uv run gs layout && uv run gs export
```

Every stage is cached by what it reads, so a rerun only touches new or changed repos.
