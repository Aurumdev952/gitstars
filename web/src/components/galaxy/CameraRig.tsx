import { useEffect, useRef } from 'react'
import { CameraControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import CameraControlsImpl from 'camera-controls'
import type { PerspectiveCamera } from 'three'
import { useGalaxyStore } from '#/state/store'
import { cameraIntent, type CameraIntent, type NavState } from '#/lib/cameraIntent'
import { director } from './Director'
import { sceneBus } from './sceneBus'

// Mirrors RepoPanel: 420 px wide, inset 16 px from the viewport edge.
const PANEL_WIDTH = 420
const PANEL_MARGIN = 16
const MIN_FREE_WIDTH = 240
const SMOOTH_TIME = 0.55
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
    sceneBus.director = director
    c.maxDistance = galaxy.radius * 5
    const onStart = () => {
      lastInput.current = performance.now()
      useGalaxyStore.getState().actions.setDragging(true)
    }
    const onEnd = () => useGalaxyStore.getState().actions.setDragging(false)
    c.addEventListener('controlstart', onStart)
    c.addEventListener('controlend', onEnd)

    const follow = (intent: CameraIntent) => {
      if (intent?.kind === 'repo') void director.flyToRepo(intent.index)
      else if (intent?.kind === 'cluster') void director.frameCluster(intent.id)
      else if (intent?.kind === 'home') void director.home()
    }
    const { selected, focusCluster, hits } = useGalaxyStore.getState()
    void director.home(false).then(() => {
      const intent = cameraIntent({ selected: null, focusCluster: null }, { selected, focusCluster })
      // A deep-linked ?q= frames its hits once the camera exists.
      if (!intent && hits && hits.frame.length > 0) void director.frameIndices(hits.frame, false)
      else follow(intent)
    })

    const unsubNav = useGalaxyStore.subscribe(
      (s): NavState => ({ selected: s.selected, focusCluster: s.focusCluster }),
      (next, prev) => follow(cameraIntent(prev, next)),
      { equalityFn: (a, b) => a.selected === b.selected && a.focusCluster === b.focusCluster },
    )
    // A new query, or its semantic upgrade, frames the leading hits unless a palette preview is
    // showing a single star or a star is selected.
    const unsubHits = useGalaxyStore.subscribe(
      (s) => s.hits,
      (hits, prev) => {
        const s = useGalaxyStore.getState()
        if (!hits || hits.frame.length === 0 || s.selected !== null || director.isPreviewing()) return
        if (prev && prev.query === hits.query && prev.frame.join() === hits.frame.join()) return
        // Inside a focused cluster, frame only the hits that belong to it, and stay put if none do.
        const members = s.focusCluster ? new Set(s.galaxy?.clusterById.get(s.focusCluster)?.members) : null
        const frame = members ? hits.frame.filter((i) => members.has(i)) : hits.frame
        if (frame.length > 0) void director.frameIndices(frame)
      },
    )
    const applyView = (view: string, animate: boolean | null) => {
      const flat = view === 'flat'
      // Drop the whole turns autorotate wound up, so the flat lock at azimuth 0 turns less than half a turn.
      c.normalizeRotations()
      if (c.azimuthAngle > Math.PI) c.azimuthAngle -= Math.PI * 2
      const A = CameraControlsImpl.ACTION
      c.mouseButtons.left = flat ? A.TRUCK : A.ROTATE
      c.touches.one = flat ? A.TOUCH_TRUCK : A.TOUCH_ROTATE
      c.minPolarAngle = flat ? Math.PI / 2 : 0
      c.maxPolarAngle = flat ? Math.PI / 2 : Math.PI
      c.minAzimuthAngle = flat ? 0 : -Infinity
      c.maxAzimuthAngle = flat ? 0 : Infinity
      if (animate !== null) void director.frameView(flat, animate)
    }
    // List view hides the scene; returning to the layout it left needs no camera move.
    const initialView = useGalaxyStore.getState().view
    let lastSpatial = initialView === 'list' ? '3d' : initialView
    if (lastSpatial === 'flat') applyView('flat', false)
    const unsubView = useGalaxyStore.subscribe(
      (s) => s.view,
      (view) => {
        if (view === 'list') return
        const changed = view !== lastSpatial
        lastSpatial = view
        applyView(view, changed ? true : null)
      },
    )
    const unsubMotion = useGalaxyStore.subscribe(
      (s) => s.settings.motion,
      (motion) => (c.smoothTime = motion === 'reduced' ? 0.15 : SMOOTH_TIME),
      { fireImmediately: true },
    )
    return () => {
      c.removeEventListener('controlstart', onStart)
      c.removeEventListener('controlend', onEnd)
      unsubNav()
      unsubHits()
      unsubView()
      unsubMotion()
      sceneBus.controls = null
      sceneBus.director = null
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

  // Shift the projection centre into the area left of the detail panel, so a framed star sits in
  // the free space; picking reads camera.projectionMatrix and stays consistent. Priority -0.5 runs
  // after CameraControls (-1) and before DOM anchors project (0), so reticles never trail a frame.
  useFrame((state, dt) => {
    const s = useGalaxyStore.getState()
    const { width, height } = state.size
    const panel = Math.min(PANEL_WIDTH, width - PANEL_MARGIN * 2)
    const roomy = width - panel - PANEL_MARGIN * 2 >= MIN_FREE_WIDTH
    const panelOpen = (s.selected !== null || s.focusCluster !== null) && s.view !== 'list'
    const target = panelOpen && roomy ? (panel + PANEL_MARGIN) / 2 : 0
    if (Math.abs(target - offset.current) > 0.25) {
      offset.current += (target - offset.current) * (s.frozen ? 1 : 1 - Math.exp(-6 * dt))
      state.invalidate()
    } else offset.current = target
    if (offset.current === 0) {
      if (camera.view?.enabled) camera.clearViewOffset()
    } else camera.setViewOffset(width, height, offset.current, 0, width, height)
  }, -0.5)

  useFrame((_, dt) => {
    const s = useGalaxyStore.getState()
    const c = ref.current
    if (
      c &&
      !s.frozen &&
      s.settings.autorotate &&
      // Timeline playback turns the camera itself.
      !s.timeline.playing &&
      s.settings.motion === 'full' &&
      // The azimuth setter bypasses camera-controls' clamps, so it would tip the flat map edge-on.
      s.view === '3d' &&
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
      smoothTime={SMOOTH_TIME}
      draggingSmoothTime={0.12}
      dollyToCursor
      minDistance={2}
      dollySpeed={0.6}
    />
  )
}
