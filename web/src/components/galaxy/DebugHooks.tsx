import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Vector3, type Object3D, type Scene } from 'three'
import { useGalaxyStore } from '#/state/store'
import { director } from './Director'
import { pickAt } from './PointerPicker'
import { sceneBus, starScreenPosition } from './sceneBus'
import { probeSearch, timeQuery } from '#/workers/searchClient'
import { timeline } from '#/state/timeline'
import { sceneTheme } from '#/lib/theme'

type DebugApi = {
  ready: boolean
  intro: 'done'
  fps: number
  drawCalls: number
  triangles: number
  screenPos(fullName: string): { x: number; y: number } | null
  hover(i: number | null): void
  /** CPU pick at viewport coordinates, with its cost. */
  pick(x: number, y: number): { index: number | null; ms: number }
  select(fullName: string | null): void
  focus(id: string | null): void
  /** Renders continuously for `ms` and returns the measured frame rate. */
  measureFps(ms?: number): Promise<{ fps: number; frames: number; drawCalls: number }>
  /**
   * Every visible cluster label with its screen rect and how well it reads as its own cluster's:
   * `share` is the fraction of stars under the rect (16 px apron) that belong to that cluster.
   */
  labels(): LabelReport[]
  /** overlap@10 of the browser model against meta.searchProbes. */
  probe: typeof probeSearch
  timeQuery: typeof timeQuery
  store: typeof useGalaxyStore
  director: typeof director
  timeline: typeof timeline
  bus: typeof sceneBus
  scene: Scene
}

type LabelReport = {
  name: string
  tier: 'galaxy' | 'system'
  rect: { x0: number; y0: number; x1: number; y1: number }
  share: number
  /** The cluster owning most stars under the rect; null when none are. */
  owner: string | null
  /** Pixels from the rect to the cluster's projected label anchor; 0 when the rect covers it. */
  drift: number
}

declare global {
  interface Window {
    __gitstars?: DebugApi
  }
}

type TroikaText = Object3D & { text?: string; fillOpacity?: number; textRenderInfo?: { blockBounds: [number, number, number, number] } | null }

function labelReport(canvas: DOMRect): LabelReport[] {
  const g = useGalaxyStore.getState().galaxy
  const cam = sceneBus.camera
  if (!g || !cam || !sceneBus.overlay) return []
  const key = (t: string) => t.replace(/\n/g, ' ').toUpperCase()
  const byName = { galaxy: new Map(g.galaxies.map((c) => [key(c.name), c])), system: new Map(g.systems.map((c) => [key(c.name), c])) }
  const stars: { x: number; y: number; galaxy: number; system: number }[] = []
  for (let i = 0; i < g.n; i++) {
    const p = starScreenPosition(g, i)
    if (p) stars.push({ x: p.x, y: p.y, galaxy: g.galaxyOf[i]!, system: g.systemOf[i]! })
  }
  const toScreen = (o: Object3D, x: number, y: number) => {
    const v = o.localToWorld(new Vector3(x, y, 0)).project(cam)
    return [((v.x + 1) / 2) * canvas.width, ((1 - v.y) / 2) * canvas.height] as const
  }
  const out: LabelReport[] = []
  sceneBus.overlay.traverse((o: TroikaText) => {
    const b = o.textRenderInfo?.blockBounds
    if (typeof o.text !== 'string' || !b || !o.parent?.visible || (o.fillOpacity ?? 0) < 0.05) return
    const tier = o.renderOrder === sceneTheme.label.galaxyOrder ? 'galaxy' : 'system'
    const node = byName[tier].get(key(o.text))
    if (!node) return
    const [ax, ay] = toScreen(o, b[0], b[1])
    const [bx, by] = toScreen(o, b[2], b[3])
    const rect = { x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) }
    const flat = sceneBus.uniforms.uFlat.value
    const a = new Vector3(...node.anchor).lerp(new Vector3(...node.anchor2), flat).project(cam)
    const ax0 = ((a.x + 1) / 2) * canvas.width
    const ay0 = ((1 - a.y) / 2) * canvas.height
    const drift = Math.hypot(Math.max(rect.x0 - ax0, 0, ax0 - rect.x1), Math.max(rect.y0 - ay0, 0, ay0 - rect.y1))
    const counts = new Map<number, number>()
    let total = 0
    for (const s of stars) {
      if (Math.hypot(Math.max(rect.x0 - s.x, 0, s.x - rect.x1), Math.max(rect.y0 - s.y, 0, s.y - rect.y1)) > 16) continue
      const id = tier === 'galaxy' ? s.galaxy : s.system
      counts.set(id, (counts.get(id) ?? 0) + 1)
      total++
    }
    let owner: number | null = null
    for (const [id, n] of counts) if (owner === null || n > counts.get(owner)!) owner = id
    const list = tier === 'galaxy' ? g.galaxies : g.systems
    out.push({ name: node.name, tier, rect, share: total ? (counts.get(node.index) ?? 0) / total : 0, owner: owner === null ? null : list[owner]!.name, drift })
  })
  return out
}

