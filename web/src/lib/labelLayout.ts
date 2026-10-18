export type Rect = { x0: number; y0: number; x1: number; y1: number }

const CELL = 64

/**
 * Screen-space occupancy: a bucket grid of placed rects, so each collision test stays local. It is
 * rebuilt every frame, so `reset` keeps the buckets and rect objects for reuse instead of
 * reallocating them.
 */
export class Occupancy {
  private cells = new Map<number, Rect[]>()
  private pool: Rect[] = []
  count = 0

  constructor(
    public width: number,
    public height: number,
  ) {}

  reset(width: number, height: number) {
    this.width = width
    this.height = height
    this.count = 0
    for (const bucket of this.cells.values()) bucket.length = 0
  }

  /** Claims a copy of `r`; the caller may reuse `r` afterwards. */
  add(r: Rect) {
    const own = (this.pool[this.count] ??= { x0: 0, y0: 0, x1: 0, y1: 0 })
    own.x0 = r.x0
    own.y0 = r.y0
    own.x1 = r.x1
    own.y1 = r.y1
    this.count++
    const cx0 = Math.floor(Math.max(0, r.x0) / CELL)
    const cy0 = Math.floor(Math.max(0, r.y0) / CELL)
    const cx1 = Math.floor(Math.min(this.width, r.x1) / CELL)
    const cy1 = Math.floor(Math.min(this.height, r.y1) / CELL)
    for (let cx = cx0; cx <= cx1; cx++)
      for (let cy = cy0; cy <= cy1; cy++) {
        const k = cx * 4096 + cy
        const bucket = this.cells.get(k)
        if (bucket) bucket.push(own)
        else this.cells.set(k, [own])
      }
  }

  hits(r: Rect): boolean {
    const cx0 = Math.floor(Math.max(0, r.x0) / CELL)
    const cy0 = Math.floor(Math.max(0, r.y0) / CELL)
    const cx1 = Math.floor(Math.min(this.width, r.x1) / CELL)
    const cy1 = Math.floor(Math.min(this.height, r.y1) / CELL)
    for (let cx = cx0; cx <= cx1; cx++)
      for (let cy = cy0; cy <= cy1; cy++) {
        const bucket = this.cells.get(cx * 4096 + cy)
        if (!bucket) continue
        for (const o of bucket) if (r.x0 < o.x1 && o.x0 < r.x1 && r.y0 < o.y1 && o.y0 < r.y1) return true
      }
    return false
  }

  inside(r: Rect, margin: number): boolean {
    return r.x0 >= margin && r.y0 >= margin && r.x1 <= this.width - margin && r.y1 <= this.height - margin
  }
}

export type Slot = [number, number]

export type LabelBox = {
  /** Anchor in screen pixels. */
  x: number
  y: number
  w: number
  h: number
  /** Top-left corner offsets from the anchor, in preference order. */
  slots: readonly (readonly [number, number])[]
  /** The slot used last frame; tried first so settled labels do not hop. */
  prev: number | null
  /** Extra clearance kept around the label, in pixels. */
  pad?: number
  /**
   * The farthest the label's rect may sit from its anchor, in pixels. A label with no free slot
   * this close hides: a name that wanders off reads as belonging to whatever it lands on.
   */
  maxDrift?: number
  /** Slot 0 is where the label belongs; see `place`. */
  ideal?: boolean
}

/** Pixel distance from (x, y) to the nearest point of `r`; 0 when the point is inside. */
export function rectDistance(r: Rect, x: number, y: number): number {
  const dx = Math.max(r.x0 - x, 0, x - r.x1)
  const dy = Math.max(r.y0 - y, 0, y - r.y1)
  return Math.hypot(dx, dy)
}

export function rectAt(b: LabelBox, slot: number, out: Rect = { x0: 0, y0: 0, x1: 0, y1: 0 }): Rect {
  const [dx, dy] = b.slots[slot]!
  const pad = b.pad ?? 0
  const x0 = b.x + dx
  const y0 = b.y + dy
  out.x0 = x0 - pad
  out.y0 = y0 - pad
  out.x1 = x0 + b.w + pad
  out.y1 = y0 + b.h + pad
  return out
}

const probe: Rect = { x0: 0, y0: 0, x1: 0, y1: 0 }

function tryPlace(occ: Occupancy, b: LabelBox, s: number, margin: number) {
  rectAt(b, s, probe)
  if (b.maxDrift !== undefined && rectDistance(probe, b.x, b.y) > b.maxDrift + (b.pad ?? 0)) return false
  if (!occ.inside(probe, margin) || occ.hits(probe)) return false
  occ.add(probe)
  return true
}

/**
 * Places `b` in the first free slot (the previous one first), claims it, and returns the slot, or
 * null when every slot collides or leaves the viewport. With `ideal`, a free slot 0 beats the
 * previous slot, so a label that fell back when crowded returns once the crowd moves on.
 */
