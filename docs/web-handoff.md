# Web handoff notes

Running log of what each web phase left for the next one. Newest phase last.

## After W1 (scaffold and MVP scene)

Built: TanStack Start SPA, zod schema mirrored to `contract/galaxy.schema.json` with an ajv parity test,
300-repo fixture (`?data=fixture`), typed-array index (`lib/load.ts`), palette, `positionAt` mirror,
instanced star shader with all uniforms reserved, backdrop and dust, nebulae (one instanced draw),
Bloom/Vignette/Noise/AgX, CPU picking, tooltip, DOM reticles, glass RepoPanel, legend, macro labels in
`OverlayLayer` (rendered after post so bloom does not wash them out), Director, sceneBus, Animator,
`window.__gitstars` with `?debug&freeze=1`.

Seams:
- Filters, cluster focus, search pulse: extend `Emphasis` and `writeDynTargets` in
  `src/lib/emphasis.ts` (owns aDyn = vis, highlight, focus, pulse). Picking skips vis < 0.5. The
  Animator rebuilds targets when its store subscription fires; add fields to that subscription in
  `Animator.tsx`.
- URL state: add `kind`, `lang`, `tag`, `stars`, `archived`, `q`, `lens`, `t` to `searchSchema` and
  `searchDefaults` in `src/state/url.ts`, mirror them in the `routes/index.tsx` effect, and navigate
  with `{ replace: true }`. Repo and cluster keep push.
- Camera: `director.frameIndices(idx)` frames search hits. New navigation cases go in
  `cameraIntent` (tested).
- ClusterPanel: `focusCluster` is mirrored and framed. Nebula focus uniforms exist on the Nebulae
  material.
- Labels: 3D labels belong in `<OverlayLayer>`; reuse the occupancy approach in
  `labels/MacroLabels.tsx`. DOM HUD elements call `useOccluder(ref)` so 3D labels avoid them. DOM
  anchors register through `onFrame` and project with `starScreenPosition`.
- kNN arcs go in the main scene so they bloom. `repos[i].neighbors` is `[idx, cos]`.
- Flat view: `uFlat` and `aPos2` are wired in `chunks/layout.glsl` and `positionAt`; tween
  `sceneBus.uniforms.uFlat`.
- Search worker: `GalaxyIndex.vectorsUrl`, `meta.embedding`, `meta.searchProbes` are ready. The
  transformers.js WebGPU-in-worker smoke check has not been done yet.
- Store actions `hover`, `select`, `focus` route through the URL. Settings hold `motion`,
  `autorotate`, `labels`.

Known issues left open:
- Overview: macro labels of neighbouring galaxies overlap (e.g. "Developer Tools" and "Graphics &
  Creative" in `fixture-overview.png`). The nudge needs a real collision pass or a leader-line layout.
- Timeline: newest repo has `aStarred = 1`, so at `uTimeline = 1` the newest ~2% are invisible. Run
  the cursor to `1 + birthWindow`.
- `uWarp` is set but no shader reads it.
- `?seed` is parsed but unused.
- Main chunk is over 500 kB; split the scene and the search worker.
- Measured on Intel Arc via ANGLE at 1600x900: 83 fps (300), 70 fps (10k); the post chain alone is
  about 10.6 ms per frame, so quality tiers should cut bloom levels first.

## After W2 (interactions)

Built: search worker, ⌘K palette, concept lens, filters with facet counts and ghosts, cluster focus
and `ClusterPanel`, kNN arcs, one collision pass for all label tiers, flat map, list view, keymap
and shortcuts dialog, Forgotten star, live region, code splitting.

Resolved from W1: macro labels no longer overlap (real collision pass), `?seed` seeds the
Forgotten-star draw, and the entry chunk is split.

Seams:
- URL: `state/url.ts` owns `q`, `lens`, `kind`, `lang`, `tag`, `stars`, `pushed`, `archived` and
  `starred` (`YYYY-MM` pair). `filtersFromSearch` and `searchFromFilters` convert, and the round trip
  is tested. Store actions `setQuery`, `setLens`, `setFilters` and `setView` replace history;
  `select` and `focus` push.
- Filters: add a facet as one row in `PREDICATES` in `lib/filters.ts`, plus its count in
  `applyFilters`. Counts exclude each facet's own constraint. `store.filtered` holds the mask; the
  timeline's starred range should write `filters.starred`.
- Emphasis: `lib/emphasis.ts` writes aDyn from hover, selection, cluster focus, the filter mask,
  ghosts (vis 0.3) and the first 12 hits. `Animator` staggers vis changes by `seed × 180 ms`.
- Scene-wide tweens live in `components/galaxy/SceneTweens.tsx`: `uLens`, nebula
  `uFocusCluster`/`uFocusAmt`, per-galaxy `uGalaxyVis`, and `uFlat` (1.2 s ease). Add timeline and
  intro tweens there.
- Lens: weights come from `lensWeights` (median → 0, p99.5 → 1); `aLens` and the ramp in
  `lib/lens.ts` (`LENS_RAMP`) feed both `star.vert.glsl` and the legend.
- Search: `workers/searchClient.ts` owns the worker session and the query/lens runners; the worker
  API is `init`, `warm`, `lexical`, `semantic`, `similarTo`, `lens`, `probe`. `lib/search.ts`
  `fuseHits` does RRF (k 60) with exact `owner/name` and exact repo-name pins and picks `frame`.
- Camera: `director.preview`, `saveView`/`restoreView`/`forgetView`, `isPreviewing` and
  `frameView(flat)` joined W1's commands. The HUD reaches the Director only through
  `sceneBus.director`, so the HUD chunk never imports three.
- Labels: `components/galaxy/labels/Labels.tsx` runs one `Occupancy` pass per frame: HUD occluders
  and reticles, the selected star's neighbours, galaxy labels, system labels (projected radius on
  130 px, off 105 px, ≤ 25), then the DOM repo pool (`hud/RepoLabelPool.tsx`, 24 in auto, 40 in
  "more", thinned at the overview). Slot placement is `lib/labelLayout.ts` (tested).
