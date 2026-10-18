import { Sphere, Vector3 } from 'three'
import { useGalaxyStore } from '#/state/store'
import { positionAt, RESTING_LAYOUT } from '#/lib/layout'
import { fitPoints, type Framing } from '#/lib/framing'
import type { GalaxyIndex } from '#/lib/load'
import { currentLayout, sceneBus } from './sceneBus'

// Camera choreography outside React. Every command supersedes the one before it: a running
// sequence checks `alive()` between awaited stages and stops when a newer command started.

const HOME_AZIMUTH = 0.62
const HOME_POLAR = 1.12
const LONG_FLIGHT = 150

let seq = 0
const v = new Vector3()
const PREVIEW_SMOOTH_TIME = 0.28

type SavedView = { position: Vector3; target: Vector3 }
let saved: SavedView | null = null
let previewing = false
/** smoothTime from before the first of a run of overlapping previews; restored once they settle. */
let previewBase: number | null = null
let previewSeq = 0

function endPreview() {
  previewing = false
  const c = sceneBus.controls
  if (c && previewBase !== null) c.smoothTime = previewBase
  previewBase = null
}

/** Frozen screenshots land instantly; reduced motion keeps short moves but drops warp. */
const animated = (requested: boolean) => requested && !useGalaxyStore.getState().frozen
const warpAllowed = () => useGalaxyStore.getState().settings.motion === 'full'

/** `to` shifted by whole turns to lie within half a turn of `from`, since autorotate winds the azimuth up without bound. */
function nearestAngle(from: number, to: number) {
  const turn = Math.PI * 2
  return to + turn * Math.round((from - to) / turn)
}

function begin() {
  const id = ++seq
  sceneBus.warpTarget = 0
  useGalaxyStore.getState().actions.setCameraBusy(true)
  const alive = () => id === seq
  const end = () => {
    if (alive()) useGalaxyStore.getState().actions.setCameraBusy(false)
  }
  return { alive, end }
}

/** Where stars will be once the intro lands: a flight started mid-spiral aims at the settled star. */
const landedLayout = () => ({ ...currentLayout(), intro: 1 })

function boundingSphere(indices: Iterable<number>, pad = 1.1, minRadius = 8, quantile = 0.95, layout = landedLayout()): Sphere | null {
  const g = useGalaxyStore.getState().galaxy
  if (!g) return null
  const pts: Vector3[] = []
  const p: [number, number, number] = [0, 0, 0]
  for (const i of indices) pts.push(new Vector3(...positionAt(g.attrs, i, layout, p)))
  if (pts.length === 0) return null
  const center = pts.reduce((c, q) => c.add(q), new Vector3()).divideScalar(pts.length)
  // A percentile radius so a stray outlier does not zoom the whole frame out.
  const d = pts.map((q) => q.distanceTo(center)).sort((a, b) => a - b)
  const r = d[Math.min(d.length - 1, Math.floor(d.length * quantile))]!
  return new Sphere(center, Math.max(minRadius, r * pad))
}

// The HUD's top bar and bottom row take this much of the viewport off the cloud.
const HOME_FILL = { x: 0.84, y: 0.74 }
let homeCache: { g: GalaxyIndex; aspect: number; fov: number; pose: Framing } | null = null

/** Where home puts the camera for the current viewport: the 3D cloud filling the free area. */
export function homePose(): (Framing & { azimuth: number; polar: number }) | null {
  const g = useGalaxyStore.getState().galaxy
  const cam = sceneBus.camera
  if (!g || !cam) return null
  const aspect = cam.aspect
  if (!homeCache || homeCache.g !== g || Math.abs(homeCache.aspect - aspect) > 1e-3 || homeCache.fov !== cam.fov) {
    const pose = fitPoints(g.attrs.pos, g.n, {
      azimuth: HOME_AZIMUTH,
      polar: HOME_POLAR,
      tanHalfFov: Math.tan((cam.fov * Math.PI) / 360),
      aspect,
      fill: HOME_FILL,
      quantile: 0.97,
    })
    homeCache = { g, aspect, fov: cam.fov, pose }
  }
  sceneBus.homeDistance = homeCache.pose.distance
  return { ...homeCache.pose, azimuth: HOME_AZIMUTH, polar: HOME_POLAR }
}

