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

## After W3 (polish, effects, UX)

Built:
- The intro: stars spiral out of the galaxy centre, nebulae gather, labels stagger in and the HUD
  slides up. Any input fast-forwards it; a deep link skips it; reduced motion gets a fade.
- The timeline: a histogram, scrubber, playback, births and a date ticker, plus `t` and `?t=`.
- One ribbon line shader. It draws the kNN arcs and every system constellation (an MST each), and
  the flat hull outline.
- A faceted fresnel hull around the focused cluster.
- Star shader: warp streaks, bokeh depth of field, dead-star styling and birth overshoot.
- Quality tiers (auto, low, med, high) with chromatic aberration on high only.
- `bun run models:fetch` for offline semantic search.
- A UX pass: first-run hint, empty states, error card, contrast test, cursors, tab title and
  narrow-window layout.
- Home framing that fills the viewport, and a label pass that does not allocate per frame.

Resolved from W1 and W2:
- The timeline cursor runs to `1 + birthWindow`, so the newest stars are born.
- `uWarp` is read.
- The 16 drei `Line` arcs are one instanced draw.
- `Labels.tsx` is pooled.
- Labels and nebulae follow the timeline's births.
- Idle autorotate yields to timeline playback.

Seams:
- Intro: `lib/intro.ts` holds the timing table and the pure frame function (`introFrame`,
  `introCamera`, `labelReveal`, `introDelay`); `components/galaxy/Intro.tsx` applies it each frame
  at priority -2, ahead of CameraControls.
  - The store's `intro` phase is `spiral` (HUD held), `settling` (HUD and labels arriving), `fade`
    (reduced motion) or `done`. It is decided once in `routes/index.tsx` from the landing URL
    (`isDeepLink`).
  - HUD chrome opts in with the `hud-enter` utility and `--hud-i` (40 ms stagger); the root's
    `data-intro="held"` hides it.
  - Each star's launch delay is the `aDelay` attribute / `attrs.delay` (galaxy hue rank plus seed).
    The spiral twist grows with distance over `uIntroRadius`. Both live in `layout.glsl` and are
    mirrored in `lib/layout.ts` (tested).
- Timeline: the cursor lives outside React in `state/timeline.ts` (`timelineCursor`, `timeline.*`),
  with `uTimeline = c·(1 + w)`. The shown date is `c·(1 + w) − w/2`. The maths is in `lib/timeline.ts`
  (tested). Per-galaxy born shares go to `uGalaxyBorn` and per-system shares to
  `sceneBus.systemBorn`; SceneTweens recomputes both only when the cursor moves.
- Lines: `components/galaxy/ribbons.ts` (`RibbonBuffer`, `Segment`, `ribbonMaterial`). A segment
  carries both layouts, intro delays and starred times, so it follows the flat tween, the intro and
  the timeline in the shader. Per-material uniforms are `uDrawClock`, `uDrawSeconds`, `uFlow`,
  `uPulseSpeed`, `uPulseGain`, `uRest` and `uHotSystem`. A new kind of line is a new
  `RibbonBuffer`, not a new shader. Set `galaxy: -1` on segments that belong to no galaxy, so they
  skip the galaxy-visibility and focus dimming. Arcs alternate their bow side by rank: the spec's
  single `viewDir × (b − a)` side curled all eight arcs into a whirl.
- Hull: `ClusterHull.tsx` wraps the members within the 92nd-percentile radius (`lib/hull.ts`), with a
  sweep reveal. Facets are flat on purpose; smoothed normals lit the whole volume.
- Quality: `lib/quality.ts` `TIERS` is the one table (DPR, bloom levels, aberration, grain, bokeh).
  `Quality.tsx` mounts drei `PerformanceMonitor` only on auto, after the intro, and only under the
  'always' frameloop, with bounds [45, 57] fps. `applyVerdict` (tested) turns its verdicts into
  tier changes and holds after three. drei's own `flipflops`/`onFallback` is not used, because it
  counts inclines at the top tier and would drop a steady 60 fps machine to low.
- Home: `Director.homePose()` uses `lib/framing.ts` `fitPoints` to fit 97% of stars per screen axis
  from the home orbit (fill 0.84 × 0.74 for HUD chrome). `sceneBus.homeDistance` is "zoom 1" for the
  label pass and depth of field.
