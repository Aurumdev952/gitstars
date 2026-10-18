# gitstars frontend: implementation plan

This plan was written before any frontend code existed, so it is greenfield. Library API details below come from my knowledge of those libraries, not from source I read here. Each phase therefore starts with a smoke check of the APIs it depends on.

---

## 0. Data contract refinements (schemaVersion 1)

Keep `galaxy.json` as one file at 2.3k repos (about 3 MB, parses in about 40 ms). Make these changes:

- **`meta`**:
  - add `schemaVersion: 1`
  - add `embedding: { model, dims: 256, dtype: "float16", normalized: true, queryPrefix: "task: search result | query: ", docPrefix }`. The worker reads the prefix from here so it never drifts from the pipeline.
  - add `starredRange: [minISO, maxISO]` and `bounds`
  - add `searchProbes: [{ query, topIdx: number[10] }]`. This is a golden set the Python pipeline computes, used to check the browser q4 model against the pipeline's full-precision vectors.
- **`repos[]`**:
  - add `pos2: [x, y]`, a separate 2D UMAP. Squashing the 3D z to 0 makes clusters overlap, so the flat view needs its own layout.
  - change `neighbors` to `[[idx, cosine]]`, where `idx` is the array index rather than the id. It is smaller and needs no lookup.
  - add `description`, the raw GitHub text, next to the LLM-written `oneLiner`.
  - `stars` is a snapshot. `meta.generatedAt` dates it.
- **`clusters[]`**:
  - replace `memberIds` with `members: idx[]`
  - add `keywords[]`
  - use stable ids such as `g03` and `g03.s07`
  - `color` becomes optional. The frontend owns the palette (see §1), and the pipeline colour is only a fallback.
- **`vectors.f16.bin`**: no header, little-endian, row-major. At load, assert `byteLength === N*256*2`.
- **Single source of truth**: `web/src/lib/schema.ts` (zod v4). `bun run schema:export` writes `web/schema/galaxy.schema.json`, and the Python pipeline validates its output against that file.
- **Growth to 10k+** (v2, not now): split into `layout.bin` (columnar typed arrays) and `details.json` (loaded lazily, holds summaries).

---

## 1. Art direction

**Concept: "a telescope survey of your taste."** It should look like a deep-field photograph, but every visual channel carries a meaning.

| Visual channel | Meaning |
|---|---|
| Hue | Macro galaxy (OKLCH, L≈0.78, C≈0.14) |
| Small hue/lightness shift (±15°, ±0.05 L) | Fine system |
| Size | log10(stars), clamped to a pixel range so tiny repos can still be picked |
| Brightness, from 0.55 to 1.0 | How recently you starred it (old stars stay visible) |
| Twinkle amplitude | Activity (`pushedAt` recency). Archived repos are "dead stars": desaturated, no halo, no twinkle |
| Diffraction spikes | Top ~2% by stars (for example >50k). Like bright stars in Hubble images |
| Nebula | Macro galaxy, as a density-following sprite cloud |
| Constellation lines (straight) | Fine system: the MST of that system's kNN graph |
| Curved flowing arcs | kNN similarity of the hovered or selected repo |

**Palette assignment** (`lib/palette.ts`, using `culori` for OKLCH-to-linear-sRGB):
- Give macro hues on the golden angle.
- Then run a greedy re-ordering so that galaxies whose centroids are close in 3D get very different hues.
- Systems spread among their siblings around the parent hue.
- Star colours are computed in linear space. The shader whitens the core.

**Scene layers, back to front:**
1. **Backdrop**: an inverted sphere. Radial gradient from `oklch(0.13 0.03 275)` to near-black, plus a very faint fbm "milky-way band".
2. **Dust**: three `Points` shells (r = 700, 1100, 1600; about 6k points in total; tiny, desaturated). They give parallax for free.
3. **Nebulae**: about 40 sprites per macro galaxy, all in one instanced draw.
4. **Hull**: a fresnel convex hull, only for the focused cluster.
5. **Lines.**
6. **Stars**: additive.
7. **Labels.**

**Post-processing:**
- Bloom (mipmapBlur, threshold about 0.6, because star cores reach HDR values above 1)
- Noise at opacity 0.025. It removes banding in the nebula and backdrop gradients.
- Vignette (offset 0.3, darkness 0.7)
- ChromaticAberration: only at high quality, radially modulated, and stronger during warp.
- ToneMapping (AgX) last, with the Canvas `flat` prop so tone mapping is not applied twice.

**Do not use the postprocessing `DepthOfField`.** Additive sprites do not write depth, so DOF would blur everything as if it were at background depth. Do DOF in the star shader instead: each star's circle of confusion comes from `|viewZ - uFocusDist|`. That widens the halo and dims the core, which gives real bokeh discs. It costs almost nothing and looks better.

