import { useMemo, useRef } from 'react'
import { Billboard, Text } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Color, LinearSRGBColorSpace, Vector3, type Group, type PerspectiveCamera } from 'three'
import type { GalaxyIndex } from '#/lib/load'
import { sceneTheme } from '#/lib/theme'
import { useGalaxyStore } from '#/state/store'

export const LABEL_FONT = '/fonts/Geist-Medium.woff'
const CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789&-.,:/+ \'’'

type TextLike = {
  fillOpacity: number
  outlineOpacity: number
  textRenderInfo?: { blockBounds: [number, number, number, number] } | null
}

type Rect = { x0: number; y0: number; x1: number; y1: number }
const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
// Vertical nudges, in label heights, tried in order when a label would collide with a nearer one.
const NUDGES = [0, -1.15, 1.15, -2.3, 2.3]

/**
 * One label per galaxy at its centre, held at a constant screen size, faded once the camera is
 * inside the galaxy, and nudged vertically so nearer labels never overprint farther ones.
 */
export function MacroLabels({ galaxy }: { galaxy: GalaxyIndex }) {
  const items = useMemo(
    () =>
      galaxy.galaxies.map((g) => {
        const [r, gg, b] = g.color.linear
        // Lift toward white so the label reads over its own stars, keeping a trace of the hue.
        const color = new Color().setRGB(0.55 + r * 0.45, 0.55 + gg * 0.45, 0.55 + b * 0.45, LinearSRGBColorSpace)
        return { id: g.id, name: g.name.toUpperCase(), color, center: new Vector3(...g.centroid), radius: g.radius }
      }),
    [galaxy],
  )
  const groups = useRef<(Group | null)[]>([])
  const texts = useRef<(TextLike | null)[]>([])
  const nudge = useRef<number[]>([])
  const tmp = useMemo(() => new Vector3(), [])
  const up = useMemo(() => new Vector3(), [])

  useFrame(({ camera, size }) => {
    const cam = camera as PerspectiveCamera
    const worldPerPx = (2 * Math.tan((cam.fov * Math.PI) / 360)) / size.height
    const px = sceneTheme.label.macroPx
    const hoveredCluster = useGalaxyStore.getState().hoveredCluster
    up.set(0, 1, 0).applyQuaternion(cam.quaternion)
    const order = items.map((_, k) => k).sort((a, b) => cam.position.distanceTo(items[a]!.center) - cam.position.distanceTo(items[b]!.center))
    const placed: Rect[] = []
    for (const k of order) {
      const item = items[k]!
      const group = groups.current[k]
      const text = texts.current[k]
      if (!group || !text) continue
      const dist = cam.position.distanceTo(item.center)
      const fade = Math.min(1, Math.max(0, (dist / Math.max(1, item.radius) - 1.1) / 1.4))
      tmp.copy(item.center).project(cam)
      const bounds = text.textRenderInfo?.blockBounds
      const w = bounds ? (bounds[2] - bounds[0]) * px : item.name.length * px * 0.9
      const h = px * 1.4
      const sx = (tmp.x * 0.5 + 0.5) * size.width
      const sy = (0.5 - tmp.y * 0.5) * size.height
      const rectAt = (n: number): Rect => ({ x0: sx - w / 2 - 6, x1: sx + w / 2 + 6, y0: sy - h * (1 + n), y1: sy - h * n })
      const prev = nudge.current[k] ?? 0
      const visible = fade > 0.05 && tmp.z < 1
      let chosen: number | null = null
      if (visible) {
        for (const n of [prev, ...NUDGES]) {
          if (!placed.some((r) => overlaps(r, rectAt(n)))) {
            chosen = n
            break
          }
        }
      }
      if (chosen !== null) {
        placed.push(rectAt(chosen))
        nudge.current[k] = chosen
      }
      const offsetPx = (chosen ?? prev) * h + px * 0.2
      const anchorDist = Math.max(1, dist)
      group.position.copy(item.center).addScaledVector(up, offsetPx * worldPerPx * anchorDist)
      group.scale.setScalar(anchorDist * worldPerPx * px)
      const emphasis = hoveredCluster === null ? 0.82 : hoveredCluster === item.id ? 1 : 0.4
      const crowded = visible && chosen === null ? 0.15 : 1
      text.fillOpacity = fade * emphasis * crowded
      text.outlineOpacity = fade * emphasis * crowded * 0.85
    }
  })

  return (
    <>
      {items.map((item, k) => (
        <Billboard key={item.id} ref={(g) => void (groups.current[k] = g)}>
          <Text
            ref={(t: unknown) => void (texts.current[k] = t as TextLike | null)}
            font={LABEL_FONT}
            characters={CHARACTERS}
            fontSize={1}
            letterSpacing={0.2}
            anchorX="center"
            anchorY="bottom"
            color={item.color}
            outlineWidth="6%"
            outlineColor={sceneTheme.label.outline}
            outlineBlur="12%"
            renderOrder={20}
            material-depthTest={false}
            material-toneMapped={false}
          >
            {item.name}
          </Text>
        </Billboard>
      ))}
    </>
  )
}
