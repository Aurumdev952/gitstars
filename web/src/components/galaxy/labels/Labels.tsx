import { useEffect, useMemo, useRef } from 'react'
import { Billboard, Text } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Color, LinearSRGBColorSpace, Vector3, type Group, type PerspectiveCamera } from 'three'
import type { ClusterNode, GalaxyIndex } from '#/lib/load'
import { sceneTheme } from '#/lib/theme'
import { labelReveal } from '#/lib/intro'
import { Occupancy, balancedSplit, hysteresis, insetSlots, place, starSlots, type LabelBox, type Rect, type Slot } from '#/lib/labelLayout'
import { bornAt, positionAt, starPixelRadius, type StarSizeUniforms } from '#/lib/layout'
import { projectPoint, type Projector, type ScreenPoint } from '#/lib/picking'
import { useGalaxyStore } from '#/state/store'
import { currentLayout, currentProjector, sceneBus } from '../sceneBus'

const LABEL_FONT = '/fonts/Geist-Medium.woff'
const CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789&-.,:/+ \'’()'
const RETICLE = 24
const FADE_RATE = 10
const SYSTEM = { maxShown: 25, onPx: 130, offPx: 105 }
/** Names longer than this many characters wrap onto two balanced lines. */
const WRAP = { galaxy: 20, system: 26 }
/** Pixels a cluster label may sit from its anchor before it hides instead. */
const MAX_DRIFT = 12
const REPO = { autoCount: 24, moreCount: 40, minPx: 7, reselectMs: 100, candidates: 80 }

type TextLike = {
  fillOpacity: number
  outlineOpacity: number
  textRenderInfo?: { blockBounds: [number, number, number, number] } | null
}

type ClusterLabel = {
  node: ClusterNode
  text: string
  color: Color
  px: number
  /** Last placement slot, for hysteresis; null while hidden. */
  slot: number | null
  shown: boolean
  /** Placed in this frame's occupancy pass. */
  placed: boolean
  alpha: number
  /** Scratch for this frame's sort keys: priority (galaxies) or projected radius (systems). */
  key: number
  /** Scratch: camera distance to the anchor this frame. */
  dist: number
  /** Galaxy labels arrive one by one at the end of the intro; this is the delay in the stagger. */
  order: number
}

type RepoState = {
  lastPick: number
  candidates: number[]
  slotOf: Map<number, number>
  starOf: (number | null)[]
  alpha: number[]
  placed: Map<number, number>
  /** The map being filled this frame; swapped with `placed` at the end. */
  next: Map<number, number>
  width: Map<number, number>
  /** The DOM pool these assignments belong to; a remounted pool starts empty. */
  pool: HTMLElement[] | null
  recheck: ReturnType<typeof setTimeout> | 0
}

// Per-frame scratch. The label pass runs every frame over up to 10k stars, so its per-star and
// per-label work reuses these rects, slots, boxes and screen points instead of allocating.
const scratch: [number, number, number] = [0, 0, 0]
const screen: ScreenPoint = { x: 0, y: 0, viewDist: 0 }
const anchor = new Vector3()
const viewPos = new Vector3()
const up = new Vector3()
const right = new Vector3()
const rect: Rect = { x0: 0, y0: 0, x1: 0, y1: 0 }
const repoSlots: Slot[] = starSlots(0, 0, 0)
const labelSlots: Slot[] = insetSlots(0, 0)
const box: LabelBox = { x: 0, y: 0, w: 0, h: 0, slots: repoSlots, prev: null, pad: 0 }
const dims = { w: 0, h: 0 }
const sizes: StarSizeUniforms = { sizeScale: 1, minPx: 1, maxPx: 1 }
const TOP = REPO.candidates
const topIdx = new Int32Array(TOP)
const topScore = new Float64Array(TOP)
const byKeyDesc = (a: ClusterLabel, b: ClusterLabel) => b.key - a.key

