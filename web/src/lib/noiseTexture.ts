/** Tileable value-noise fbm in [0, 1], `size`² single-channel bytes. Sampled by the nebula shader instead of per-pixel simplex. */
export function tileableFbm(size = 256, octaves = 5, seed = 11): Uint8Array {
  const out = new Uint8Array(size * size)
  const acc = new Float32Array(size * size)
  let amp = 0.5
  let norm = 0
  for (let o = 0; o < octaves; o++) {
    const period = 4 << o
    const lattice = new Float32Array(period * period)
    let s = (seed + o * 7919) >>> 0
    for (let i = 0; i < lattice.length; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0
      lattice[i] = s / 4294967296
    }
    const at = (x: number, y: number) => lattice[(y % period) * period + (x % period)]!
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * period
      const y0 = Math.floor(fy)
      const ty = smooth(fy - y0)
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * period
        const x0 = Math.floor(fx)
        const tx = smooth(fx - x0)
        const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx
        const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx
        acc[y * size + x]! += (a + (b - a) * ty) * amp
      }
    }
    norm += amp
    amp *= 0.5
  }
  for (let i = 0; i < acc.length; i++) out[i] = Math.round((acc[i]! / norm) * 255)
  return out
}

const smooth = (t: number) => t * t * (3 - 2 * t)