- Search: `lib/search.ts` `SEMANTIC_FLOOR = 0.72` drops semantic neighbours below the model's noise
  floor (measured on the real export). A half-matching keyword list with nothing semantic above
  the floor yields no hits.
- Model: `bun run models:fetch` vendors 887 MB into `public/models/` (gitignored). The worker
  probes `/models/.../config.json` and then treats that folder as the remote host (`remoteHost`,
  `remotePathTemplate`). It does not use `localModelPath`: in local mode transformers.js size-checks
  each file with an unconsumed full GET, which stalled the 299 MB weight fetch about 20 s behind
  Chrome's cache lock. Remote mode size-checks with one-byte Range requests.

Measured (dev, Chrome 155 headless, Intel Arc via ANGLE GL, 1600×900, DPR 1):
- Steady overview with `?freeze` and continuous invalidation (rAF-quantised fps; headless
  presents at about 85 to 88 fps at most):

  | Scene | Before W3 | After W3, high | After W3, med | After W3, low |
  |---|---|---|---|---|
  | Real export | 87.5 fps, 53 draws | 85.4 fps, 56 draws | 88.3 fps, 50 draws | 86.2 fps, 48 draws |
  | 10k fixture | 86.2 fps, 47 draws | 81.1 fps, 48 draws | 80.9 fps, 42 draws | 80.9 fps, 40 draws |

- Hover-cycling trace (12 top stars, 450 ms apart, unfrozen, high tier):

  | Build | rAF JS p50 | rAF JS p95 | Frame interval p50 | Frame interval p95 | Presented fps (with tracing) |
  |---|---|---|---|---|---|
  | Base | 4.5 ms | 21.7 ms | 16.6 ms | 110.6 ms | 29.6 |
  | W3 | 4.8 ms | 10.0 ms | 11.8 ms | 19.5 ms | 77.8 |

  The base's drei `Line` rebuilds caused its spikes.
- Idle trace on the real export at high: rAF JS p95 6.1 ms; frame interval p50 11.3 ms and p95
  18.3 ms, which includes the tracing overhead.
- Draw calls: 56 at the overview on high. Up to about 70 when 25 system labels show, because each
  troika label is its own draw.
- Model from local files (WASM fp16): ready in about 9 to 12 s. Uncached queries take 93 to
  143 ms; `probe()` overlap@10 is 0.99.

WebGPU (from the models run, Chrome 155 on the Intel Arrow Lake iGPU plus an RTX 5090 Laptop):
- Default Chrome has no adapter.
- With `--enable-unsafe-webgpu --enable-features=Vulkan,WebGPU --use-angle=gl --ignore-gpu-blocklist`,
  an adapter appears (intel / xe-lpg, or nvidia / blackwell with high-performance), and q8 loads and
  runs on WebGPU. Overlap@10 is 0.97, the load takes 9 to 11 s, and uncached queries take 49 to
  177 ms.
- `--use-angle=vulkan` breaks WebGL context creation on this box.

Known issues left open:
- The pipeline's fully summarised re-export (real galaxy names, separated galaxies) had not landed
  when W3 ended. W3 was verified on the 2026-10-18T01:01:43Z export (51 summarised).
- Draw calls exceed the 60 budget when many system labels are visible (one troika draw each);
  batching the labels (troika `BatchedText`) is the fix.
- Bokeh and bloom make a close-up hazy at 1024 px; `SceneDriver` `BOKEH` (0.38) is the knob.
- The view toggle is `role="radiogroup"` without roving tabindex or arrow keys.
- `vite build` copies `public/models/` (888 MB) into `dist/` when it is present.
- Timeline brushing has no keyboard path in the panel (the Filters popover's starred slider covers
  it).
- Timeline playback turns the camera but does not "slowly pull back" (spec §4).
- Picking and label gaps use `starPixelRadius`, which mirrors neither the bokeh growth
  (`1 + 0.9·coc`) nor the birth overshoot. Close up, the outer rim of a bokeh disc does not pick.
- `SEMANTIC_FLOOR` (0.72) sits 0.01 above the gibberish ceiling measured on WASM fp16. Recheck it if
  the model, dtype or truncation changes.
- `layout.test.ts` pins the CPU formula. Nothing executes `layout.glsl`, so keeping the two in step
  is a review duty.
- The headless rAF-based fps numbers saturate near the presentation rate (about 85 to 88 fps here).
  Use a trace's rAF and frame-interval percentiles to compare builds.
