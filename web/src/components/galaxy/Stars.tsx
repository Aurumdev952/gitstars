import { useEffect, useLayoutEffect, useMemo } from 'react'
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
import { sceneBus } from './sceneBus'

const QUAD = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0])
const QUAD_INDEX = [0, 1, 2, 0, 2, 3]

function restingDyn(n: number) {
  const a = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) a.set([1, 0, 1, 0], i * 4)
  return a
}

/** Pure, so StrictMode's double-invoked memo cannot leave sceneBus pointing at a discarded copy. */
function buildStarBuffers(g: GalaxyIndex) {
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
  const dyn = restingDyn(g.n)
  const dynAttr = inst(dyn, 4).setUsage(DynamicDrawUsage)
  geo.setAttribute('aDyn', dynAttr)
  const lensAttr = inst(new Float32Array(g.n), 1).setUsage(DynamicDrawUsage)
  geo.setAttribute('aLens', lensAttr)
  return { geometry: geo, dyn, dynTarget: restingDyn(g.n), dynAttr, lensAttr }
}

export function Stars({ galaxy }: { galaxy: GalaxyIndex }) {
  const buffers = useMemo(() => buildStarBuffers(galaxy), [galaxy])
  const { geometry } = buffers
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
  useLayoutEffect(() => {
    sceneBus.dyn = buffers.dyn
    sceneBus.dynTarget = buffers.dynTarget
    sceneBus.dynAttr = buffers.dynAttr
    sceneBus.lensAttr = buffers.lensAttr
    sceneBus.dynVersion++
    sceneBus.invalidate()
    return () => {
      if (sceneBus.dynAttr === buffers.dynAttr) sceneBus.dynAttr = null
      if (sceneBus.lensAttr === buffers.lensAttr) sceneBus.lensAttr = null
      buffers.geometry.dispose()
    }
  }, [buffers])
  useEffect(() => () => material.dispose(), [material])
  return <mesh geometry={geometry} material={material} frustumCulled={false} raycast={() => null} renderOrder={10} />
}
