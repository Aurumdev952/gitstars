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
