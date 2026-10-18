import { useEffect } from 'react'
import { PerformanceMonitor } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { TIERS, effectiveTier, stepTier } from '#/lib/quality'
import { useGalaxyStore } from '#/state/store'

/**
 * Adaptive quality: drei's PerformanceMonitor steps the auto tier down when the frame rate sags
 * and back up when it recovers; the tier sets the canvas DPR here and the post chain in Effects.
 */
export function Quality() {
  const setDpr = useThree((s) => s.setDpr)
  const tier = useGalaxyStore((s) => effectiveTier(s.settings.quality, s.autoTier))
  // Shader compiles, the intro and the model warm-up all hitch the first seconds; judging the
  // frame rate then would lock a fast machine into low.
  const settled = useGalaxyStore((s) => s.intro === 'done' && s.settings.quality === 'auto')

  useEffect(() => {
    const [lo, hi] = TIERS[tier].dpr
    setDpr(Math.max(lo, Math.min(hi, window.devicePixelRatio)))
  }, [tier, setDpr])

  const step = (dir: 'up' | 'down') => {
    const s = useGalaxyStore.getState()
    s.actions.setAutoTier(stepTier(s.autoTier, dir))
  }
  if (!settled) return null
  // Bounds in fps: below 45 steps down, above 57 steps back up. Two flip-flops then it holds, so a
  // scene that sits on the boundary does not oscillate.
  return (
    <PerformanceMonitor
      ms={500}
      iterations={6}
      bounds={() => [45, 57]}
      flipflops={2}
      onDecline={() => step('down')}
      onIncline={() => step('up')}
      onFallback={() => useGalaxyStore.getState().actions.setAutoTier('low')}
    />
  )
}