export function place(occ: Occupancy, b: LabelBox, margin = 6): number | null {
  const prev = b.prev !== null && b.prev < b.slots.length ? b.prev : -1
  if (b.ideal && prev !== 0 && tryPlace(occ, b, 0, margin)) return 0
  if (prev >= 0 && tryPlace(occ, b, prev, margin)) return prev
  for (let s = 0; s < b.slots.length; s++) if (s !== prev && tryPlace(occ, b, s, margin)) return s
  return null
}

const slotArray = (n: number): Slot[] => Array.from({ length: n }, (): Slot => [0, 0])

function setSlot(out: Slot[], k: number, x: number, y: number) {
  out[k]![0] = x
  out[k]![1] = y
}

/**
 * For a name set on its cluster's anchor: centred on it, then nudged up, down, left and right while
 * still covering it, then just clear of it above and below, and last with a corner 4 px off it.
 */
export function insetSlots(w: number, h: number, out: Slot[] = slotArray(11)): Slot[] {
  setSlot(out, 0, -w / 2, -h / 2)
  setSlot(out, 1, -w / 2, -h * 0.9)
  setSlot(out, 2, -w / 2, -h * 0.1)
  setSlot(out, 3, -w * 0.7, -h / 2)
  setSlot(out, 4, -w * 0.3, -h / 2)
  setSlot(out, 5, -w / 2, -h - 4)
  setSlot(out, 6, -w / 2, 4)
  setSlot(out, 7, 4, -h - 4)
  setSlot(out, 8, -w - 4, -h - 4)
  setSlot(out, 9, 4, 4)
  setSlot(out, 10, -w - 4, 4)
  return out
}

/**
 * Breaks a long name onto two lines at the space nearest its middle, so a forty-character galaxy
 * name stays about as wide as the galaxy instead of spanning its neighbours.
 */
export function balancedSplit(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const mid = text.length / 2
  let best = -1
  for (let k = 0; k < text.length; k++) if (text[k] === ' ' && (best < 0 || Math.abs(k - mid) < Math.abs(best - mid))) best = k
  return best < 0 ? text : `${text.slice(0, best)}\n${text.slice(best + 1)}`
}

/** Right of the star, then left, above and below, clear of a sprite of radius `r`. */
export function starSlots(w: number, h: number, r: number, out: Slot[] = slotArray(4)): Slot[] {
  const gap = r + 5
  setSlot(out, 0, gap, -h / 2)
  setSlot(out, 1, -w - gap, -h / 2)
  setSlot(out, 2, -w / 2, -h - gap)
  setSlot(out, 3, -w / 2, gap)
  return out
}

/** Shows past `on`, hides below `off` (off < on), so a label hovering at the threshold does not flicker. */
export function hysteresis(wasShown: boolean, value: number, on: number, off: number): boolean {
  return wasShown ? value >= off : value >= on
}

export type Vec3 = [number, number, number]

/** Candidate starts tried by `densityPeak`; enough to find the densest lobe of a 500-star galaxy. */
const PEAK_CANDIDATES = 256

/**
 * Where a cluster's name belongs: its densest region under a Gaussian kernel of `bandwidth`. It
 * starts from the member with the highest kernel density and refines by mean shift. The mean of a
 * crescent or two-lobed cluster can fall in the gap between its lobes, and mean shift started there
 * sits still on the saddle, so the start is a star, never the mean.
 */
export function densityPeak(points: ArrayLike<number>, members: readonly number[], bandwidth: number, iterations = 16): Vec3 {
  const p: Vec3 = [0, 0, 0]
  if (members.length === 0) return p
  const inv = 1 / (2 * Math.max(1e-6, bandwidth) ** 2)
  const stride = Math.max(1, Math.ceil(members.length / PEAK_CANDIDATES))
  let best = -1
  for (let c = 0; c < members.length; c += stride) {
    const o = members[c]! * 3
    let density = 0
    for (const m of members)
      density += Math.exp(-((points[m * 3]! - points[o]!) ** 2 + (points[m * 3 + 1]! - points[o + 1]!) ** 2 + (points[m * 3 + 2]! - points[o + 2]!) ** 2) * inv)
    if (density > best) {
      best = density
      p[0] = points[o]!
      p[1] = points[o + 1]!
      p[2] = points[o + 2]!
    }
  }
  for (let it = 0; it < iterations; it++) {
    let sx = 0
    let sy = 0
    let sz = 0
    let sw = 0
    for (const m of members) {
      const x = points[m * 3]!
      const y = points[m * 3 + 1]!
      const z = points[m * 3 + 2]!
      const w = Math.exp(-((x - p[0]) ** 2 + (y - p[1]) ** 2 + (z - p[2]) ** 2) * inv)
      sx += w * x
      sy += w * y
      sz += w * z
      sw += w
    }
    if (sw < 1e-12) break
    const step = Math.hypot(sx / sw - p[0], sy / sw - p[1], sz / sw - p[2])
    p[0] = sx / sw
    p[1] = sy / sw
    p[2] = sz / sw
    if (step < bandwidth * 1e-3) break
  }
  return p
}