function inkTint([r, g, b]: readonly number[], white: number) {
  return new Color().setRGB(white + r! * (1 - white), white + g! * (1 - white), white + b! * (1 - white), LinearSRGBColorSpace)
}

function makeLabels(nodes: ClusterNode[], macro: boolean): ClusterLabel[] {
  return nodes.map((node, k) => ({
    node,
    text: macro ? balancedSplit(node.name.toUpperCase(), WRAP.galaxy) : balancedSplit(node.name, WRAP.system),
    color: inkTint(node.color.linear, macro ? 0.62 : 0.45),
    px: macro ? sceneTheme.label.macroPx : sceneTheme.label.systemPx,
    slot: null,
    shown: false,
    placed: false,
    alpha: 0,
    key: 0,
    dist: 0,
    order: k,
  }))
}

/**
 * Every label tier in one ordered screen-space pass, so no two labels overlap: HUD panels and
 * reticles claim space first, then the selected star's neighbours, galaxy labels, system labels at
 * mid zoom, and finally a pool of repo labels ranked by brightness, size and nearness to the cursor.
 */
export function Labels({ galaxy }: { galaxy: GalaxyIndex }) {
  const macro = useMemo(() => makeLabels(galaxy.galaxies, true), [galaxy])
  const systems = useMemo(() => makeLabels(galaxy.systems, false), [galaxy])
  const all = useMemo(() => [...macro, ...systems], [macro, systems])
  const byPriority = useMemo(() => [...macro], [macro])
  const bySize = useRef<ClusterLabel[]>([])
  const groups = useRef<Map<ClusterLabel, Group>>(new Map())
  const texts = useRef<Map<ClusterLabel, TextLike>>(new Map())
  const occ = useRef(new Occupancy(1, 1))
  const forced = useRef<number[]>([])
  const repo = useRef<RepoState>({
    lastPick: 0,
    candidates: [],
    slotOf: new Map(),
    starOf: [],
    alpha: [],
    placed: new Map(),
    next: new Map(),
    width: new Map(),
    pool: null,
    recheck: 0,
  })
  useEffect(() => () => clearTimeout(repo.current.recheck), [])
  const occluderCache = useRef({ at: -Infinity, rects: [] as Rect[], count: 0 })

  useFrame(({ camera, size }, dt) => {
    const cam = camera as PerspectiveCamera
    const s = useGalaxyStore.getState()
    const g = s.galaxy
    const m = currentProjector(cam)
    if (!g || g !== galaxy || !m) return
    const layout = currentLayout()
    const flat = layout.flat
    const o = occ.current
    o.reset(size.width, size.height)
    const u = sceneBus.uniforms
    sizes.sizeScale = u.uSizeScale.value
    sizes.minPx = u.uMinPx.value
    sizes.maxPx = u.uMaxPx.value
    const k = s.frozen ? 1 : 1 - Math.exp(-FADE_RATE * Math.min(dt, 0.1))
    let moving = false
    const fade = (cur: number, target: number) => {
      const next = Math.abs(target - cur) < 0.01 ? target : cur + (target - cur) * k
      if (next !== target) moving = true
      return next
    }

    // HUD rects are read at 10 Hz: getBoundingClientRect after this frame's transform writes would
    // force a layout every frame.
    const oc = occluderCache.current
    if (performance.now() - oc.at > REPO.reselectMs) {
      oc.at = performance.now()
      oc.count = 0
      for (const read of sceneBus.occluders) {
        const r = read()
        if (!r || r.width <= 0) continue
        const slot = (oc.rects[oc.count++] ??= { x0: 0, y0: 0, x1: 0, y1: 0 })
        slot.x0 = r.left
        slot.y0 = r.top
        slot.x1 = r.right
        slot.y1 = r.bottom
      }
    }
    for (let q = 0; q < oc.count; q++) o.add(oc.rects[q]!)
    const screenOf = (i: number) => {
      const [x, y, z] = positionAt(g.attrs, i, layout, scratch)
      return projectPoint(m, x, y, z, screen)
    }
    for (const i of [s.selected, s.hovered]) {
      if (i === null) continue
      const p = screenOf(i)
      if (!p) continue
      rect.x0 = p.x - RETICLE
      rect.y0 = p.y - RETICLE
      rect.x1 = p.x + RETICLE
      rect.y1 = p.y + RETICLE
      o.add(rect)
    }

    const labelsOn = s.settings.labels !== 'none'
    const repoState = repo.current
    const forcedList = forced.current
    forcedList.length = 0
    if (labelsOn && s.selected !== null) for (const [j] of g.repos[s.selected]!.neighbors) forcedList.push(j)
    const repoPlaced = repoState.next
    repoPlaced.clear()
    const placeRepo = (i: number) => {
      if (s.filtered && !s.filtered.visible[i]) return
      if (layout.timelineOn && bornAt(g.attrs, i, layout) < 0.5) return
      const p = screenOf(i)
      if (!p) return
      const w = repoState.width.get(i) ?? estimateWidth(g.repos[i]!.fullName)
      const r = starPixelRadius(g.attrs.size[i]!, sceneBus.dyn[i * 4 + 1] ?? 0, 1, 1, p.viewDist, m.proj[5]!, size.height, sizes)
      box.x = p.x
      box.y = p.y
      box.w = w
      box.h = 16
      box.slots = starSlots(w, 16, Math.min(r, 18), repoSlots)
      box.prev = repoState.placed.get(i) ?? null
      box.pad = 2
      box.maxDrift = undefined
      box.ideal = false
      const slot = place(o, box, 4)
      if (slot !== null) repoPlaced.set(i, slot)
    }
    for (const i of forcedList) placeRepo(i)

    // Cluster names step back under the lens so the heat map carries the view.
    const lensDim = s.lens.state === 'ready' ? 0.5 : 1
    const reveal = (order: number) => (sceneBus.labelClock === Infinity ? 1 : labelReveal(sceneBus.labelClock, order))

    // Galaxy labels, the largest on screen first (members over distance), so where galaxies overlap
    // in projection a big one keeps its name and a small one yields. They fade once the camera is
    // inside the galaxy.
    for (const l of byPriority) {
      l.dist = cam.position.distanceTo(clusterAnchor(l.node, flat, anchor))
      l.key = l.node.core.length / Math.max(1, l.dist)
    }
    byPriority.sort(byKeyDesc)
    for (const l of byPriority) {
      const inside = Math.min(1, Math.max(0, (l.dist / Math.max(1, l.node.extent) - 1.1) / 1.4))
      const shown = inside > 0.05 && placeCluster(l, texts.current.get(l), o, m, flat)
      const emphasis = (s.hoveredCluster === null ? 0.86 : s.hoveredCluster === l.node.id ? 1 : 0.4) * lensDim
      const born = layout.timelineOn ? bornShare(u.uGalaxyBorn.value[l.node.index] ?? 1) : 1
      l.alpha = fade(l.alpha, shown && born > 0 ? inside * emphasis * reveal(l.order) * born : 0)
    }

    // System labels once a system spans enough of the screen, largest first, at most 25.
    const focusGalaxy = s.focusCluster ? (g.clusterById.get(s.focusCluster)?.level === 0 ? s.focusCluster : g.clusterById.get(s.focusCluster)?.parentId) : null
    const sized = bySize.current
    sized.length = 0
    for (const l of systems) {
      const born = layout.timelineOn ? (sceneBus.systemBorn[l.node.index] ?? 1) : 1
      l.key = labelsOn && born > 0.05 ? projectedRadius(l.node, flat, m, cam) : 0
      l.shown = hysteresis(l.shown, l.key, SYSTEM.onPx, SYSTEM.offPx)
      l.placed = false
      if (l.shown) sized.push(l)
    }
    sized.sort(byKeyDesc)
    let sysCount = 0
    for (const l of sized) {
      if (sysCount >= SYSTEM.maxShown) break
      if (placeCluster(l, texts.current.get(l), o, m, flat)) {
        l.placed = true
        sysCount++
      }
    }
    const systemReveal = reveal(macro.length)
    for (const l of systems) {
      const dim = focusGalaxy && l.node.parentId !== focusGalaxy ? 0.35 : 1
      const hot = s.hoveredCluster === l.node.id || s.focusCluster === l.node.id ? 1 : 0.8
      l.alpha = fade(l.alpha, l.placed ? dim * hot * lensDim * systemReveal : 0)
      if (!l.placed) l.slot = null
    }

    // Repo labels: re-rank at 10 Hz, place every frame so they track their stars. Sparse at the
    // overview, the full pool once zoomed in twofold from home.
    const home = sceneBus.homeDistance || 1.66 * g.radius
    const zoom = Math.min(1, Math.max(0.25, 0.3 * (home / Math.max(1, sceneBus.controls?.distance ?? 1)) ** 1.5))
    const want = !labelsOn || systemReveal < 1 ? 0 : Math.round((s.settings.labels === 'more' ? REPO.moreCount : REPO.autoCount) * zoom)
    const now = performance.now()
    if (now - repoState.lastPick > REPO.reselectMs) {
      repoState.lastPick = now
      if (want > 0) rankRepos(g, m, size, layout, forcedList, s.lens.state === 'ready' ? s.lens.weights : null, repoState.candidates)
      else repoState.candidates.length = 0
    } else if (!repoState.recheck) {
      // Under frameloop 'demand' the frame after the camera rests may be the last one; schedule
      // another so the ranking catches up with where it stopped.
      repoState.recheck = setTimeout(() => {
        repoState.recheck = 0
        sceneBus.invalidate()
      }, REPO.reselectMs)
    }
    for (const i of repoState.candidates) {
      if (repoPlaced.size >= want + forcedList.length) break
      if (!repoPlaced.has(i) && i !== s.hovered) placeRepo(i)
    }
    repoState.next = repoState.placed
    repoState.placed = repoPlaced
    writeRepoSlots(g, repoState, repoPlaced, screenOf, fade)

    // Apply cluster label transforms; scale holds a constant pixel size at the label's depth.
    const worldPerPx = (2 * Math.tan((cam.fov * Math.PI) / 360)) / size.height
    up.set(0, 1, 0).applyQuaternion(cam.quaternion)
    right.set(1, 0, 0).applyQuaternion(cam.quaternion)
    for (const l of all) {
      const group = groups.current.get(l)
      const text = texts.current.get(l)
      if (!group || !text) continue
      group.visible = l.alpha > 0.002
      text.fillOpacity = l.alpha
      text.outlineOpacity = l.alpha * 0.75
      if (!group.visible || l.slot === null) continue
      clusterAnchor(l.node, flat, anchor)
      const depth = Math.max(1, -viewPos.copy(anchor).applyMatrix4(cam.matrixWorldInverse).z)
      const unit = depth * worldPerPx
      const { w, h } = measure(l, text)
      const [dx, dy] = insetSlots(w, h, labelSlots)[l.slot]!
      // Slot offsets are top-left in screen pixels; the text is anchored at its centre.
      const cx = dx + w / 2
      const cy = dy + h / 2
      group.position.copy(anchor).addScaledVector(right, cx * unit).addScaledVector(up, -cy * unit)
      group.scale.setScalar(unit * l.px)
    }
    if (moving) sceneBus.invalidate()
  })

  const textFor = (l: ClusterLabel, macroTier: boolean) => (
    <Billboard key={l.node.id} ref={(gr) => void (gr ? groups.current.set(l, gr) : groups.current.delete(l))}>
      <Text
        ref={(t: unknown) => void (t ? texts.current.set(l, t as TextLike) : texts.current.delete(l))}
        font={LABEL_FONT}
        characters={CHARACTERS}
        fontSize={1}
        letterSpacing={macroTier ? 0.14 : 0.02}
        textAlign="center"
        lineHeight={1.2}
        anchorX="center"
        anchorY="middle"
        color={l.color}
        outlineWidth={macroTier ? '12%' : '14%'}
        outlineColor={sceneTheme.label.outline}
        outlineBlur="40%"
        fillOpacity={0}
        outlineOpacity={0}
        renderOrder={macroTier ? sceneTheme.label.galaxyOrder : sceneTheme.label.galaxyOrder - 1}
      >
        {l.text}
      </Text>
    </Billboard>
  )

  return (
    <>
      {macro.map((l) => textFor(l, true))}
      {systems.map((l) => textFor(l, false))}
    </>
  )
}

