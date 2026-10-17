import type { Camera, InstancedBufferAttribute, PerspectiveCamera, WebGLRenderer } from 'three'
import type CameraControlsImpl from 'camera-controls'
import { createSceneUniforms } from '#/shaders'
import type { LayoutUniforms } from '#/lib/layout'
import { positionAt } from '#/lib/layout'
import { projectPoint, type Projector, type ScreenPoint } from '#/lib/picking'
import type { GalaxyIndex } from '#/lib/load'

type FrameHook = (dt: number) => void

/**
 * Non-reactive scene refs shared by the canvas and the DOM HUD. React never re-renders from these;
 * components mutate uniforms and buffers through here, and DOM overlays project through it.
 */
export const sceneBus = {
  uniforms: createSceneUniforms(),
  /** aDyn per star (vis, highlight, focus, pulse), and the Animator's targets. */
  dyn: new Float32Array(0),
  dynTarget: new Float32Array(0),
  dynAttr: null as InstancedBufferAttribute | null,
  controls: null as CameraControlsImpl | null,
  camera: null as PerspectiveCamera | null,
  gl: null as WebGLRenderer | null,
  size: { width: 1, height: 1 },
  invalidate: () => {},
  /** Called once per rendered frame after the camera updates; DOM anchors write their transforms here. */
  frameHooks: new Set<FrameHook>(),
}

export function allocateDyn(n: number) {
  sceneBus.dyn = new Float32Array(n * 4)
  sceneBus.dynTarget = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) {
    sceneBus.dyn.set([1, 0, 1, 0], i * 4)
    sceneBus.dynTarget.set([1, 0, 1, 0], i * 4)
  }
}

export function currentLayout(): LayoutUniforms {
  const u = sceneBus.uniforms
  return {
    flat: u.uFlat.value,
    intro: u.uIntro.value,
    introOrigin: [u.uIntroOrigin.value.x, u.uIntroOrigin.value.y, u.uIntroOrigin.value.z],
    timeline: u.uTimeline.value,
    timelineOn: u.uTimelineOn.value > 0.5,
    birthWindow: u.uBirthWindow.value,
  }
}

export function currentProjector(camera: Camera | null = sceneBus.camera): Projector | null {
  if (!camera) return null
  return {
    view: camera.matrixWorldInverse.elements,
    proj: camera.projectionMatrix.elements,
    width: sceneBus.size.width,
    height: sceneBus.size.height,
  }
}

const scratch: [number, number, number] = [0, 0, 0]

export function starScreenPosition(g: GalaxyIndex, i: number): ScreenPoint | null {
  const m = currentProjector()
  if (!m) return null
  const [x, y, z] = positionAt(g.attrs, i, currentLayout(), scratch)
  return projectPoint(m, x, y, z)
}

export function onFrame(hook: FrameHook) {
  sceneBus.frameHooks.add(hook)
  return () => void sceneBus.frameHooks.delete(hook)
}
