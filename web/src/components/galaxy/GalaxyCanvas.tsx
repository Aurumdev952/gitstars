import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { useGalaxyStore } from '#/state/store'
import { Animator } from './Animator'
import { Backdrop } from './Backdrop'
import { CameraRig } from './CameraRig'
import { DebugHooks } from './DebugHooks'
import { Dust } from './Dust'
import { Effects } from './Effects'
import { MacroLabels } from './labels/MacroLabels'
import { Nebulae } from './Nebulae'
import { PointerPicker } from './PointerPicker'
import { SceneDriver } from './SceneDriver'
import { Stars } from './Stars'

export function GalaxyCanvas({ debug }: { debug: boolean }) {
  const galaxy = useGalaxyStore((s) => s.galaxy)
  const still = useGalaxyStore((s) => s.frozen || s.settings.motion === 'reduced')
  if (!galaxy) return null
  return (
    <Canvas
      aria-hidden
      className="!fixed inset-0"
      flat
      dpr={[1, 2]}
      frameloop={still ? 'demand' : 'always'}
      gl={{ antialias: false, powerPreference: 'high-performance', alpha: false }}
      camera={{ fov: 50, near: 0.5, far: 6000, position: [0, 80, 320] }}
    >
      <SceneDriver />
      <Backdrop />
      <Dust center={galaxy.center} />
      <Nebulae galaxy={galaxy} />
      <Stars galaxy={galaxy} />
      <Suspense fallback={null}>
        <MacroLabels galaxy={galaxy} />
      </Suspense>
      <Animator />
      <CameraRig />
      <PointerPicker />
      <Effects />
      {debug && <DebugHooks />}
    </Canvas>
  )
}
