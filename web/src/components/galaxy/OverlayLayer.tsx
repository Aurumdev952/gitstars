import { useState, type ReactNode } from 'react'
import { createPortal, useFrame, useThree } from '@react-three/fiber'
import { Scene } from 'three'

/**
 * A second scene drawn after the effect composer, so 3D text stays crisp: bloom from dense star
 * fields would otherwise wash over it, and AgX would grey it. Labels belong here; glowing marks
 * (stars, arcs, nebulae) stay in the main scene.
 */
export function OverlayLayer({ children }: { children: ReactNode }) {
  const [scene] = useState(() => new Scene())
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  useFrame(() => {
    const autoClear = gl.autoClear
    gl.autoClear = false
    gl.clearDepth()
    gl.render(scene, camera)
    gl.autoClear = autoClear
  }, 2)
  return createPortal(children, scene)
}
