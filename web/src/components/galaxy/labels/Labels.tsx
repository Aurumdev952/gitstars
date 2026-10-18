import { useMemo, useRef } from 'react'
import { Billboard, Text } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Color, LinearSRGBColorSpace, Vector3, type Group, type PerspectiveCamera } from 'three'
import type { ClusterNode, GalaxyIndex } from '#/lib/load'
import { sceneTheme } from '#/lib/theme'
import { Occupancy, clusterSlots, hysteresis, place, starSlots, type LabelBox } from '#/lib/labelLayout'
import { positionAt, starPixelRadius } from '#/lib/layout'
import { projectPoint } from '#/lib/picking'
import { useGalaxyStore } from '#/state/store'
import { currentLayout, currentProjector, sceneBus } from '../sceneBus'

const LABEL_FONT = '/fonts/Geist-Medium.woff'
const CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789&-.,:/+ \'’()'
const RETICLE = 24
const FADE_RATE = 10
const SYSTEM = { maxShown: 25, onPx: 130, offPx: 105 }
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
  alpha: number
}

const scratch: [number, number, number] = [0, 0, 0]
const anchor = new Vector3()
const viewPos = new Vector3()
const up = new Vector3()
const right = new Vector3()

function inkTint([r, g, b]: readonly number[], white: number) {
  return new Color().setRGB(white + r! * (1 - white), white + g! * (1 - white), white + b! * (1 - white), LinearSRGBColorSpace)
}

/**
 * Every label tier in one ordered screen-space pass, so no two labels overlap: HUD panels and
 * reticles claim space first, then the selected star's neighbours, galaxy labels, system labels at
 * mid zoom, and finally a pool of repo labels ranked by brightness, size and nearness to the cursor.
 */