**Fog**: computed in the custom shaders (`uFogNear`, `uFogFar`, `uFogColor`). It dims and tints distant stars, which helps you read depth.

**Avoiding white-out in dense clusters:** precompute `aDensity` per star from the mean layout distance to its 8 neighbours. Scale halo intensity by `1/sqrt(density)` so dense cores do not saturate.

**UI tokens** (`src/styles/app.css`, Tailwind v4 `@theme`):
```css
@theme {
  --color-void: oklch(0.12 0.02 275);
  --color-ink: oklch(0.96 0.01 270);
  --color-ink-muted: oklch(0.74 0.02 270);
  --color-ink-faint: oklch(0.56 0.02 270);
  --color-glass: oklch(0.19 0.025 275 / 0.62);
  --color-glass-border: oklch(1 0 0 / 0.08);
  --color-starlight: oklch(0.86 0.12 85); /* selection / focus accent */
  --font-sans: "Geist Variable", system-ui; --font-mono: "Geist Mono Variable", monospace;
  --radius-panel: 1rem;
}
```
- **Glass panel**: `bg-glass backdrop-blur-xl border border-glass-border shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]`. When `prefers-reduced-transparency` or `prefers-contrast: more` is set, use a solid background.
- **Scene tokens** live in `lib/theme.ts`: background, fog, bloom and label outline. A light theme is possible later (paper background, NormalBlending ink dots), but dark comes first.
- **Typography**:
  - Fonts: Geist and Geist Mono via `@fontsource-variable`.
  - 3D labels need a `.ttf` or `.woff` in `public/fonts/`, because troika does not reliably parse woff2.
  - Macro labels: uppercase, tracking 0.2em, about 14 px on screen.
  - System labels: title case, ink-muted, 12 px.
  - Repo labels: mono 11 px, with `owner/` faint and the `name` in ink.

**HUD layout:**
- **Top-left**: the wordmark and "2,286 stars · 14 galaxies · 96 systems".
- **Top-centre**: a search pill, "Search your stars… ⌘K", with active filter chips below it.
- **Top-right**: a 3D / Flat / List toggle group, a Filters button with a count, and a settings menu (quality, motion, ghosts, labels).
- **Bottom-left**: the legend. Each galaxy shows a colour dot, its name and a `visible/total` count. Hover highlights it; click frames it.
- **Bottom-centre**: the collapsible timeline.
- **Bottom-right**: a "✦ Forgotten star" button.
- **Right**: a 420 px detail panel.

---

## 2. Star shader spec (`shaders/star.vert.glsl` / `star.frag.glsl`)

