import { useEffect, useMemo } from 'react'
import { BackSide, ShaderMaterial, Vector3 } from 'three'
import { sceneTheme } from '#/lib/theme'
import { shaders } from '#/shaders'

export function Backdrop() {
  const material = useMemo(() => {
    const b = sceneTheme.backdrop
    return new ShaderMaterial({
      ...shaders.backdrop,
      uniforms: {
        uZenith: { value: new Vector3(...b.zenith) },
        uHorizon: { value: new Vector3(...b.horizon) },
        uBand: { value: new Vector3(...b.band) },
        uBandWarm: { value: new Vector3(...b.bandWarm) },
        uBandNormal: { value: new Vector3(0.28, 0.86, -0.42).normalize() },
        uOpacity: { value: 1 },
      },
      side: BackSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
  }, [])
  useEffect(() => () => material.dispose(), [material])
  return (
    <mesh material={material} frustumCulled={false} renderOrder={-100} raycast={() => null}>
      <sphereGeometry args={[1, 96, 48]} />
    </mesh>
  )
}
