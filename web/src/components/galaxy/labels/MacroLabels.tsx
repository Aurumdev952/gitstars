import { useMemo, useRef } from 'react'
import { Billboard, Text } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Color, LinearSRGBColorSpace, Vector3, type Group, type PerspectiveCamera } from 'three'
import type { GalaxyIndex } from '#/lib/load'
import { sceneTheme } from '#/lib/theme'
import { useGalaxyStore } from '#/state/store'

export const LABEL_FONT = '/fonts/Geist-Medium.woff'
const CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789&-.,:/+ \'’'

type TextLike = { fillOpacity: number; outlineOpacity: number }

/** One always-visible label per galaxy, held at a constant screen size and faded once inside it. */
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
  const tmp = useMemo(() => new Vector3(), [])
  const up = useMemo(() => new Vector3(), [])

  useFrame(({ camera, size }) => {
    const cam = camera as PerspectiveCamera
    const worldPerPx = (2 * Math.tan((cam.fov * Math.PI) / 360)) / size.height
    const hoveredCluster = useGalaxyStore.getState().hoveredCluster
    // Nudged along screen-up so the label sits just over its galaxy's centre at any orbit angle.
    up.set(0, 1, 0).applyQuaternion(cam.quaternion)
    items.forEach((item, k) => {
      const group = groups.current[k]
      const text = texts.current[k]
      if (!group || !text) return
      tmp.copy(item.center).addScaledVector(up, item.radius * 0.15)
      group.position.copy(tmp)
      const dist = cam.position.distanceTo(tmp)
      group.scale.setScalar(dist * worldPerPx * sceneTheme.label.macroPx)
      const inside = cam.position.distanceTo(item.center) / Math.max(1, item.radius)
      const fade = Math.min(1, Math.max(0, (inside - 1.1) / 1.4))
      const emphasis = hoveredCluster === null ? 0.82 : hoveredCluster === item.id ? 1 : 0.4
      text.fillOpacity = fade * emphasis
      text.outlineOpacity = fade * emphasis * 0.85
    })
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