function clusterAnchor(c: ClusterNode, flat: number, out: Vector3) {
  return out.set(
    c.anchor[0] + (c.anchor2[0] - c.anchor[0]) * flat,
    c.anchor[1] + (c.anchor2[1] - c.anchor[1]) * flat,
    c.anchor[2] + (c.anchor2[2] - c.anchor[2]) * flat,
  )
}

/** Screen box of a cluster label, with a little side padding so neighbours never touch. */
function measure(l: ClusterLabel, text: TextLike | undefined) {
  const b = text?.textRenderInfo?.blockBounds
  const lines = l.text.includes('\n') ? 2 : 1
  const w = b ? (b[2] - b[0]) * l.px : (l.text.length / lines) * l.px * (l.node.level === 0 ? 0.86 : 0.56)
  dims.w = w + 12
  dims.h = (b ? b[3] - b[1] : 1.2 * lines) * l.px + l.px * 0.35
  return dims
}

function placeCluster(l: ClusterLabel, text: TextLike | undefined, occ: Occupancy, m: Projector, flat: number): boolean {
  clusterAnchor(l.node, flat, anchor)
  const p = projectPoint(m, anchor.x, anchor.y, anchor.z, screen)
  if (!p) {
    l.slot = null
    return false
  }
  const { w, h } = measure(l, text)
  box.x = p.x
  box.y = p.y
  box.w = w
  box.h = h
  box.slots = insetSlots(w, h, labelSlots)
  box.prev = l.slot
  box.ideal = true
  box.pad = 0
  box.maxDrift = MAX_DRIFT
  const slot = place(occ, box)
  l.slot = slot
  return slot !== null
}