- Arcs: `NeighborArcs.tsx` draws 8 solid plus 8 flowing drei `Line`s (16 draw calls). The W3
  ribbon shader should replace both with one instanced draw.
- Keyboard: add a row to `KEYMAP` in `state/keymap.ts`; the shortcuts dialog renders from it.
  Actions live in `state/commands.ts`.
- Debug hooks add `probe()`, `timeQuery(q)` and `store`.

Measured (dev, headless Chrome 155, 1600×900, DPR 1, no WebGPU adapter so WASM):
- Real export (2,284 stars): 91 fps overview at 41 draw calls; 87 fps with hover arcs at 57.
- Pick: median 0.10 ms, p95 0.26 ms over 200 picks.
- Query: lexical 3–17 ms; semantic 80–147 ms uncached on WASM fp16, about 1 ms when cached.
- `probe()`: overlap@10 0.99 against `meta.searchProbes` on the real export (WASM fp16, about
  95 ms per query). The fixture's vectors are synthetic, so its probe reads about 0.04.
- Build: entry chunk 218 kB; `three` 737 kB, `scene-libs` 450 kB and `ui-libs` 273 kB load as
  separate chunks.

Known issues left open:
- WebGPU q8 is untested: the headless Chrome here has no adapter. The WASM fallback runs fp16,
  because ORT-web 1.31-dev has no WASM `GatherBlockQuantized` kernel for the q8 and q4 exports.
- fp16 weights are 543 MB. Chrome's Cache API refuses entries that large in incognito-like
  contexts, so those re-download on every load there. `bun run models:fetch` (not built) would fix
  that for offline use.
- `vite preview` and any static host need the COOP/COEP headers that the dev middleware sets.
- The real v0 export has keyword-triple galaxy names, `kind: other` for almost every repo and no
  summaries; the panels hide empty blocks, but the galaxies overlap heavily in 3D.
- System-label thresholds are 130/105 px rather than the spec's 60 px, which crowded the overview.
- `Labels.tsx` still allocates per frame (a fresh `Occupancy`, slot arrays, sort buffers); fine
  at 2.3k stars, worth pooling before the 10k stress pass.
- `workers/searchClient.ts` session and sequencing logic has no unit tests; it needs a fake
  worker to test.
- The fixture has no repos at exact half-decade star boundaries, so the boundary test in
  `filters.test.ts` uses literal values rather than fixture data.
- Labels "Off" hides system and repo labels only; galaxy names stay for orientation.
- The timeline, intro, hull, ribbon lines and quality tiers remain W3 work; `uWarp` is still unread.
