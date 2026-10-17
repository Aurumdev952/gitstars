import { Bloom, EffectComposer, Noise, ToneMapping, Vignette } from '@react-three/postprocessing'
import { BlendFunction, KernelSize, ToneMappingMode } from 'postprocessing'
import { HalfFloatType } from 'three'
import { sceneTheme } from '#/lib/theme'

export function Effects() {
  const { bloom, vignette, noise } = sceneTheme
  return (
    <EffectComposer frameBufferType={HalfFloatType} multisampling={0} enableNormalPass={false}>
      <Bloom
        mipmapBlur
        luminanceThreshold={bloom.threshold}
        luminanceSmoothing={bloom.smoothing}
        intensity={bloom.intensity}
        radius={bloom.radius}
        levels={bloom.levels}
        kernelSize={KernelSize.LARGE}
      />
      <Vignette offset={vignette.offset} darkness={vignette.darkness} />
      <Noise opacity={noise} premultiply blendFunction={BlendFunction.SCREEN} />
      <ToneMapping mode={ToneMappingMode.AGX} />
    </EffectComposer>
  )
}
