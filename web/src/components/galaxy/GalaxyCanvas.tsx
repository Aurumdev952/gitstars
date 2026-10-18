import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { useGalaxyStore } from '#/state/store'
import { Animator } from './Animator'
import { Backdrop } from './Backdrop'
import { CameraRig } from './CameraRig'
import { DebugHooks } from './DebugHooks'
import { Dust } from './Dust'
import { Effects } from './Effects'
import { Labels } from './labels/Labels'
import { NeighborArcs } from './NeighborArcs'
import { SceneTweens } from './SceneTweens'
import { Nebulae } from './Nebulae'
import { OverlayLayer } from './OverlayLayer'
import { PointerPicker } from './PointerPicker'
import { SceneDriver } from './SceneDriver'
import { Stars } from './Stars'

export default GalaxyCanvas

export function GalaxyCanvas({ debug }: { debug: boolean }) {
  const galaxy = useGalaxyStore((s) => s.galaxy)
  const still = useGalaxyStore((s) => s.frozen || s.settings.motion === 'reduced')
  // The list view covers the scene; it stays mounted so returning is instant, but draws nothing.
  const hidden = useGalaxyStore((s) => s.view === 'list')
  if (!galaxy) return null
  return (
    <Canvas
      aria-hidden
      className="!fixed inset-0"
      flat
      dpr={[1, 2]}
      frameloop={hidden ? 'never' : still ? 'demand' : 'always'}
      gl={{ antialias: false, powerPreference: 'high-performance', alpha: false }}
      camera={{ fov: 50, near: 0.5, far: 6000, position: [0, 80, 320] }}
    >
      <SceneDriver />
      <Backdrop />
      <Dust center={galaxy.center} />
      <Nebulae galaxy={galaxy} />
      <Stars galaxy={galaxy} />
      <NeighborArcs galaxy={galaxy} />
      <SceneTweens />
      <Animator />
      <CameraRig />
      <PointerPicker />
      <Effects />
      <OverlayLayer>
        <Suspense fallback={null}>
          <Labels galaxy={galaxy} />
        </Suspense>
      </OverlayLayer>
      {debug && <DebugHooks />}
    </Canvas>
  )
}
