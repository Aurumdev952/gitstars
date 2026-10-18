import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Bloom, ChromaticAberration, EffectComposer, Noise, ToneMapping, Vignette } from '@react-three/postprocessing'
import { BlendFunction, KernelSize, ToneMappingMode, type ChromaticAberrationEffect } from 'postprocessing'
import { HalfFloatType, Vector2 } from 'three'
import { sceneTheme } from '#/lib/theme'
import { TIERS, effectiveTier } from '#/lib/quality'
import { useGalaxyStore } from '#/state/store'
import { sceneBus } from './sceneBus'

const CA_BASE = 0.00045
const CA_WARP = 0.0032

export function Effects() {
  const { bloom, vignette, noise } = sceneTheme
  const tier = useGalaxyStore((s) => TIERS[effectiveTier(s.settings.quality, s.autoTier)])
  const still = useGalaxyStore((s) => s.frozen || s.settings.motion === 'reduced')
  const ca = useRef<ChromaticAberrationEffect>(null)
  const offset = useRef(new Vector2(CA_BASE, CA_BASE))

  useFrame(() => {
    const e = ca.current
    if (!e) return
    const k = CA_BASE + (CA_WARP - CA_BASE) * sceneBus.uniforms.uWarp.value
    e.offset.set(k, k)
  })

  const showCa = tier.chromaticAberration && !still
  return (
    <EffectComposer frameBufferType={HalfFloatType} multisampling={0} enableNormalPass={false}>
      <Bloom
        // Remounted per tier: the mip chain is sized when the effect is created.
        key={tier.bloomLevels}
        mipmapBlur
        luminanceThreshold={bloom.threshold}
        luminanceSmoothing={bloom.smoothing}
        intensity={bloom.intensity}
        radius={bloom.radius}
        levels={tier.bloomLevels}
        kernelSize={KernelSize.LARGE}
      />
      {showCa && <ChromaticAberration ref={ca} offset={offset.current} radialModulation modulationOffset={0.35} />}
      <Vignette offset={vignette.offset} darkness={vignette.darkness} />
      {tier.noise && !still && <Noise opacity={noise} premultiply blendFunction={BlendFunction.SCREEN} />}
      <ToneMapping mode={ToneMappingMode.AGX} />
    </EffectComposer>
  )
}
