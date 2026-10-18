import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { Scene } from 'three'
import { useGalaxyStore } from '#/state/store'
import { director } from './Director'
import { pickAt } from './PointerPicker'
import { sceneBus, starScreenPosition } from './sceneBus'
import { probeSearch, timeQuery } from '#/workers/searchClient'

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
  /** overlap@10 of the browser model against meta.searchProbes. */
  probe: typeof probeSearch
  timeQuery: typeof timeQuery
  store: typeof useGalaxyStore
  director: typeof director
  bus: typeof sceneBus
  scene: Scene
}

declare global {
  interface Window {
    __gitstars?: DebugApi
  }
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
      probe: probeSearch,
      timeQuery,
      store: useGalaxyStore,
      director,
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
