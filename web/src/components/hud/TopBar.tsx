import { useRef } from 'react'
import { useGalaxyStore } from '#/state/store'
import { formatCount } from '#/lib/format'
import { useOccluder } from './useOccluder'

export function StarMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <path d="M12 1.5 L13 11 L22.5 12 L13 13 L12 22.5 L11 13 L1.5 12 L11 11 Z" fill="currentColor" />
      <circle cx="12" cy="12" r="2.2" fill="white" />
    </svg>
  )
}

export function TopBar({ dataName }: { dataName: string }) {
  const g = useGalaxyStore((s) => s.galaxy)
  const ref = useRef<HTMLElement>(null)
  useOccluder(ref)
  if (!g) return null
  const { counts } = g.data.meta
  const stats = [
    [counts.repos, counts.repos === 1 ? 'star' : 'stars'],
    [counts.galaxies, counts.galaxies === 1 ? 'galaxy' : 'galaxies'],
    [counts.systems, counts.systems === 1 ? 'system' : 'systems'],
  ] as const
  return (
    <header ref={ref} className="pointer-events-none fixed top-0 left-0 z-10 px-6 pt-5 select-none">
      <h1 className="flex items-center gap-2.5 text-[19px] font-medium tracking-[-0.01em] text-ink [text-shadow:0_1px_12px_rgb(0_0_0/0.8)]">
        <StarMark className="size-[18px] text-starlight drop-shadow-[0_0_6px_oklch(0.86_0.12_85/0.7)]" />
        gitstars
        {dataName !== 'galaxy' && (
          <span className="rounded-full border border-glass-border px-2 py-0.5 font-mono text-[10.5px] font-normal tracking-normal text-ink-faint">
            {dataName}
          </span>
        )}
      </h1>
      <p className="mt-1.5 flex gap-3.5 pl-[28px] text-[12.5px] text-ink-faint [text-shadow:0_1px_8px_rgb(0_0_0/0.9)]">
        {stats.map(([n, label]) => (
          <span key={label}>
            <span className="tabular font-medium text-ink-muted">{formatCount(n)}</span> {label}
          </span>
        ))}
      </p>
      <p className="mt-0.5 pl-[28px] text-[11.5px] text-ink-faint/80 [text-shadow:0_1px_8px_rgb(0_0_0/0.9)]">
        starred by <span className="text-ink-faint">{g.data.meta.viewer}</span>
      </p>
    </header>
  )
}
