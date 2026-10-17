import { useEffect, useMemo } from 'react'
import {
  AdditiveBlending,
  BufferAttribute,
  DataTexture,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  RedFormat,
  RepeatWrapping,
  ShaderMaterial,
} from 'three'
import type { GalaxyIndex } from '#/lib/load'
import { tileableFbm } from '#/lib/noiseTexture'
import { shaders } from '#/shaders'
import { sceneBus } from './sceneBus'

const PER_GALAXY = 40
const QUAD = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0])

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Sprites anchored on random members, so clouds follow each galaxy's density and its layout transitions. */
function buildNebulae(g: GalaxyIndex) {
  const rand = mulberry32(42)
  const anchors: { member: number; galaxy: number }[] = []
  for (const gal of g.galaxies) {
    const count = Math.min(PER_GALAXY, Math.max(8, Math.round(gal.members.length * 0.6)))
    for (let k = 0; k < count; k++) anchors.push({ member: gal.members[Math.floor(rand() * gal.members.length)]!, galaxy: gal.index })
  }
  const n = anchors.length
  const pos = new Float32Array(n * 3)
  const pos2 = new Float32Array(n * 3)
  const color = new Float32Array(n * 3)
  const seed = new Float32Array(n)
  const scale = new Float32Array(n)
  const cluster = new Float32Array(n)
  anchors.forEach(({ member, galaxy }, k) => {
    pos.set(g.attrs.pos.subarray(member * 3, member * 3 + 3), k * 3)
    pos2.set(g.attrs.pos2.subarray(member * 3, member * 3 + 3), k * 3)
    const sys = g.systems[g.systemOf[member]!]
    const c = sys?.color.star ?? g.galaxies[galaxy]!.color.star
    const tint = 0.7 + 0.3 * rand()
    color.set([c[0] * tint, c[1] * tint, c[2] * tint], k * 3)
    seed[k] = rand()
    const r = sys?.radius ?? g.galaxies[galaxy]!.radius * 0.5
    scale[k] = Math.min(42, Math.max(7, r * (0.55 + 0.6 * rand())))
    cluster[k] = galaxy
  })
  const geo = new InstancedBufferGeometry()
  geo.setAttribute('position', new BufferAttribute(QUAD, 3))
  geo.setIndex([0, 1, 2, 0, 2, 3])
  geo.instanceCount = n
  geo.setAttribute('aPos', new InstancedBufferAttribute(pos, 3))
  geo.setAttribute('aPos2', new InstancedBufferAttribute(pos2, 3))
  geo.setAttribute('aColor', new InstancedBufferAttribute(color, 3))
  geo.setAttribute('aSeed', new InstancedBufferAttribute(seed, 1))
  geo.setAttribute('aScale', new InstancedBufferAttribute(scale, 1))
  geo.setAttribute('aCluster', new InstancedBufferAttribute(cluster, 1))
  return geo
}

export function Nebulae({ galaxy }: { galaxy: GalaxyIndex }) {
  const geometry = useMemo(() => buildNebulae(galaxy), [galaxy])
  const material = useMemo(() => {
    const size = 256
    const noise = new DataTexture(tileableFbm(size), size, size, RedFormat)
    noise.wrapS = noise.wrapT = RepeatWrapping
    noise.magFilter = noise.minFilter = LinearFilter
    noise.needsUpdate = true
    return new ShaderMaterial({
      ...shaders.nebula,
      uniforms: {
        ...sceneBus.uniforms,
        uNoise: { value: noise },
        uFocusCluster: { value: -1 },
        uFocusAmt: { value: 0 },
        uNebula: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
      toneMapped: false,
    })
  }, [])
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(
    () => () => {
      material.uniforms.uNoise!.value.dispose()
      material.dispose()
    },
    [material],
  )
  return <mesh geometry={geometry} material={material} frustumCulled={false} raycast={() => null} renderOrder={0} />
}