/** Installs window.__gitstars; mounted inside the Canvas only when ?debug is set. */
export function DebugHooks() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const invalidate = useThree((s) => s.invalidate)
  const frames = useRef({ count: 0, ema: 0 })

  useEffect(() => {
    gl.info.autoReset = false
    const api: DebugApi = {
      ready: false,
      intro: 'done',
      fps: 0,
      drawCalls: 0,
      triangles: 0,
      screenPos(fullName) {
        const g = useGalaxyStore.getState().galaxy
        const i = g?.byFullName.get(fullName.toLowerCase())
        if (!g || i === undefined) return null
        const p = starScreenPosition(g, i)
        if (!p) return null
        const r = gl.domElement.getBoundingClientRect()
        return { x: p.x + r.left, y: p.y + r.top }
      },
      hover: (i) => useGalaxyStore.getState().actions.hover(i),
      pick(x, y) {
        const r = gl.domElement.getBoundingClientRect()
        const t = performance.now()
        const index = pickAt(x - r.left, y - r.top)
        return { index, ms: performance.now() - t }
      },
      select(fullName) {
        const s = useGalaxyStore.getState()
        const i = fullName === null ? null : s.galaxy?.byFullName.get(fullName.toLowerCase()) ?? null
        s.actions.select(i)
      },
      focus: (id) => useGalaxyStore.getState().actions.focus(id),
      async measureFps(ms = 3000) {
        const start = performance.now()
        const startCount = frames.current.count
        await new Promise<void>((resolve) => {
          const tick = () => {
            invalidate()
            if (performance.now() - start < ms) requestAnimationFrame(tick)
            else resolve()
          }
          tick()
        })
        const n = frames.current.count - startCount
        return { fps: (n * 1000) / (performance.now() - start), frames: n, drawCalls: api.drawCalls }
      },
      labels: () => labelReport(gl.domElement.getBoundingClientRect()),
      probe: probeSearch,
      timeQuery,
      store: useGalaxyStore,
      director,
      timeline,
      bus: sceneBus,
      scene,
    }
    window.__gitstars = api
    return () => {
      gl.info.autoReset = true
      delete window.__gitstars
    }
  }, [gl, scene, invalidate])

  // Runs after the composer (1) and the overlay (2), so info covers every pass of the frame.
  useFrame((_, dt) => {
    const api = window.__gitstars
    frames.current.count++
    if (dt > 0) frames.current.ema = frames.current.ema ? frames.current.ema * 0.9 + (1 / dt) * 0.1 : 1 / dt
    if (api) {
      api.fps = Math.round(frames.current.ema)
      api.drawCalls = gl.info.render.calls
      api.triangles = gl.info.render.triangles
      api.ready = useGalaxyStore.getState().galaxy !== null && frames.current.count > 2 && !useGalaxyStore.getState().cameraBusy
    }
    gl.info.reset()
  }, 3)

  return null
}
