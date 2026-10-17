import { PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { RESTING_LAYOUT } from './layout'
import { pickStar, projectPoint, type Projector } from './picking'

const W = 800
const H = 600

function projectorAt(camPos: Vector3): Projector {
  const cam = new PerspectiveCamera(50, W / H, 0.1, 5000)
  cam.position.copy(camPos)
  cam.lookAt(0, 0, 0)
  cam.updateMatrixWorld()
  return { view: cam.matrixWorldInverse.elements, proj: cam.projectionMatrix.elements, width: W, height: H }
}

const attrs = {
  pos: new Float32Array([0, 0, 0, 10, 0, 0, -10, 0, 0]),
  pos2: new Float32Array(9),
  seed: new Float32Array(3),
  starred: new Float32Array([0.1, 0.5, 0.9]),
  size: new Float32Array([0.2, 0.9, 0.2]),
}
const dyn = new Float32Array([1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0])
const base = { attrs, n: 3, dyn, layout: RESTING_LAYOUT, sizes: { sizeScale: 1.25, minPx: 2.2, maxPx: 72 } }

describe('projectPoint', () => {
  it('puts the look-at point at the viewport centre and agrees with three', () => {
    const m = projectorAt(new Vector3(0, 0, 100))
    expect(projectPoint(m, 0, 0, 0)).toMatchObject({ x: W / 2, y: H / 2, viewDist: 100 })
    const cam = new PerspectiveCamera(50, W / H, 0.1, 5000)
    cam.position.set(0, 0, 100)
    cam.lookAt(0, 0, 0)
    cam.updateMatrixWorld()
    const v = new Vector3(10, 5, 0).project(cam)
    const s = projectPoint(m, 10, 5, 0)!
    expect(s.x).toBeCloseTo((v.x * 0.5 + 0.5) * W, 4)
    expect(s.y).toBeCloseTo((0.5 - v.y * 0.5) * H, 4)
  })

  it('returns null behind the camera', () => {
    expect(projectPoint(projectorAt(new Vector3(0, 0, 100)), 0, 0, 200)).toBeNull()
  })
})

describe('pickStar', () => {
  const projector = projectorAt(new Vector3(0, 0, 100))
  const at = (i: number) => projectPoint(projector, attrs.pos[i * 3]!, 0, 0)!

  it('picks the star under the pointer', () => {
    const p = at(1)
    expect(pickStar({ ...base, projector, x: p.x + 2, y: p.y - 2 })).toBe(1)
  })

  it('agrees between the resting fast path and the general layout path', () => {
    const layout = { ...RESTING_LAYOUT, timelineOn: true, timeline: 1, birthWindow: 0.01 }
    for (let i = 0; i < 3; i++) {
      const p = at(i)
      expect(pickStar({ ...base, layout, projector, x: p.x + 1, y: p.y })).toBe(pickStar({ ...base, projector, x: p.x + 1, y: p.y }))
    }
  })

  it('returns null over empty space', () => {
    expect(pickStar({ ...base, projector, x: 20, y: 20 })).toBeNull()
  })

  it('skips filtered-out stars and unborn stars', () => {
    const p = at(1)
    const hidden = dyn.slice()
    hidden[4] = 0
    expect(pickStar({ ...base, dyn: hidden, projector, x: p.x, y: p.y })).toBeNull()
    const q = at(2)
    const layout = { ...RESTING_LAYOUT, timelineOn: true, timeline: 0.5, birthWindow: 0.01 }
    expect(pickStar({ ...base, layout, projector, x: q.x, y: q.y })).toBeNull()
  })
})
