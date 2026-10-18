import { Sphere, Vector3 } from 'three'
import { useGalaxyStore } from '#/state/store'
import { positionAt, RESTING_LAYOUT } from '#/lib/layout'
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

/** Frozen screenshots land instantly; reduced motion keeps short moves but drops warp. */
const animated = (requested: boolean) => requested && !useGalaxyStore.getState().frozen
const warpAllowed = () => useGalaxyStore.getState().settings.motion === 'full'

function begin() {
  const id = ++seq
  useGalaxyStore.getState().actions.setCameraBusy(true)
  const alive = () => id === seq
  const end = () => {
    if (alive()) useGalaxyStore.getState().actions.setCameraBusy(false)
  }
  return { alive, end }
}

function boundingSphere(indices: Iterable<number>, pad = 1.1, minRadius = 8, quantile = 0.95, layout = currentLayout()): Sphere | null {
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

export type Director = typeof director

export const director = {
  async home(animate = true) {
    const c = sceneBus.controls
    const g = useGalaxyStore.getState().galaxy
    if (!c || !g) return
    const { alive, end } = begin()
    const sphere = boundingSphere(g.repos.keys(), 1, 20, 0.99)
    if (!sphere) return end()
    const a = animated(animate)
    await Promise.all([c.rotateTo(HOME_AZIMUTH, HOME_POLAR, a), c.fitToSphere(sphere, a)])
    if (alive()) end()
  },

  /** Frames the whole map for the layout being tweened to: top-down for flat, the home orbit for 3D. */
  async frameView(flat: boolean, animate = true) {
    const c = sceneBus.controls
    const g = useGalaxyStore.getState().galaxy
    if (!c || !g) return
    if (!flat) return director.home(animate)
    const { alive, end } = begin()
    const sphere = boundingSphere(g.repos.keys(), 0.92, 20, 0.99, { ...RESTING_LAYOUT, flat: 1 })
    if (!sphere) return end()
    const a = animated(animate)
    await Promise.all([c.rotateTo(0, Math.PI / 2, a), c.fitToSphere(sphere, a)])
    if (alive()) end()
  },

  async flyToRepo(i: number, animate = true) {
    const c = sceneBus.controls
    const g = useGalaxyStore.getState().galaxy
    if (!c || !g) return
    const { alive, end } = begin()
    const p = new Vector3(...positionAt(g.attrs, i, currentLayout(), [0, 0, 0]))
    const sphere = new Sphere(p, Math.max(12, 4 * g.d8[i]!))
    c.getTarget(v)
    const a = animated(animate)
    if (a && v.distanceTo(p) > LONG_FLIGHT) {
      if (warpAllowed()) sceneBus.uniforms.uWarp.value = 1
      await Promise.all([c.setTarget(p.x, p.y, p.z, true), c.dollyTo(c.distance * 1.2, true)])
      sceneBus.uniforms.uWarp.value = 0
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
    const smooth = c.smoothTime
    c.smoothTime = Math.min(smooth, PREVIEW_SMOOTH_TIME)
    await director.flyToRepo(i)
    c.smoothTime = smooth
  },

  /** Remembers the current view so a cancelled preview can return to it. */
  saveView() {
    const c = sceneBus.controls
    if (!c) return
    previewing = false
    saved = { position: c.getPosition(new Vector3()), target: c.getTarget(new Vector3()) }
  },

  async restoreView() {
    const c = sceneBus.controls
    const view = saved
    saved = null
    previewing = false
    if (!c || !view) return
    const { end } = begin()
    await c.setLookAt(view.position.x, view.position.y, view.position.z, view.target.x, view.target.y, view.target.z, animated(true))
    end()
  },

  forgetView() {
    saved = null
    previewing = false
  },

  /** True between a palette preview and the palette closing; hit framing waits meanwhile. */
  isPreviewing: () => previewing,

  async frameCluster(id: string, animate = true) {
    const node = useGalaxyStore.getState().galaxy?.clusterById.get(id)
    if (node) await director.frameIndices(node.members, animate)
  },
}