function projectedRadius(c: ClusterNode, flat: number, m: Projector, cam: PerspectiveCamera) {
  clusterAnchor(c, flat, anchor)
  const p = projectPoint(m, anchor.x, anchor.y, anchor.z, screen)
  if (!p) return 0
  const focal = m.height / 2 / Math.tan((cam.fov * Math.PI) / 360)
  return (c.radius * focal) / Math.max(1, p.viewDist)
}

const estimateWidth = (fullName: string) => fullName.length * 6.65 + 2

/** Writes the best-scoring repo label candidates into `out`, best first. */
function rankRepos(
  g: GalaxyIndex,
  m: Projector,
  size: { width: number; height: number },
  layout: ReturnType<typeof currentLayout>,
  skip: number[],
  lens: Float32Array | null,
  out: number[],
) {
  const focus = sceneBus.pointer ?? { x: size.width / 2, y: size.height / 2 }
  let count = 0
  for (let i = 0; i < g.n; i++) {
    if ((sceneBus.dyn[i * 4] ?? 1) < 0.5 || skip.includes(i)) continue
    if (layout.timelineOn && bornAt(g.attrs, i, layout) < 0.5) continue
    const [x, y, z] = positionAt(g.attrs, i, layout, scratch)
    const p = projectPoint(m, x, y, z, screen)
    if (!p || p.x < 0 || p.y < 0 || p.x > size.width || p.y > size.height) continue
    const r = starPixelRadius(g.attrs.size[i]!, 0, 1, 1, p.viewDist, m.proj[5]!, size.height, sizes)
    if (r < REPO.minPx) continue
    const d = Math.hypot(p.x - focus.x, p.y - focus.y)
    const lit = (sceneBus.dyn[i * 4 + 2] ?? 1) * 0.75 + 0.25
    const heat = lens ? 0.05 + lens[i]! : 1
    const score = (g.attrs.bright[i]! * (0.35 + g.attrs.size[i]!) * r * lit * heat) / (1 + d / 220)
    if (count === TOP && score <= topScore[TOP - 1]!) continue
    // Insertion into a fixed top-K list, kept sorted best first.
    let at = count < TOP ? count++ : TOP - 1
    while (at > 0 && topScore[at - 1]! < score) {
      topScore[at] = topScore[at - 1]!
      topIdx[at] = topIdx[at - 1]!
      at--
    }
    topScore[at] = score
    topIdx[at] = i
  }
  out.length = count
  for (let q = 0; q < count; q++) out[q] = topIdx[q]!
}

