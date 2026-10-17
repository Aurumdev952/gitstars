import { useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { PerspectiveCamera } from 'three'
import { useGalaxyStore } from '#/state/store'
import { sceneBus } from './sceneBus'

const FROZEN_TIME = 12

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
    u.uPixelRatio.value = state.viewport.dpr
    u.uViewport.value.set(state.size.width * state.viewport.dpr, state.size.height * state.viewport.dpr)
    sceneBus.size.width = state.size.width
    sceneBus.size.height = state.size.height
    state.camera.updateMatrixWorld()
    for (const hook of sceneBus.frameHooks) hook(dt)
  })

  return null
}