export function Labels({ galaxy }: { galaxy: GalaxyIndex }) {
  const macro = useMemo<ClusterLabel[]>(
    () =>
      galaxy.galaxies.map((node) => ({
        node,
        text: node.name.toUpperCase(),
        color: inkTint(node.color.linear, 0.62),
        px: sceneTheme.label.macroPx,
        slot: null,
        shown: false,
        alpha: 0,
      })),
    [galaxy],
  )
  const systems = useMemo<ClusterLabel[]>(
    () =>
      galaxy.systems.map((node) => ({
        node,
        text: node.name,
        color: inkTint(node.color.linear, 0.45),
        px: sceneTheme.label.systemPx,
        slot: null,
        shown: false,
        alpha: 0,
      })),
    [galaxy],
  )
  const groups = useRef<Map<ClusterLabel, Group>>(new Map())
  const texts = useRef<Map<ClusterLabel, TextLike>>(new Map())
  const repo = useRef({
    lastPick: 0,
    candidates: [] as number[],
    slotOf: new Map<number, number>(),
    starOf: [] as (number | null)[],
    alpha: [] as number[],
    placed: new Map<number, number>(),
    width: new Map<number, number>(),
  })

  useFrame(({ camera, size }, dt) => {
    const cam = camera as PerspectiveCamera
    const s = useGalaxyStore.getState()
    const g = s.galaxy
    const m = currentProjector(cam)
    if (!g || g !== galaxy || !m) return
    const layout = currentLayout()
    const flat = layout.flat
    const occ = new Occupancy(size.width, size.height)
    const k = s.frozen ? 1 : 1 - Math.exp(-FADE_RATE * Math.min(dt, 0.1))
    let moving = false
    const fade = (cur: number, target: number) => {
      const next = Math.abs(target - cur) < 0.01 ? target : cur + (target - cur) * k
      if (next !== target) moving = true
      return next
    }

    for (const read of sceneBus.occluders) {
      const r = read()
      if (r) occ.add({ x0: r.left, y0: r.top, x1: r.right, y1: r.bottom })
    }
    const screenOf = (i: number) => {
      const [x, y, z] = positionAt(g.attrs, i, layout, scratch)
      return projectPoint(m, x, y, z)
    }
    for (const i of [s.selected, s.hovered]) {
      if (i === null) continue
      const p = screenOf(i)
      if (p) occ.add({ x0: p.x - RETICLE, y0: p.y - RETICLE, x1: p.x + RETICLE, y1: p.y + RETICLE })
    }

    const labelsOn = s.settings.labels !== 'none'
    const repoState = repo.current
    const forced: number[] = []
    if (labelsOn && s.selected !== null) for (const [j] of g.repos[s.selected]!.neighbors) forced.push(j)
    const repoPlaced = new Map<number, number>()
    const placeRepo = (i: number) => {
      if (s.filtered && !s.filtered.visible[i]) return
      const p = screenOf(i)
      if (!p) return
      const w = repoState.width.get(i) ?? estimateWidth(g.repos[i]!.fullName)
      const r = starPixelRadius(g.attrs.size[i]!, sceneBus.dyn[i * 4 + 1] ?? 0, 1, 1, p.viewDist, m.proj[5]!, size.height, uniformsSizes())
      const box: LabelBox = { x: p.x, y: p.y, w, h: 16, slots: starSlots(w, 16, Math.min(r, 18)), prev: repoState.placed.get(i) ?? null, pad: 2 }
      const slot = place(occ, box, 4)
      if (slot !== null) repoPlaced.set(i, slot)
    }
    forced.forEach(placeRepo)

    // Cluster names step back under the lens so the heat map carries the view.
    const lensDim = s.lens.state === 'ready' ? 0.5 : 1

    // Galaxy labels, nearest first. They fade once the camera is inside the galaxy.
    const order = macro
      .map((l) => ({ l, d: cam.position.distanceTo(clusterAnchor(l.node, flat, anchor)) }))
      .sort((a, b) => a.d - b.d)
    for (const { l, d } of order) {
      const inside = Math.min(1, Math.max(0, (d / Math.max(1, l.node.radius) - 1.1) / 1.4))
      const shown = inside > 0.05 && placeCluster(l, texts.current.get(l), occ, m, flat)
      const emphasis = (s.hoveredCluster === null ? 0.86 : s.hoveredCluster === l.node.id ? 1 : 0.4) * lensDim
      l.alpha = fade(l.alpha, shown ? inside * emphasis : 0)
    }

    // System labels once a system spans enough of the screen, largest first, at most 25.
    const focusGalaxy = s.focusCluster ? (g.clusterById.get(s.focusCluster)?.level === 0 ? s.focusCluster : g.clusterById.get(s.focusCluster)?.parentId) : null
    const sized: { l: ClusterLabel; px: number }[] = []
    for (const l of systems) {
      const px = labelsOn ? projectedRadius(l.node, flat, m, cam) : 0
      l.shown = hysteresis(l.shown, px, SYSTEM.onPx, SYSTEM.offPx)
      if (l.shown) sized.push({ l, px })
    }
    sized.sort((a, b) => b.px - a.px)
    const sysShown = new Set<ClusterLabel>()
    for (const { l } of sized) {
      if (sysShown.size >= SYSTEM.maxShown) break
      if (placeCluster(l, texts.current.get(l), occ, m, flat)) sysShown.add(l)
    }
    for (const l of systems) {
      const dim = focusGalaxy && l.node.parentId !== focusGalaxy ? 0.35 : 1
      const hot = s.hoveredCluster === l.node.id || s.focusCluster === l.node.id ? 1 : 0.8
      l.alpha = fade(l.alpha, sysShown.has(l) ? dim * hot * lensDim : 0)
      if (!sysShown.has(l)) l.slot = null
    }

    // Repo labels: re-rank at 10 Hz, place every frame so they track their stars. Sparse at the
    // overview (home sits about 1.66 radii out), the full pool once zoomed in twofold.
    const zoom = Math.min(1, Math.max(0.25, 0.3 * ((1.66 * g.radius) / Math.max(1, sceneBus.controls?.distance ?? 1)) ** 1.5))
    const want = !labelsOn ? 0 : Math.round((s.settings.labels === 'more' ? REPO.moreCount : REPO.autoCount) * zoom)
    const now = performance.now()
    if (now - repoState.lastPick > REPO.reselectMs) {
      repoState.lastPick = now
      repoState.candidates = want > 0 ? rankRepos(g, m, size, layout, forced, s.lens.state === 'ready' ? s.lens.weights : null) : []
    }
    for (const i of repoState.candidates) {
      if (repoPlaced.size >= want + forced.length) break
      if (!repoPlaced.has(i) && i !== s.hovered) placeRepo(i)
    }
    repoState.placed = repoPlaced
    writeRepoSlots(g, repoState, repoPlaced, screenOf, fade)

    // Apply cluster label transforms; scale holds a constant pixel size at the label's depth.
    const worldPerPx = (2 * Math.tan((cam.fov * Math.PI) / 360)) / size.height
    up.set(0, 1, 0).applyQuaternion(cam.quaternion)
    right.set(1, 0, 0).applyQuaternion(cam.quaternion)
    for (const l of [...macro, ...systems]) {
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
      const [dx, dy] = clusterSlots(w, h)[l.slot]!
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
        letterSpacing={macroTier ? 0.2 : 0.02}
        anchorX="center"
        anchorY="middle"
        color={l.color}
        outlineWidth={macroTier ? '12%' : '14%'}
        outlineColor={sceneTheme.label.outline}
        outlineBlur="40%"
        fillOpacity={0}
        outlineOpacity={0}
        renderOrder={macroTier ? 21 : 20}
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
    c.centroid[0] + (c.centroid2[0] - c.centroid[0]) * flat,
    c.centroid[1] + (c.centroid2[1] - c.centroid[1]) * flat,
    c.centroid[2] + (c.centroid2[2] - c.centroid[2]) * flat,
  )
}

/** Screen box of a cluster label, with a little side padding so neighbours never touch. */
function measure(l: ClusterLabel, text: TextLike | undefined) {
  const b = text?.textRenderInfo?.blockBounds
  const w = b ? (b[2] - b[0]) * l.px : l.text.length * l.px * (l.node.level === 0 ? 0.86 : 0.56)
  return { w: w + 12, h: l.px * 1.35 }
}

function placeCluster(l: ClusterLabel, text: TextLike | undefined, occ: Occupancy, m: NonNullable<ReturnType<typeof currentProjector>>, flat: number): boolean {
  clusterAnchor(l.node, flat, anchor)
  const p = projectPoint(m, anchor.x, anchor.y, anchor.z)
  if (!p) {
    l.slot = null
    return false
  }
  const { w, h } = measure(l, text)
  const slot = place(occ, { x: p.x, y: p.y, w, h, slots: clusterSlots(w, h), prev: l.slot })
  l.slot = slot
  return slot !== null
}

function projectedRadius(c: ClusterNode, flat: number, m: NonNullable<ReturnType<typeof currentProjector>>, cam: PerspectiveCamera) {
  clusterAnchor(c, flat, anchor)
  const p = projectPoint(m, anchor.x, anchor.y, anchor.z)
  if (!p) return 0
  const focal = (m.height / 2) / Math.tan((cam.fov * Math.PI) / 360)
  return (c.radius * focal) / Math.max(1, p.viewDist)
}

function uniformsSizes() {
  const u = sceneBus.uniforms
  return { sizeScale: u.uSizeScale.value, minPx: u.uMinPx.value, maxPx: u.uMaxPx.value }
}

const estimateWidth = (fullName: string) => fullName.length * 6.65 + 2

function rankRepos(
  g: GalaxyIndex,
  m: NonNullable<ReturnType<typeof currentProjector>>,
  size: { width: number; height: number },
  layout: ReturnType<typeof currentLayout>,
  skip: number[],
  lens: Float32Array | null,
): number[] {
  const focus = sceneBus.pointer ?? { x: size.width / 2, y: size.height / 2 }
  const skipSet = new Set(skip)
  const sizes = uniformsSizes()
  const best: [number, number][] = []
  for (let i = 0; i < g.n; i++) {
    if (skipSet.has(i) || (sceneBus.dyn[i * 4] ?? 1) < 0.5) continue
    const [x, y, z] = positionAt(g.attrs, i, layout, scratch)
    const p = projectPoint(m, x, y, z)
    if (!p || p.x < 0 || p.y < 0 || p.x > size.width || p.y > size.height) continue
    const r = starPixelRadius(g.attrs.size[i]!, 0, 1, 1, p.viewDist, m.proj[5]!, size.height, sizes)
    if (r < REPO.minPx) continue
    const d = Math.hypot(p.x - focus.x, p.y - focus.y)
    const lit = (sceneBus.dyn[i * 4 + 2] ?? 1) * 0.75 + 0.25
    const heat = lens ? 0.05 + lens[i]! : 1
    const score = (g.attrs.bright[i]! * (0.35 + g.attrs.size[i]!) * r * lit * heat) / (1 + d / 220)
    best.push([i, score])
  }
  best.sort((a, b) => b[1] - a[1])
  return best.slice(0, REPO.candidates).map(([i]) => i)
}

function writeRepoSlots(
  g: GalaxyIndex,
  st: { slotOf: Map<number, number>; starOf: (number | null)[]; alpha: number[]; width: Map<number, number> },
  placed: Map<number, number>,
  screenOf: (i: number) => ReturnType<typeof projectPoint>,
  fade: (cur: number, target: number) => number,
) {
  const slots = sceneBus.repoLabelSlots
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
    const free = slots.findIndex((_, k) => (st.starOf[k] ?? null) === null)
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
  slots.forEach((el, k) => {
    const star = st.starOf[k] ?? null
    const target = star !== null && placed.has(star) ? 1 : 0
    st.alpha[k] = fade(st.alpha[k] ?? 0, target)
    el.style.opacity = String(st.alpha[k])
    if (star === null) return
    const p = screenOf(star)
    const slot = placed.get(star)
    if (!p || slot === undefined) return
    const w = st.width.get(star) ?? estimateWidth(g.repos[star]!.fullName)
    const r = Math.min(18, starPixelRadius(g.attrs.size[star]!, sceneBus.dyn[star * 4 + 1] ?? 0, 1, 1, p.viewDist, sceneBus.camera!.projectionMatrix.elements[5]!, sceneBus.size.height, uniformsSizes()))
    const [dx, dy] = starSlots(w, 16, r)[slot]!
    el.style.transform = `translate3d(${Math.round(p.x + dx)}px, ${Math.round(p.y + dy)}px, 0)`
  })
}
