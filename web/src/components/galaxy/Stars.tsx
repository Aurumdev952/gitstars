import { useEffect, useMemo } from 'react'
import {
  AdditiveBlending,
  BufferAttribute,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  ShaderMaterial,
} from 'three'
import type { GalaxyIndex } from '#/lib/load'
import { shaders } from '#/shaders'
import { allocateDyn, sceneBus } from './sceneBus'

const QUAD = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0])
const QUAD_INDEX = [0, 1, 2, 0, 2, 3]

function buildStarGeometry(g: GalaxyIndex) {
  const geo = new InstancedBufferGeometry()
  geo.setAttribute('position', new BufferAttribute(QUAD, 3))
  geo.setIndex(QUAD_INDEX)
  geo.instanceCount = g.n
  const a = g.attrs
  const inst = (arr: Float32Array, size: number) => new InstancedBufferAttribute(arr, size)
  geo.setAttribute('aPos', inst(a.pos, 3))
  geo.setAttribute('aPos2', inst(a.pos2, 3))
  geo.setAttribute('aColor', inst(a.color, 3))
  geo.setAttribute('aSize', inst(a.size, 1))
  geo.setAttribute('aBright', inst(a.bright, 1))
  geo.setAttribute('aSeed', inst(a.seed, 1))
  geo.setAttribute('aStarred', inst(a.starred, 1))
  geo.setAttribute('aMeta', inst(a.meta, 4))
  geo.setAttribute('aDensity', inst(a.density, 1))
  allocateDyn(g.n)
  const dyn = inst(sceneBus.dyn, 4).setUsage(DynamicDrawUsage)
  geo.setAttribute('aDyn', dyn)
  sceneBus.dynAttr = dyn
  return geo
}

export function Stars({ galaxy }: { galaxy: GalaxyIndex }) {
  const geometry = useMemo(() => buildStarGeometry(galaxy), [galaxy])
  const material = useMemo(
    () =>
      new ShaderMaterial({
        ...shaders.star,
        uniforms: sceneBus.uniforms,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        toneMapped: false,
      }),
    [],
  )
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])
  return <mesh geometry={geometry} material={material} frustumCulled={false} raycast={() => null} renderOrder={10} />
}