function writeRepoSlots(
  g: GalaxyIndex,
  st: RepoState,
  placed: Map<number, number>,
  screenOf: (i: number) => ScreenPoint | null,
  fade: (cur: number, target: number) => number,
) {
  const slots = sceneBus.repoLabelSlots
  if (st.pool !== slots) {
    st.pool = slots
    st.slotOf.clear()
    st.starOf = []
    st.alpha = []
  }
  if (slots.length === 0) return
  // Keep a star in the slot it already owns, so its label fades rather than jumping between nodes.
  for (const [star, slot] of st.slotOf) {
    if (!placed.has(star) && (st.alpha[slot] ?? 0) <= 0.01) {
      st.slotOf.delete(star)
      st.starOf[slot] = null
    }
  }
  for (const star of placed.keys()) {
    if (st.slotOf.has(star)) continue
    let free = -1
    for (let k = 0; k < slots.length; k++) {
      if ((st.starOf[k] ?? null) === null) {
        free = k
        break
      }
    }
    if (free < 0) break
    st.slotOf.set(star, free)
    st.starOf[free] = star
    st.alpha[free] = 0
    const el = slots[free]!
    const name = g.repos[star]!.fullName
    const at = name.indexOf('/')
    el.children[0]!.textContent = name.slice(0, at + 1)
    el.children[1]!.textContent = name.slice(at + 1)
    st.width.set(star, el.offsetWidth || estimateWidth(name))
  }
  const projYY = sceneBus.camera!.projectionMatrix.elements[5]!
  for (let k = 0; k < slots.length; k++) {
    const el = slots[k]!
    const star = st.starOf[k] ?? null
    const target = star !== null && placed.has(star) ? 1 : 0
    const prev = st.alpha[k] ?? 0
    const alpha = fade(prev, target)
    st.alpha[k] = alpha
    if (alpha !== prev || el.style.opacity === '') el.style.opacity = String(alpha)
    if (star === null) continue
    const slot = placed.get(star)
    if (slot === undefined) continue
    const p = screenOf(star)
    if (!p) continue
    const w = st.width.get(star) ?? estimateWidth(g.repos[star]!.fullName)
    const r = Math.min(18, starPixelRadius(g.attrs.size[star]!, sceneBus.dyn[star * 4 + 1] ?? 0, 1, 1, p.viewDist, projYY, sceneBus.size.height, sizes))
    const [dx, dy] = starSlots(w, 16, r, repoSlots)[slot]!
    el.style.transform = `translate3d(${Math.round(p.x + dx)}px, ${Math.round(p.y + dy)}px, 0)`
  }
}

/** A cluster's name arrives with its first births and is fully lit once a quarter has been born. */
const bornShare = (share: number) => Math.min(1, share / 0.25)