export type Director = typeof director

export const director = {
  async home(animate = true): Promise<void> {
    if (useGalaxyStore.getState().view === 'flat') return director.frameView(true, animate)
    const c = sceneBus.controls
    const pose = homePose()
    if (!c || !pose) return
    const { alive, end } = begin()
    const a = animated(animate)
    const [x, y, z] = pose.target
    await Promise.all([c.setTarget(x, y, z, a), c.rotateTo(nearestAngle(c.azimuthAngle, pose.azimuth), pose.polar, a), c.dollyTo(pose.distance, a)])
    if (alive()) end()
  },

  /** Frames the whole map for the layout being tweened to: top-down for flat, the home orbit for 3D. */
  async frameView(flat: boolean, animate = true): Promise<void> {
    const c = sceneBus.controls
    const g = useGalaxyStore.getState().galaxy
    if (!c || !g) return
    if (!flat) return director.home(animate)
    const { alive, end } = begin()
    const sphere = boundingSphere(g.repos.keys(), 0.92, 20, 0.99, { ...RESTING_LAYOUT, flat: 1 })
    if (!sphere) return end()
    const a = animated(animate)
    await Promise.all([c.rotateTo(nearestAngle(c.azimuthAngle, 0), Math.PI / 2, a), c.fitToSphere(sphere, a)])
    if (alive()) end()
  },

  async flyToRepo(i: number, animate = true) {
    const c = sceneBus.controls
    const g = useGalaxyStore.getState().galaxy
    if (!c || !g) return
    const { alive, end } = begin()
    const p = new Vector3(...positionAt(g.attrs, i, landedLayout(), [0, 0, 0]))
    const sphere = new Sphere(p, Math.max(12, 4 * g.d8[i]!))
    c.getTarget(v)
    const a = animated(animate)
    if (a && v.distanceTo(p) > LONG_FLIGHT) {
      if (warpAllowed()) sceneBus.warpTarget = 1
      await Promise.all([c.setTarget(p.x, p.y, p.z, true), c.dollyTo(c.distance * 1.2, true)])
      sceneBus.warpTarget = 0
      if (!alive()) return
    }
    await c.fitToSphere(sphere, a)
    end()
  },

  async frameIndices(indices: Iterable<number>, animate = true) {
    const c = sceneBus.controls
    if (!c) return
    const { end } = begin()
    const sphere = boundingSphere(indices)
    if (sphere) await c.fitToSphere(sphere, animated(animate))
    end()
  },

  /** A quick look at a star without selecting it (palette arrow keys). */
  async preview(i: number) {
    const c = sceneBus.controls
    if (!c) return
    previewing = true
    previewBase ??= c.smoothTime
    c.smoothTime = Math.min(previewBase, PREVIEW_SMOOTH_TIME)
    const id = ++previewSeq
    await director.flyToRepo(i)
    if (id === previewSeq && previewBase !== null) c.smoothTime = previewBase
  },

  /** Remembers the current view so a cancelled preview can return to it. */
  saveView() {
    const c = sceneBus.controls
    if (!c) return
    endPreview()
    saved = { position: c.getPosition(new Vector3()), target: c.getTarget(new Vector3()) }
  },

  async restoreView() {
    const c = sceneBus.controls
    const view = saved
    saved = null
    endPreview()
    if (!c || !view) return
    const { end } = begin()
    await c.setLookAt(view.position.x, view.position.y, view.position.z, view.target.x, view.target.y, view.target.z, animated(true))
    end()
  },

  forgetView() {
    saved = null
    endPreview()
  },

  /** True between a palette preview and the palette closing; hit framing waits meanwhile. */
  isPreviewing: () => previewing,

  async frameCluster(id: string, animate = true) {
    const node = useGalaxyStore.getState().galaxy?.clusterById.get(id)
    if (node) await director.frameIndices(node.members, animate)
  },
}
