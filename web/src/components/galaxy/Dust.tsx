import { useEffect, useMemo } from 'react'
import { AdditiveBlending, BufferAttribute, BufferGeometry, ShaderMaterial } from 'three'
import { shaders } from '#/shaders'
import { mulberry32 } from '#/lib/random'
import { sceneBus } from './sceneBus'

// Three far shells give parallax against the backdrop; a sparse inner cloud of motes gives the
// galaxy region itself depth when orbiting. All in one draw.
const SHELLS = [
  { radius: 700, count: 2400, size: 1.3, alpha: 0.5 },
  { radius: 1100, count: 2000, size: 1.15, alpha: 0.4 },
  { radius: 1600, count: 1600, size: 1.0, alpha: 0.32 },
] as const
const MOTES = { count: 1600, inner: 20, outer: 320, size: 1.1, alpha: 0.11 }
const TINTS = [
  [0.62, 0.68, 1.0],
  [0.85, 0.86, 1.0],
  [1.0, 0.86, 0.7],
  [0.75, 0.62, 1.0],
] as const

function buildDust(center: readonly number[]) {
  const rand = mulberry32(1337)
  const total = SHELLS.reduce((s, x) => s + x.count, 0) + MOTES.count
  const pos = new Float32Array(total * 3)
  const tint = new Float32Array(total * 3)
  const size = new Float32Array(total)
  const seed = new Float32Array(total)
  let k = 0
  const push = (r: number, s: number, alpha: number) => {
    const u = rand() * 2 - 1
    const t = rand() * Math.PI * 2
    const q = Math.sqrt(1 - u * u)
    pos.set([center[0]! + r * q * Math.cos(t), center[1]! + r * u, center[2]! + r * q * Math.sin(t)], k * 3)
    const c = TINTS[Math.floor(rand() * TINTS.length)]!
    const a = alpha * (0.35 + 0.65 * rand() ** 2)
    tint.set([c[0] * a, c[1] * a, c[2] * a], k * 3)
    size[k] = s * (0.7 + 0.6 * rand())
    seed[k] = rand()
    k++
  }
  for (const sh of SHELLS) for (let i = 0; i < sh.count; i++) push(sh.radius * (0.9 + 0.2 * rand()), sh.size, sh.alpha)
  for (let i = 0; i < MOTES.count; i++) {
    push(MOTES.inner + (MOTES.outer - MOTES.inner) * Math.cbrt(rand()), MOTES.size, MOTES.alpha)
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(pos, 3))
  geo.setAttribute('aTint', new BufferAttribute(tint, 3))
  geo.setAttribute('aSize', new BufferAttribute(size, 1))
  geo.setAttribute('aSeed', new BufferAttribute(seed, 1))
  return geo
}

export function Dust({ center }: { center: readonly [number, number, number] }) {
  const geometry = useMemo(() => buildDust(center), [center])
  const material = useMemo(
    () =>
      new ShaderMaterial({
        ...shaders.dust,
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
  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={-50} raycast={() => null} />
}
