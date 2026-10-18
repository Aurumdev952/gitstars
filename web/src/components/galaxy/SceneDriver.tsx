import { useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { PerspectiveCamera } from 'three'
import { useGalaxyStore } from '#/state/store'
import { TIERS, effectiveTier } from '#/lib/quality'
import { sceneBus } from './sceneBus'

const FROZEN_TIME = 12
const BOKEH = 0.38

const prev = { x: 0, y: 0, z: 0, set: false }

/** Feeds time and viewport uniforms, publishes renderer refs, and runs DOM frame hooks. */
export function SceneDriver() {
  const { gl, camera, invalidate } = useThree()

  useEffect(() => {
    sceneBus.gl = gl
    sceneBus.camera = camera as PerspectiveCamera
    sceneBus.invalidate = invalidate
    return () => {
      sceneBus.gl = null
      sceneBus.camera = null
      sceneBus.invalidate = () => {}
    }
  }, [gl, camera, invalidate])

  useFrame((state, dt) => {
    const u = sceneBus.uniforms
    const s = useGalaxyStore.getState()
    const still = s.frozen || s.settings.motion === 'reduced'
    u.uTime.value = s.frozen ? FROZEN_TIME : u.uTime.value + dt
    u.uTwinkle.value = still ? 0 : 1
    u.uBirthPop.value = still ? 0 : 1

    // Camera velocity for warp streaks, smoothed so one uneven frame does not jolt them.
    const cp = state.camera.position
    if (prev.set && dt > 0) {
      const k = 1 - Math.exp(-14 * dt)
      const v = u.uCamVel.value
      v.x += ((cp.x - prev.x) / dt - v.x) * k
      v.y += ((cp.y - prev.y) / dt - v.y) * k
      v.z += ((cp.z - prev.z) / dt - v.z) * k
    }
    prev.x = cp.x
    prev.y = cp.y
    prev.z = cp.z
    prev.set = true
    const warpTarget = still ? 0 : sceneBus.warpTarget
    u.uWarp.value += (warpTarget - u.uWarp.value) * (s.frozen ? 1 : 1 - Math.exp(-5 * dt))
    if (Math.abs(u.uWarp.value - warpTarget) < 1e-3) u.uWarp.value = warpTarget
    else state.invalidate()

    // Depth of field only once the camera has come in close; the overview stays sharp.
    const c = sceneBus.controls
    const home = sceneBus.homeDistance || 1
    const focus = c ? c.distance : home
    u.uFocusDist.value = focus
    const zoomedIn = Math.min(1, Math.max(0, (0.75 - focus / home) / 0.4))
    // The intro starts close in; its burst would read as a screen of discs.
    const settled = s.intro === 'done' && TIERS[effectiveTier(s.settings.quality, s.autoTier)].bokeh ? 1 : 0
    u.uBokeh.value = BOKEH * settled * zoomedIn * zoomedIn * (3 - 2 * zoomedIn)
    u.uPixelRatio.value = state.viewport.dpr
    u.uViewport.value.x = state.size.width * state.viewport.dpr
    u.uViewport.value.y = state.size.height * state.viewport.dpr
    sceneBus.size.width = state.size.width
    sceneBus.size.height = state.size.height
    state.camera.updateMatrixWorld()
    for (const hook of sceneBus.frameHooks) hook(dt)
  })

  return null
}
