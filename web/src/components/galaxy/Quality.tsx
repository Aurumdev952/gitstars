import { useEffect, useRef } from 'react'
import { PerformanceMonitor } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { TIERS, applyVerdict, effectiveTier, type AutoState } from '#/lib/quality'
import { useGalaxyStore } from '#/state/store'

/**
 * Adaptive quality: drei's PerformanceMonitor reports slow and fast windows, `applyVerdict` turns
 * them into tier changes, and the tier sets the canvas DPR here and the post chain in Effects.
 * drei's own flip-flop fallback is not used: it counts every verdict, including inclines at the
 * top tier, so a steady 60 fps machine would fall back to low after three windows.
 */
export function Quality() {
  const setDpr = useThree((s) => s.setDpr)
  const tier = useGalaxyStore((s) => effectiveTier(s.settings.quality, s.autoTier))
  // Shader compiles, the intro and the model warm-up hitch the first seconds, and under the
  // 'demand' frameloop (reduced motion, ?freeze) sparse frames look like a slow GPU.
  const judging = useGalaxyStore((s) => s.intro === 'done' && s.settings.quality === 'auto' && !s.frozen && s.settings.motion === 'full')
  const auto = useRef<AutoState>({ tier: useGalaxyStore.getState().autoTier, changes: 0 })

  useEffect(() => {
    const [lo, hi] = TIERS[tier].dpr
    setDpr(Math.max(lo, Math.min(hi, window.devicePixelRatio)))
  }, [tier, setDpr])

  const verdict = (dir: 'up' | 'down') => {
    auto.current = applyVerdict(auto.current, dir)
    useGalaxyStore.getState().actions.setAutoTier(auto.current.tier)
  }
  if (!judging) return null
  // Bounds in fps: below 45 steps down, above 57 steps back up.
  return <PerformanceMonitor ms={500} iterations={6} bounds={() => [45, 57]} onDecline={() => verdict('down')} onIncline={() => verdict('up')} />
}
