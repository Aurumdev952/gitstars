export type Rect = { x0: number; y0: number; x1: number; y1: number }

const CELL = 64

/** Screen-space occupancy: a bucket grid of placed rects, so each collision test stays local. */
export class Occupancy {
  private cells = new Map<number, Rect[]>()
  count = 0

  constructor(readonly width: number, readonly height: number) {}

  private *keys(r: Rect) {
    const cx0 = Math.floor(Math.max(0, r.x0) / CELL)
    const cy0 = Math.floor(Math.max(0, r.y0) / CELL)
    const cx1 = Math.floor(Math.min(this.width, r.x1) / CELL)
    const cy1 = Math.floor(Math.min(this.height, r.y1) / CELL)
    for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) yield cx * 4096 + cy
  }

  add(r: Rect) {
    this.count++
    for (const k of this.keys(r)) {
      const bucket = this.cells.get(k)
      if (bucket) bucket.push(r)
      else this.cells.set(k, [r])
    }
  }

  hits(r: Rect): boolean {
    for (const k of this.keys(r)) {
      for (const o of this.cells.get(k) ?? []) if (r.x0 < o.x1 && o.x0 < r.x1 && r.y0 < o.y1 && o.y0 < r.y1) return true
    }
    return false
  }

  inside(r: Rect, margin: number): boolean {
    return r.x0 >= margin && r.y0 >= margin && r.x1 <= this.width - margin && r.y1 <= this.height - margin
  }
}

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
}

export function rectAt(b: LabelBox, slot: number): Rect {
  const [dx, dy] = b.slots[slot]!
  const pad = b.pad ?? 0
  const x0 = b.x + dx
  const y0 = b.y + dy
  return { x0: x0 - pad, y0: y0 - pad, x1: x0 + b.w + pad, y1: y0 + b.h + pad }
}

/**
 * Places `b` in the first free slot (the previous one first), claims it, and returns the slot, or
 * null when every slot collides or leaves the viewport.
 */
export function place(occ: Occupancy, b: LabelBox, margin = 6): number | null {
  const order = b.prev !== null && b.prev < b.slots.length ? [b.prev, ...b.slots.keys()] : b.slots.keys()
  for (const s of order) {
    const r = rectAt(b, s)
    if (!occ.inside(r, margin) || occ.hits(r)) continue
    occ.add(r)
    return s
  }
  return null
}

/** Centred above, then below, right, left, and further out: for labels on a cluster centre. */
export function clusterSlots(w: number, h: number): [number, number][] {
  return [
    [-w / 2, -h],
    [-w / 2, 4],
    [10, -h / 2],
    [-w - 10, -h / 2],
    [-w / 2, -2.2 * h],
    [-w / 2, 1.3 * h],
  ]
}

/** Right of the star, then left, above and below, clear of a sprite of radius `r`. */
export function starSlots(w: number, h: number, r: number): [number, number][] {
  const gap = r + 5
  return [
    [gap, -h / 2],
    [-w - gap, -h / 2],
    [-w / 2, -h - gap],
    [-w / 2, gap],
  ]
}

/** Shows past `on`, hides below `off` (off < on), so a label hovering at the threshold does not flicker. */
export function hysteresis(wasShown: boolean, value: number, on: number, off: number): boolean {
  return wasShown ? value >= off : value >= on
}
