import { useEffect, useRef } from 'react'
import { CameraControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import type CameraControlsImpl from 'camera-controls'
import type { PerspectiveCamera } from 'three'
import { useGalaxyStore } from '#/state/store'
import { director } from './Director'
import { sceneBus } from './sceneBus'

const PANEL_WIDTH = 420
const IDLE_MS = 8000
const AUTOROTATE_RAD_PER_S = 0.04

/** Camera controls, the right-panel view offset, idle autorotate, and URL-driven camera moves. */
export function CameraRig() {
  const ref = useRef<CameraControlsImpl>(null)
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const galaxy = useGalaxyStore((s) => s.galaxy)
  const lastInput = useRef(performance.now())
  const offset = useRef(0)

  useEffect(() => {
    const c = ref.current
    if (!c || !galaxy) return
    sceneBus.controls = c
    c.maxDistance = galaxy.radius * 5
    const onStart = () => {
      lastInput.current = performance.now()
      useGalaxyStore.getState().actions.setDragging(true)
    }
    const onEnd = () => useGalaxyStore.getState().actions.setDragging(false)
    c.addEventListener('controlstart', onStart)
    c.addEventListener('controlend', onEnd)

    const { selected, focusCluster } = useGalaxyStore.getState()
    void director.home(false).then(() => {
      if (selected !== null) void director.flyToRepo(selected)
      else if (focusCluster) void director.frameCluster(focusCluster)
    })

    const unsubSelected = useGalaxyStore.subscribe(
      (s) => s.selected,
      (i) => {
        if (i !== null) void director.flyToRepo(i)
      },
    )
    const unsubCluster = useGalaxyStore.subscribe(
      (s) => s.focusCluster,
      (id) => {
        if (id && useGalaxyStore.getState().selected === null) void director.frameCluster(id)
      },
    )
    return () => {
      c.removeEventListener('controlstart', onStart)
      c.removeEventListener('controlend', onEnd)
      unsubSelected()
      unsubCluster()
      sceneBus.controls = null
    }
  }, [galaxy])

  useEffect(() => {
    const bump = () => (lastInput.current = performance.now())
    window.addEventListener('pointerdown', bump)
    window.addEventListener('wheel', bump, { passive: true })
    window.addEventListener('keydown', bump)
    return () => {
      window.removeEventListener('pointerdown', bump)
      window.removeEventListener('wheel', bump)
      window.removeEventListener('keydown', bump)
    }
  }, [])

  useFrame((state, dt) => {
    const s = useGalaxyStore.getState()
    const c = ref.current

    // Shift the projection centre into the area left of the detail panel, so a framed star sits
    // in the free space; picking reads camera.projectionMatrix and stays consistent.
    const { width, height } = state.size
    const target = s.selected !== null && width > 900 ? PANEL_WIDTH / 2 : 0
    if (Math.abs(target - offset.current) > 0.25) {
      offset.current += (target - offset.current) * (s.frozen ? 1 : 1 - Math.exp(-6 * dt))
      state.invalidate()
    } else offset.current = target
    if (offset.current === 0) {
      if (camera.view?.enabled) camera.clearViewOffset()
    } else camera.setViewOffset(width, height, offset.current, 0, width, height)

    if (
      c &&
      !s.frozen &&
      s.settings.autorotate &&
      s.settings.motion === 'full' &&
      !s.cameraBusy &&
      !s.dragging &&
      performance.now() - lastInput.current > IDLE_MS
    ) {
      c.azimuthAngle += AUTOROTATE_RAD_PER_S * dt
    }
  })

  return (
    <CameraControls
      ref={ref}
      makeDefault
      smoothTime={0.55}
      draggingSmoothTime={0.12}
      dollyToCursor
      minDistance={2}
      dollySpeed={0.6}
    />
  )
}