**Geometry**: an `InstancedBufferGeometry` with a 4-vertex quad. Set `frustumCulled={false}` (required, because the quad's bounding sphere is tiny and culling would drop everything) and `raycast={() => null}`.

**Material**: `ShaderMaterial` with `transparent`, `depthWrite:false`, `blending: AdditiveBlending` and `toneMapped:false`.

**Instanced attributes, static:**
- `aPos` vec3, `aPos2` vec3 (with z = 0)
- `aColor` vec3 (linear)
- `aSize` float (normalised log of stars)
- `aBright` (starredAt recency)
- `aSeed` (hash in 0–1)
- `aStarred` (starredAt normalised to 0–1)
- `aMeta` vec4: (archived, activity, quality, spikes)
- `aDensity`

**Instanced attribute, dynamic:** `aDyn` vec4 = (vis, highlight, focus, pulse).
- The CPU Animator damps it toward its target. Upload it with `addUpdateRange`.
- At 10k stars × 16 bytes, a full upload is 160 KB per frame, and only while something is changing.

**Uniforms:**
- `uTime`, `uViewport`, `uPixelRatio`, `uSizeScale`, `uMinPx`, `uMaxPx`
- `uIntro` (0–1), `uIntroOrigin`
- `uFlat` (0–1)
- `uTimeline`, `uTimelineOn`, `uBirthWindow`
- `uFogNear`, `uFogFar`, `uFogColor`
- `uFocusDist`, `uBokeh`
- `uTwinkle` (0 when reduced motion is on)
- `uCamVel` vec3, `uWarp`

**Vertex shader, core logic.** The positions part is mirrored exactly in `lib/layout.ts`, `positionAt(i, u)`, so CPU picking and labels match what the shader draws:
```glsl
vec3 p = mix(aPos, aPos2, uFlat);
float t = clamp((uIntro - aSeed*0.45) / 0.55, 0., 1.);
float e = 1. - pow(1. - t, 3.);                          // easeOutCubic
p = uIntroOrigin + rotY(p - uIntroOrigin, (1.-e)*2.4) * e; // spiral out
float born = uTimelineOn > .5 ? smoothstep(aStarred, aStarred + uBirthWindow, uTimeline) : 1.;
float flash = born * (1. - born) * 4.;
```

**Pixel size**:
- The world size is `uSizeScale * mix(0.6, 2.4, aSize) * (1 + 0.6*hi) * vis * born`.
- It is projected to pixels, then clamped to `[uMinPx*vis, uMaxPx]`, and the quad is expanded in clip space.
- During warp, the quad is stretched along the screen-projected `uCamVel` to make streaks.

**Fragment shader:**
- `r = length(uv)`
- core = `exp(-r²·k)`, multiplied by about 3 so it lands in HDR
- halo = `0.12/(r²·40+1)`, multiplied by `smoothstep(1., .7, r)` and divided by `sqrt(aDensity)`
- optional spikes = `pow(1-|uv.x|, 40)·pow(1-|uv.y|, 4)` plus the transposed term
- twinkle = `1 + uTwinkle·activity·sin(uTime·(1.3+2·seed) + 6.28·seed)`
- an animated starlight ring at r≈0.6 when highlight is above 0.5
- the pulse term `sin(uTime·6)·aDyn.w` for search hits
- bokeh = core energy redistributed into a disc as CoC grows
- fog applied last

**Other materials:**
- **Nebula** (`nebula.*.glsl`): one instanced draw of about 600 sprites. Each sprite is anchored on a random member and moves with `mix(pos, pos2, uFlat)`. Attributes are `aMember`, `aScale`, `aColor`, `aSeed` and `aCluster`. The look is 3D simplex fbm drifting at `uTime·0.02`, times a radial falloff, at alpha 0.03–0.06. It fades when the camera is close (`smoothstep(near, near+30, -mvZ)`). Uniforms are `uFocusCluster`, `uFocusAmt`, plus a per-cluster visibility texture (16×1) so that a nebula fades as its members are filtered out.
- **Hull** (`hull.*.glsl`): three-stdlib `ConvexGeometry` built from the focused cluster's current positions, padded by about 6%. Run `mergeVertices` and `computeVertexNormals` for a softer look. The shader is a fresnel rim `pow(1-|n·v|, 3)` with an animated `uReveal`. In flat mode use a 2D `d3-polygon` hull outline instead.
- **Lines** (`line.*.glsl`, Phase 3): instanced screen-space ribbons, one quad per segment. Attributes are `aA`, `aB`, `aT0`, `aT1` (position along the curve), `aColor`, `aAlpha` and `aGroup`. The fragment does antialiased edges, a draw-on step (`step(aT, uProgress)`) and a travelling pulse (`fract(aT·3 - uTime·0.6)`). One material serves both the constellation MST and the kNN arcs. In Phase 1–2, use drei `<Line segments>` and `<QuadraticBezierLine>` instead.
- **Shared chunks**: `shaders/chunks/{noise,easing,fog,layout}.glsl`, imported with `?raw` and joined by a tiny `#include <gs_x>` replacer in `shaders/index.ts`. Avoid `vite-plugin-glsl` because its Vite 8 support is not confirmed.

---

## 3. Interactions

- **Picking: screen-space nearest, on the CPU** (`lib/picking.ts`).
  - On each pointermove (rAF-throttled, skipped while CameraControls is dragging), project every *visible and born* star through `viewProj` using `positionAt`.
  - Pick the star with the smallest `d²` within `max(8px, 0.6·renderedRadiusPx)`, with a slight bias toward bigger stars.
  - Cost: about 0.3 ms at 10k. A GPU id buffer is unnecessary and fiddly with billboards. Instanced raycasting is wrong here, because the vertex shader moves the quads.
  - At 100k or more, switch to a screen-space grid.
  - A click needs pointer travel under 4 px. Clicking empty space deselects.
- **Hover**:
  - After 120 ms, show a single DOM tooltip anchored to the star (not the cursor). It shows fullName, a one-line `oneLiner`, "★ 12.3k · Rust · cli", and the system's colour dot and name.
  - The 8 neighbours get highlight 0.6.
  - Curved kNN arcs appear. Each arc's control point is `mid + normalize(cross(viewDir, b-a))·|b-a|·0.25`, so it always bows visibly toward the viewer.
  - Arc width and alpha scale with cosine. Arcs flow from the source to the neighbour and fade in over 150 ms.
- **Click a repo**:
  - Push `?repo=owner/name` (push, not replace, so browser Back walks your trail of visited stars).
  - The Director calls `fitToSphere(new Sphere(p, max(12, 4·d8)), true)`, where `d8` is the layout distance to the 8th neighbour.
  - The right panel is accounted for with `camera.setViewOffset`, which shifts the projection centre into the free area. Picking already uses `camera.projectionMatrix`, so it stays consistent.
  - For long flights (more than 150 units), use two stages: pull back 20% while turning, then dolly in. Turn on warp streaks.
  - The panel slides in 150 ms after takeoff. Arcs draw on, staggered by rank, at 40 ms each.
- **Repo panel** (`RepoPanel.tsx`):
  - Header: owner (muted) / **name**, kind badge, language dot.
  - Facts: stars with a log-scale bar, "active 3d ago", "starred Mar 2021 · 4y ago", and an archived chip.
  - Body: the `oneLiner` as a lead, then `summary`.
  - Tag chips; clicking one adds a filter. Stack chips.
  - Breadcrumb "Galaxy › System"; each part is clickable.
  - Similar repos list with a cosine bar. Hovering an entry highlights it in the scene; clicking flies there.
  - Buttons: Open on GitHub ↗, Homepage ↗.
  - A subtle quality meter.
- **Clusters**: `?cluster=g03` or `g03.s07`.
  - Camera: `fitToSphere(boundingSphere(current member positions)·1.1)`.
  - Everything else dims to 0.25 via `aDyn.z`. The hull reveals itself, and that galaxy's system labels and constellations brighten.
  - The `ClusterPanel` shows the blurb, keywords, the kind distribution, a top-languages bar, child systems, and members sorted by quality or stars. List hover and the scene highlight each other.
- **⌘K palette** (`cmdk`, via shadcn `Command`):
  - Hybrid ranking: a MiniSearch lexical index gives results instantly. Semantic results arrive about 30 ms later and are merged with RRF (k = 60). An exact `fullName` match is pinned to the top.
  - Groups: Repos, Galaxies & systems, and Actions (flat, timeline, forgotten star, "Lens: ‹query›").
  - Moving through results with the arrow keys previews: the camera flies with a short smoothTime, debounced to 150 ms. Enter selects.
  - Hits pulse, and non-hits dim.
  - The camera frames the top hits whose score is at least 0.9 × the best score (at most 12), using a bounding sphere.
  - The footer shows model status: "Semantic search warming… 63% (WebGPU)".
- **Concept lens**: this is the signature "sophisticated" feature.
  - It embeds the query once, then sets `aDyn.y` for *all N* stars to their normalised similarity.
  - The galaxy turns into a heat map of a concept ("anything about vector databases"). A small legend ramp appears.
- **Filters** (`FilterPopover`, shadcn Popover):
  - Kind chips with counts.
  - Language multi-combobox.
  - Tags, using cmdk multi-select.
  - Stars: a dual Slider on a log scale over a mini histogram.
  - Pushed within: any, 1y or 6m.
  - Archived: include, exclude or only.
  - Starred date range, kept in sync with the timeline.
  - Facet counts exclude each facet's own filter. Recomputing naively is under 1 ms.
  - Filtered-out stars stay as non-pickable 8% "ghosts" (setting `ghosts`) so you keep your bearings.
- **LOD labels** (`components/galaxy/labels/`):
  - **Macro**: drei `<Billboard><Text/></Billboard>`, always shown. Scaled each frame to a roughly constant screen size. Fades out once the camera is inside the galaxy's radius. Uses troika `outlineWidth="6%"`, a dark `outlineColor` and the `characters` prop pre-set to avoid hitches.
  - **System**: `Text` instances exist for all systems. Each is visible when its projected radius exceeds 60 px (with hysteresis), at most 25 at once, with greedy collision checks against a screen-space occupancy grid.
  - **Repo**: a pool of 24 DOM labels whose transforms are written directly in `useFrame`. Their priority is `brightness × size × 1/(1 + screen distance to cursor or target)`. Hovered, selected and the selected star's neighbours always get labels. Placement is recomputed at 10 Hz or when the camera comes to rest.
- **2D/flat toggle** (`f`):
  - Tween `uFlat` from 0 to 1 over 1.2 s (easeInOutCubic), and at the same time `setLookAt(0,0,D, 0,0,0, true)`.
  - In flat mode, behave like a map. Left drag pans: `mouseButtons.left = ACTION.TRUCK`. Rotation is locked by setting min and max polar angle to π/2. Wheel zooms toward the cursor (`dollyToCursor`).
- **Idle autorotate**: after 8 s without input, `azimuthAngle += 0.04 rad/s · dt` in `useFrame`. Any input stops it. It is disabled when reduced motion is on.
- **Forgotten star** (`r`, `lib/discovery.ts`):
  - score = `quality × sat(yearsSinceStarred/3) × (archived ? 0.2 : 1) × activityBoost(pushedAt) × (seenThisSession ? 0 : 1)`.
  - Sample from the top 50, weighted by score.
  - Fly there with warp. The panel adds the line "You starred this 3 years ago — still actively maintained."
- **Stretch: "wormhole".** Shift-click a second star to compute the Dijkstra shortest path through the kNN graph (weight `1 - cos`) and draw it as a glowing route.

**Keyboard** (`react-hotkeys-hook`):

| Key | Action |
|---|---|
| ⌘K, `/` | Open search |
| Esc | Step out one level: repo, then cluster, then overview; closes overlays |
| ←↑→↓ | With a star selected: spatial navigation to the nearest star in that screen direction. With none: orbit |
| `n` / `N` | Cycle through neighbours |
| `[` `]` | Previous or next in the current list (hits or members) |
| `1`–`9` | Jump to a galaxy |
| `g` | Home |
| `f` | Toggle flat view |
| `l` | List view |
| `t` | Timeline |
| Space | Play or pause (timeline) |
| `r` | Forgotten star |
| `?` | Shortcuts dialog |

---

## 4. Choreography

**Intro** (about 4.2 s; skippable by any input; skipped entirely, landing on the target, when the URL has `repo`, `cluster` or `q`):

| Time | Event |
|---|---|
| 0.0–0.6 s | Backdrop and dust fade in. The wordmark letter-spaces in (motion). |
| 0.5–3.2 s | `uIntro` goes from 0 to 1. Stars burst from a single point and spiral out along arms (the per-galaxy delay is ordered by hue angle), then settle. The camera dollies from 40 to its home distance (about 260) while rotating 30° in azimuth. |
| 2.6–3.8 s | Each galaxy's nebula fades in as its members land. |
| 3.2 s | Macro labels appear with a 60 ms stagger. HUD panels slide up with a 40 ms stagger. |
| 4.0 s+ | Autorotate becomes eligible. |

**Other choreography:**
- **Filter transitions**: maath `damp` (λ ≈ 8) on `aDyn.x`, plus a per-star delay of `hash × 180 ms`. Stars that leave shrink to 0.3 and fade to ghost. Stars that enter grow back. Nebula and legend counts follow over 600 ms. Nothing pops.
- **Timeline** (`Timeline.tsx`):
  - An SVG histogram of starredAt by month, stacked and coloured by galaxy. It shows "what you were into, when".
  - Dragging the scrubber writes `uTimeline` directly through a ref, with no React re-render of the scene.
  - Play runs 20 s by default (0.5×, 1×, 2×). Each birth scales 0 → 1.2 → 1 with a flash. The camera autorotates and slowly pulls back.
  - A large thin-type date ticker reads "Mar 2019 · 412 stars", with the brightest newly born repo name fading underneath.
  - Picking and labels skip stars that are not yet born.
- **Director** (`components/galaxy/Director.ts`): a non-React module. It holds the CameraControls ref and exposes `flyToRepo`, `frameCluster`, `frameIndices`, `home`, `toFlat` and `playIntro`. These are async because CameraControls transitions return promises. A new command cancels any running sequence.

---

## 5. Performance

- **Draw calls**: backdrop, 3 dust layers, nebula, hull, constellation lines, kNN lines, stars, about 40 troika texts, plus post-processing. Target under 60 draw calls and 60 fps at 1440p on an integrated GPU at quality "med".
- **Canvas settings**: `gl={{ antialias:false, powerPreference:'high-performance', alpha:false }}`, `dpr={[1,2]}`, `flat`. `<EffectComposer frameBufferType={HalfFloatType} multisampling={0}>`. The sprites are soft and the ribbon lines are antialiased in their own shader, so MSAA is not needed.
- **Adaptive quality**: drei `<PerformanceMonitor>` steps DPR down, then turns off chromatic aberration and noise, then reduces bloom levels. Quality presets: low, med, high.
- **frameloop**: `frameloop={ambient ? 'always' : 'demand'}`, where `ambient` means twinkle or autorotate or timeline playing or intro running, *and* the tab is visible. After 30 s idle with autorotate off it drops to `demand`. When reduced motion is on it is always `demand`. drei CameraControls already calls invalidate while it moves, and the Animator invalidates until its values converge.
- **React stays out of the frame loop.** The Animator, label projection, picking and Director all read `useGalaxyStore.getState()` or subscribe. Uniforms are mutated through refs.
- **Lines**: system constellations are the MST of each system's kNN subgraph (Kruskal on `1 - cos`, computed on the client in `lib/mst.ts`; disconnected components are joined by nearest 3D distance). That is about N segments in one buffer. They fade with camera distance to each system so the overview is not a hairball. kNN arcs are a small dynamic buffer: 8 arcs × 16 segments.
- **Search worker** (`workers/search.worker.ts`, Comlink):
  - It holds the vectors (decoded once from `Float16Array` to `Float32Array`; 2.3 MB at 2.3k, 10 MB at 10k), the MiniSearch index, and the transformers.js pipeline.
  - A brute-force dot product over 256 dimensions takes about 1 ms at 2.3k and about 3 ms at 10k.
  - It starts warming in `requestIdleCallback` after the intro, or as soon as ⌘K is first pressed.
  - Stale queries are dropped by sequence number. Results go through an LRU cache.
  - API:
```ts
interface SearchAPI {
  init(o:{vectorsUrl:string;n:number;dim:256;queryPrefix:string;docs:LexDoc[]}, onProgress:(p:Progress)=>void): Promise<{device:'webgpu'|'wasm'}>;
  query(text:string, k:number, seq:number): Promise<{seq:number; idx:Int32Array; score:Float32Array; lexical:Int32Array}>;
  similarTo(i:number, k:number): Promise<{idx:Int32Array; score:Float32Array}>;
  lens(text:string): Promise<Float32Array>; // N scores
  probe(): Promise<{overlapAt10:number}>;   // vs meta.searchProbes
}
```
  - **Device selection**: if `navigator.gpu?.requestAdapter()` resolves, use `{device:'webgpu', dtype:'q4'}`. Otherwise use `{device:'wasm', dtype:'q8'}`.
  - Truncate the 768-d output to 256 and renormalise.
  - For a fully offline local app, add an optional `bun run models:fetch` that copies the model into `public/models/`. Then set `env.localModelPath`, `env.allowRemoteModels=false`, and point `env.backends.onnx.wasm.wasmPaths` at local files.
  - Set COOP/COEP headers in the Vite server and preview config so multi-threaded wasm can use SharedArrayBuffer.
  - Add `optimizeDeps.exclude: ['@huggingface/transformers']`.
- **Data loading**: the route `loader` fetches `galaxy.json` and passes it to `buildGalaxyIndex()`. That produces typed arrays (positions, positions2, colours, sizes and so on), `byFullName: Map`, cluster maps, the 2D centroids, densities and MSTs. Zod validation runs in dev only.

---

## 6. File structure (`web/`)

```
web/
  package.json  vite.config.ts  tsconfig.json  components.json(shadcn)
  public/data/{galaxy.json,vectors.f16.bin}  public/data/fixture/{...}  public/fonts/Geist-Medium.woff
  schema/galaxy.schema.json
  scripts/make-fixture.ts  scripts/export-schema.ts  scripts/fetch-model.ts
  src/
    router.tsx
    routes/__root.tsx          # fonts, theme class, <Outlet/>, ShortcutsDialog, LiveRegion
    routes/index.tsx           # validateSearch, loader, <ClientOnly><GalaxyCanvas/></ClientOnly>, <Hud/>
    styles/app.css
    lib/  schema.ts load.ts palette.ts theme.ts layout.ts picking.ts filters.ts facets.ts
          mst.ts discovery.ts labels.ts spatialNav.ts format.ts url.ts
    state/store.ts  state/selectors.ts
    workers/search.worker.ts  workers/searchClient.ts  workers/rrf.ts
    shaders/ index.ts star.vert.glsl star.frag.glsl nebula.vert.glsl nebula.frag.glsl
             line.vert.glsl line.frag.glsl hull.vert.glsl hull.frag.glsl backdrop.frag.glsl
             chunks/{noise,easing,fog,layout}.glsl
    components/galaxy/
      GalaxyCanvas.tsx Scene.tsx Director.ts CameraRig.tsx Animator.tsx Intro.ts
      Stars.tsx useStarBuffers.ts Nebulae.tsx ClusterHull.tsx Constellations.tsx
      NeighborArcs.tsx Backdrop.tsx Dust.tsx Effects.tsx Quality.tsx PointerPicker.tsx
      labels/{MacroLabels,SystemLabels,RepoLabelPool}.tsx
    components/hud/
      Hud.tsx TopBar.tsx SearchPalette.tsx FilterPopover.tsx FilterChips.tsx Legend.tsx
      RepoPanel.tsx ClusterPanel.tsx HoverTooltip.tsx Timeline.tsx TimelineHistogram.tsx
      DiscoverButton.tsx ListView.tsx SettingsMenu.tsx ShortcutsDialog.tsx LiveRegion.tsx
    components/ui/             # shadcn generated (Command, Popover, Slider, ToggleGroup, Badge, Tooltip, ScrollArea, Dialog, Kbd)
    hooks/useHotkeys.ts useReducedMotion.ts useGalaxySearch.ts useDebugHooks.ts
```

**Libraries, beyond the given stack:**
- `zustand` with `subscribeWithSelector`
- `motion` for HUD transitions and `AnimatePresence`
- `cmdk` (through shadcn)
- `maath` for `damp`
- `culori` for OKLCH
- `d3-array`, `d3-polygon`, `d3-scale`
- `minisearch`
- `comlink`
- `@tanstack/react-table` and `@tanstack/react-virtual` for the list
- `react-hotkeys-hook`
- `zod` v4
- `r3f-perf` in dev (fall back to `stats-gl` if it is incompatible with R3F 9)

**Routing**: a single route `/`, with `validateSearch` driven by zod:
```ts
const search = z.object({
  repo: z.string().optional(),            // "owner/name"
  cluster: z.string().optional(),         // "g03" | "g03.s07"
  q: z.string().optional(),
  lens: z.string().optional(),
  view: z.enum(['3d','flat','list']).catch('3d'),
  kind: z.array(Kind).optional(), lang: z.array(z.string()).optional(), tag: z.array(z.string()).optional(),
  stars: z.tuple([z.number(), z.number()]).optional(), archived: z.enum(['include','exclude','only']).catch('include'),
  t: z.number().min(0).max(1).optional(), // timeline cursor
  seed: z.number().optional(), freeze: z.boolean().optional(), debug: z.boolean().optional(),
});
```
- Use `search.middlewares: [stripSearchParams(defaults)]` so URLs stay clean.
- Use search parameters, not a `/cluster/$id` route. Changing route would remount the Canvas.
- `repo` and `cluster` changes push history entries. Filters, `q` and `t` replace.
- Wrap the Canvas in `<ClientOnly>`, because SPA mode still prerenders a shell.

**Store** (`state/store.ts`):
- **The URL owns navigational state** (repo, cluster, view, filters, q, lens, t). `routes/index.tsx` mirrors it one way into the store. Store actions call `router.navigate`, so state never syncs in both directions.

```ts
type GalaxyStore = {
  galaxy: GalaxyIndex | null;
  // mirrored from URL (read-only here)
  selected: number | null; focusCluster: string | null; view: '3d'|'flat'|'list';
  filters: Filters; visibleMask: Uint8Array; visibleCount: number;
  // transient
  hovered: number | null; hoveredCluster: string | null; preview: number | null;
  search: { status: 'idle'|'warming'|'ready'|'error'; progress: number; device: 'webgpu'|'wasm'|null;
            query: string; hits: Hit[]; lens: Float32Array | null };
  timeline: { open: boolean; playing: boolean; cursor: number; speed: 0.5|1|2 };
  intro: 'pending'|'playing'|'done'; cameraBusy: boolean; dragging: boolean;
  settings: { quality: 'low'|'med'|'high'; motion: 'full'|'reduced'; autorotate: boolean;
              ghosts: boolean; labels: 'auto'|'more'|'none'; bloom: boolean };
  actions: { hover(i|null): void; select(i|null): void; focus(id|null): void; setFilters(p): void;
             runQuery(q): void; setLens(q|null): void; discover(): void; toggleFlat(): void;
             setTimeline(p): void; skipIntro(): void };
};
```
**Scene bus**: `sceneBus` holds non-reactive refs: uniforms, the `aDyn` array, the controls and the Director. It is a module singleton, so DOM UI can command the camera without prop drilling.

---

## 7. Accessibility and fallbacks

- **Reduced motion** (from the media query or the setting):
  - No intro: a 300 ms fade instead.
  - No twinkle, autorotate, warp, chromatic aberration or noise.
  - Camera moves become short (smoothTime 0.15) or instant with a fade.
  - Timeline births appear without flashes.
  - `frameloop` stays `demand`.
- **Canvas semantics**:
  - The canvas is `aria-hidden`.
  - A polite live region announces hover and selection, for example "vercel/next.js, framework, 130k stars, in Web Frameworks".
  - Every function is also available through DOM controls: the palette, the legend buttons, both panels and the list view.
  - Opening a panel moves focus to its heading. Esc returns focus to where it was.
- **List view** (`view=list`):
  - A virtualised, sortable table that shares filters with the 3D view.
  - Selecting a row opens the panel. Switching back to 3D flies to that row's star.
  - The Canvas stays mounted with `frameloop='never'`.
- **Missing capabilities**:
  - No WebGL2: force the list view and show a notice.
  - No WebGPU: wasm q8, with a note in the palette footer.
  - Model fails to load: lexical search only, with the reason shown.
- **Contrast and colour**:
  - Panel text contrast is at least 4.5:1 over glass. The glass background opacity has a floor; check it with the dataviz/OKLCH validator approach.
  - Colour is never the only channel: the legend and labels always carry the names.

---

## 8. Phases

**Phase 0: scaffold**
- TanStack Start through bun, with `tanstackStart({ spa: { enabled: true } })`, `@vitejs/plugin-react` and `@tailwindcss/vite`.
- Set up shadcn.
- `schema.ts` and `load.ts`.
- **Fixture generator** (`scripts/make-fixture.ts`):
  - 6 galaxies × 4 systems, 300 repos.
  - Synthetic 256-d vectors: cluster centres plus noise, then normalised. kNN is computed from them, so neighbours and MSTs make sense.
  - 3D positions are Gaussian blobs around separated centres. `pos2` comes from a fixed projection.
  - starredAt spans 6 years with bursts per galaxy. Kinds and languages are realistic and skewed. Names come from a word list.
  - Writes `vectors.f16.bin` as a `Float16Array` and `searchProbes`.
  - `--embed`: run real `@huggingface/transformers` on the CPU over the fake one-liners, so semantic search works in fixture mode.
  - `--n 10000`: a stress fixture.
- Switch datasets with `VITE_DATA=fixture` or `?data=fixture`.
- *API smoke checks*: drei `CameraControls` `fitToSphere`/`setLookAt` promises, troika woff loading, `Float16Array` support, and transformers 4.3.1 WebGPU loading inside a Vite 8 worker.

**Phase 1: MVP scene**
- Canvas and Stars shader. Static positions only; no intro, flat or timeline uniforms yet, but reserve them.
- CameraControls and drei `<Stars>` as a placeholder for dust.
- Bloom and Vignette.
- Picking, the tooltip, and click to fly-to plus RepoPanel.
- `?repo=` deep link.
- MacroLabels and Legend.

**Phase 2: interactions**
- Search worker, palette, RRF, hit pulse and framing.
- Filters, chips, facets and the Animator transitions.
- Cluster focus and ClusterPanel.
- kNN arcs (drei `QuadraticBezierLine`).
- System labels and the repo label pool.
- Flat toggle (needs `pos2`).
- Keyboard and spatial navigation.
- Forgotten star.
- List view, the live region and the reduced-motion basics.

**Phase 3: polish**
- Intro choreography.
- Nebulae and hull.
- Custom ribbon line shader for MST constellations and flowing arcs.
- Timeline with histogram and playback.
- Warp streaks, shader bokeh DOF, diffraction spikes, density normalisation.
- Chromatic aberration, noise and AgX.
- Concept lens.
- PerformanceMonitor tiers.
- 10k stress pass.
- Optional: wormhole paths and palette query syntax (`kind:cli lang:rust stars:>1k`).

---

## 9. Verification

**Dev hooks** (`hooks/useDebugHooks.ts`; active only with `?debug`):
- `window.__gitstars = { ready, intro, fps, drawCalls: renderer.info.render.calls, screenPos(fullName), hover(i), select(fullName), focus(id), query(q), setTimeline(t), director }`
- `?freeze=1&seed=1` fixes `uTime`, skips the intro and seeds discovery, so screenshots are deterministic.

**Chrome DevTools MCP loop**:
1. `navigate_page` to `localhost:3000/?data=fixture&freeze=1&debug=1`.
2. `wait_for` the text "galaxies", or `evaluate_script` polling `__gitstars.ready`.
3. `take_screenshot` for each state. The MCP `click`/`hover` tools target elements by uid, not canvas coordinates, so drive the scene through `evaluate_script` with the hooks, or dispatch synthetic pointer events at the coordinates `screenPos()` returns.
4. States to capture:
   - overview
   - hover with arcs
   - repo selected (panel and viewOffset framing)
   - cluster focused (hull)
   - search hits
   - lens
   - flat
   - timeline at t = 0.4
   - list view
   - `?motion=reduced`
   - a 1280×800 viewport, via `resize_page`
5. Check `list_console_messages` for shader compile warnings.

**Performance**:
- Run `performance_start_trace` with reload, then `performance_analyze_insight`. Also trace 5 s of autorotate on the 10k fixture.
- Budgets:
  - frames ≤ 16.7 ms
  - pick ≤ 0.5 ms
  - JSON parse and index build ≤ 60 ms at 2.3k
  - warm semantic query ≤ 150 ms on WebGPU
  - draw calls ≤ 60
- Use `take_heapsnapshot` once to confirm the vectors live only in the worker.

**Search quality**: `__gitstars.probe()` must reach overlap@10 ≥ 0.7 against `meta.searchProbes`. Also embed 5 repo docs in the browser with `docPrefix` and require cosine ≥ 0.97 against the stored vectors. This catches prefix or truncation mismatches.

**Unit tests (vitest)**: filters and facets, `positionAt` against hand-computed shader maths, picking, MST, RRF, discovery scoring, palette contrast, and URL round-trip.

---

## Main risks

- **Prefix or quantisation drift** between the Python pipeline and the browser model. The probes above catch it.
- **Additive white-out** in dense clusters. Density normalisation and the bloom threshold handle it.
- **UMAP outliers** stretching the bounds. The pipeline should normalise by percentile, and the camera's max distance comes from `meta.bounds`.
- **Model download size** on first load. The palette stays usable with lexical search in the meantime, and the model can be served locally.
- **`backdrop-filter` cost** over WebGL. Keep panels small, and the low quality tier drops the blur.
- **Three-way consistency.** The layout logic exists in three places: the shader, the CPU mirror (`positionAt`) and the nebula anchors. Keep it in one documented formula and test the CPU mirror.

### Critical Files for Implementation
- web/src/components/galaxy/Stars.tsx (with web/src/shaders/star.vert.glsl and star.frag.glsl)
- web/src/lib/layout.ts (the CPU mirror of the shader positions; used by picking, labels and the Director)
- web/src/components/galaxy/Director.ts (camera choreography and the scene bus)
- web/src/state/store.ts (with web/src/routes/index.tsx for URL ownership)
- web/src/workers/search.worker.ts (with web/src/lib/schema.ts as the contract)