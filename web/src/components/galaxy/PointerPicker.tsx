import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { useGalaxyStore } from '#/state/store'
import { pickStar } from '#/lib/picking'
import { currentLayout, currentProjector, sceneBus } from './sceneBus'

const CLICK_SLOP_PX = 4

export function pickAt(x: number, y: number): number | null {
  const s = useGalaxyStore.getState()
  const projector = currentProjector()
  if (!s.galaxy || !projector || sceneBus.dyn.length !== s.galaxy.n * 4) return null
  const u = sceneBus.uniforms
  return pickStar({
    attrs: s.galaxy.attrs,
    n: s.galaxy.n,
    dyn: sceneBus.dyn,
    layout: currentLayout(),
    sizes: { sizeScale: u.uSizeScale.value, minPx: u.uMinPx.value, maxPx: u.uMaxPx.value },
    projector,
    x,
    y,
  })
}

/** CPU screen-space picking: hover on pointermove (one pick per frame at most), select on click. */
export function PointerPicker() {
  const el = useThree((s) => s.gl.domElement)

  useEffect(() => {
    let raf = 0
    let last: { x: number; y: number } | null = null
    let down: { x: number; y: number } | null = null
    const { actions } = useGalaxyStore.getState()
    const local = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const hoverNow = () => {
      raf = 0
      if (!last || down || useGalaxyStore.getState().dragging) return
      const i = pickAt(last.x, last.y)
      actions.hover(i)
      el.style.cursor = i === null ? '' : 'pointer'
    }
    const onMove = (e: PointerEvent) => {
      last = local(e)
      sceneBus.pointer = last
      // Repo labels gather around the cursor, which needs frames under frameloop 'demand'.
      sceneBus.invalidate()
      if (!raf) raf = requestAnimationFrame(hoverNow)
    }
    const onLeave = () => {
      last = null
      sceneBus.pointer = null
      actions.hover(null)
      el.style.cursor = ''
    }
    const onDown = (e: PointerEvent) => {
      if (e.button === 0) down = local(e)
    }
    // A drag released over the HUD or outside the window never reaches the canvas.
    const clearDown = () => (down = null)
    const onUp = (e: PointerEvent) => {
      const start = down
      down = null
      if (!start || e.button !== 0) return
      const p = local(e)
      if (Math.hypot(p.x - start.x, p.y - start.y) > CLICK_SLOP_PX) return
      const i = pickAt(p.x, p.y)
      if (i !== useGalaxyStore.getState().selected) actions.select(i)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerleave', onLeave)
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)
    window.addEventListener('pointerup', clearDown)
    window.addEventListener('pointercancel', clearDown)
    return () => {
      window.removeEventListener('pointerup', clearDown)
      window.removeEventListener('pointercancel', clearDown)
      cancelAnimationFrame(raf)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerleave', onLeave)
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointerup', onUp)
    }
  }, [el])

  return null
}
